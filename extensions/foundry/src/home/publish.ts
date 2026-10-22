import type { ExtensionAPI } from '@terminator/extension-sdk'

import { buildFoundryHomeFeed } from './feed.js'
import type { OrderRow } from './feed.js'
import { factoryMetrics } from '../factory/metrics.js'
import type { FactoryMetrics, OrderRecords } from '../factory/metrics.js'
import { readPulls } from '../line/integrate.js'
import { readLiveStandings } from '../ipc/standing.js'
import type { LiveStandingSources } from '../ipc/standing.js'
import type { InboxChannels } from '../ipc/inbox-channels.js'
import type { WorkOrder } from '../order/schema.js'
import type { Standing } from '../order/standing.js'
import type { ActivationContext } from '../ipc/register.js'
import { disposables } from '../ipc/register.js'
import { gateStoreAt, indexFor, orderStoreAt, readGraph } from '../state/live-index.js'
import { isoNow } from '../host-calls.js'

// Foundry's side of Home (ADR 117): after any record changes, tell Home what is
// waiting on the operator, what is in flight and how the factory is doing. The change
// notice that already reaches the windows is the trigger; nothing here polls.

/** A burst of changes (one order write announces several kinds) publishes once. */
const DEBOUNCE_MS = 500

export interface HomePublisher {
  /** Publish after the debounce; a call while one is pending joins it. */
  scheduleFoundryPublish(): void
  /** Stops publishing; settles once a read already in flight has ended. */
  dispose(): Promise<void>
}

export interface HomePublisherDeps {
  readonly standingSources: LiveStandingSources
  /** The Inbox's own decide, so Home's button and the Inbox's run the same code. */
  readonly decide: InboxChannels['decide']
}

export function startFoundryHomePublisher(
  context: ActivationContext,
  deps: HomePublisherDeps
): HomePublisher {
  disposables.push(context.api.home.onAction(homeActionHandlerOf(context.api, deps)))
  return singleFlightPublisher(context, deps.standingSources)
}

interface Flight {
  reading: boolean
  changedWhileReading: boolean
  disposed: boolean
  /** The running read-and-publish loop, which never rejects; null when none runs. */
  inFlight: Promise<void> | null
  /** The root of the latest change: a read of an older one could index a location early. */
  root: string
}

// One read at a time: a change during a read earns one more read after it, so the
// feed published last is always the newest, and nothing is published once disposed.
function singleFlightPublisher(
  { api, dataRoot }: ActivationContext,
  sources: LiveStandingSources
): HomePublisher {
  let timer: ReturnType<typeof setTimeout> | null = null
  const flight: Flight = {
    reading: false,
    changedWhileReading: false,
    disposed: false,
    inFlight: null,
    root: dataRoot(),
  }
  return {
    scheduleFoundryPublish() {
      flight.root = dataRoot()
      if (flight.reading) flight.changedWhileReading = true
      else
        timer ??= setTimeout(() => {
          timer = null
          flight.inFlight = publishUntilCaughtUp(api, sources, flight)
        }, DEBOUNCE_MS)
    },
    async dispose() {
      flight.disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      await flight.inFlight
    },
  }
}

async function publishUntilCaughtUp(
  api: ExtensionAPI,
  sources: LiveStandingSources,
  flight: Flight
): Promise<void> {
  flight.reading = true
  try {
    do {
      flight.changedWhileReading = false
      const feed = await readFeed(flight.root, sources)
      if (!flight.disposed) api.home.publish(feed)
    } while (flight.changedWhileReading && !flight.disposed)
  } catch (error) {
    api.log.error('Home could not be told what Foundry is doing', error)
  } finally {
    flight.reading = false
  }
}

/** Home's button presses: Open shows Foundry, anything else decides the item's gate. */
function homeActionHandlerOf(
  api: ExtensionAPI,
  deps: HomePublisherDeps
): (itemId: string, actionId: string) => Promise<void> {
  return async (itemId, actionId) => {
    if (actionId === 'open') {
      api.window.showSelf('main')
      return
    }
    const gateId = itemId.startsWith('gate:') ? itemId.slice('gate:'.length) : null
    // An item with no gate offers no move but Open, so anything else is a stale click.
    if (gateId === null) throw new Error('That is no longer waiting on you.')
    const result = (await deps.decide({ gateId, option: actionId })) as { error?: string }
    if (result.error !== undefined) throw new Error(result.error)
  }
}

async function readFeed(root: string, sources: LiveStandingSources) {
  const now = isoNow()
  const rows = await readRows(root, sources)
  return buildFoundryHomeFeed({ rows, metrics: await recentFactoryMetrics(root, now), now })
}

async function readRows(root: string, sources: LiveStandingSources): Promise<OrderRow[]> {
  const { orders, waiting } = await readLiveStandings(() => root, sources)
  return Promise.all(
    orders.map((order) => {
      const standing = waiting.find((w) => w.orderId === order.id)!.standing
      return homeOrderRowOf(root, order, standing)
    })
  )
}

/** When the order left the line: its draft opened, or its run ended on a ready document. */
function leftTheLineAt(ledger: readonly { action: string; at: string }[]): string | null {
  const firstAt = (action: string) => ledger.find((entry) => entry.action === action)?.at
  return firstAt('ship.draft_opened') ?? firstAt('run.document_ready') ?? null
}

async function homeOrderRowOf(
  root: string,
  order: WorkOrder,
  standing: Standing
): Promise<OrderRow> {
  const ledger = await orderStoreAt(root).entries(order.id)
  const gates = await indexFor(root).gatesOf(order.id)
  const gate = gates.find((g) => g.id === standing.gateId) ?? null
  const updatedAt = ledger.at(-1)?.at ?? order.createdAt
  const pulls = await readPulls(root, order.id)
  return {
    order,
    standing,
    gate,
    since: gate?.raisedAt ?? updatedAt,
    updatedAt,
    closedAt: leftTheLineAt(ledger),
    pullUrl: pulls[0]?.url ?? null,
  }
}

/** The factory dashboard's 30 day numbers, recomputed from the records the way its channel does. */
async function recentFactoryMetrics(root: string, now: string): Promise<FactoryMetrics> {
  const gates = await gateStoreAt(root).list()
  const records: OrderRecords[] = await Promise.all(
    (await orderStoreAt(root).list()).map(async (order) => ({
      order,
      ledger: await orderStoreAt(root).entries(order.id),
      gates: gates.filter((g) => g.orderId === order.id),
      graph: await readGraph(root, order.id),
    }))
  )
  return factoryMetrics(records, '30d', now)
}
