import type { ExtensionAPI } from '@terminator/extension-sdk'
import { randomUUID } from 'node:crypto'

import { createSignalStore } from './store.js'
import type { SignalStore } from './store.js'
import { dueSensors, runSensor } from './schedule.js'
import type { CollectDeps } from './collect.js'
import { availableSensors } from '../recipe/resolve.js'

import type { ActivationContext } from '../ipc/register.js'
import { resolveSources } from '../workspace-root.js'
import { isoNow, shellExecOf } from '../host-calls.js'

// The sensor tick (ADR-066): every due, enabled sensor, in turn, once a minute while
// the app is open; `dueSensors` makes it nothing when none is enabled.
let sensorTimer: NodeJS.Timeout | null = null
/** Ticks running now; stopping waits for them. */
const ticksInFlight = new Set<Promise<void>>()

/** The tracker connection, narrowed to what a sensor's `tracker` source needs. */
function sensorIssuesFor(api: ExtensionAPI): CollectDeps['issues'] {
  const issues = api.issues
  return {
    search: async (query, opts) =>
      (await issues.search(query, opts)).issues.map((issue) => ({
        key: issue.key,
        title: issue.title,
        url: issue.url,
      })),
    listMine: async (opts) =>
      (await issues.listMine(opts)).issues.map((issue) => ({
        key: issue.key,
        title: issue.title,
        url: issue.url,
      })),
  }
}

/** One `CollectDeps` for a sensor on `repoPath`, over the extension's exec and tracker. */
export function sensorCollectDepsFor(api: ExtensionAPI, repoPath: string): CollectDeps {
  return {
    exec: shellExecOf(api),
    cwd: repoPath,
    issues: sensorIssuesFor(api),
    now: isoNow,
  }
}

// A signal store resolving its root on every call: the records location follows the
// open workspace, as with `createLiveOrderStore`.
function liveSignalStore(root: () => string): SignalStore {
  return {
    list: () => createSignalStore(root()).list(),
    save: (signals) => createSignalStore(root()).save(signals),
    get: (id) => createSignalStore(root()).get(id),
    sensorState: () => createSignalStore(root()).sensorState(),
    setSensorState: (id, patch) => createSignalStore(root()).setSensorState(id, patch),
  }
}

/** Every due, enabled sensor, once, in turn: one tick, the 60-second one or "run now". */
async function tickSensors(api: ExtensionAPI, root: string, store: SignalStore): Promise<void> {
  const sources = resolveSources(api, root)
  const defs = availableSensors(sources).map(({ def }) => def)
  const states = await store.sensorState()
  const now = new Date().toISOString()
  for (const def of dueSensors(defs, states, now)) {
    // `dueSensors` already refused anything without a repository; the null
    // check here is only so the type checker agrees.
    const repoPath = states[def.id].repoPath
    if (repoPath === null) continue
    try {
      await runSensor(def, {
        store,
        collectDeps: sensorCollectDepsFor(api, repoPath),
        now: isoNow,
        newId: () => randomUUID(),
      })
    } catch (error) {
      api.log.error(`sensor ${def.id} failed to run`, error)
    }
  }
}

// Sensors read the product back into the factory: one tick a minute over the enabled
// sensors with a repository (none by default), resolved each tick because the records
// location and the watched repositories follow the operator's configuration.
export function startSensorTick({ api, dataRoot }: ActivationContext): SignalStore {
  const signalStore = liveSignalStore(dataRoot)
  sensorTimer = setInterval(() => {
    const tick = tickSensors(api, dataRoot(), signalStore).finally(() => ticksInFlight.delete(tick))
    ticksInFlight.add(tick)
  }, 60_000)
  return signalStore
}

/** Settles when the tick running now, if any, has ended. */
export async function stopSensorTick(): Promise<void> {
  if (sensorTimer !== null) clearInterval(sensorTimer)
  sensorTimer = null
  await Promise.allSettled([...ticksInFlight])
}
