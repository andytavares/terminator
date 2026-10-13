import { noPayload } from '@terminator/extension-sdk'
import type { ExtensionAPI } from '@terminator/extension-sdk'

import { createForgeChannels, forgeChannelSpecs } from './forge-channels.js'
import { foundryChannel } from './channel.js'
import { IssuesMinePayload, OrderIdPayload, TicketCreatePayload } from './payloads.js'
import { createLiveOrderStore } from '../order/store.js'
import { deleteOrder } from '../line/teardown.js'
import { computeQueueEntries } from '../line/refinery-entries.js'
import { projectRemover } from '../line/order-project.js'
import { fileTicket, ticketOffer } from '../forge/ticket-offer.js'
import { checkCapability, writeBack } from '../trackers/write-back.js'

import type { ForgeChannels, ForgeDeps } from './forge-channels.js'
import { reg } from './register.js'
import type { ActivationContext } from './register.js'
import { announceLive, indexFor, orderStoreAt } from '../state/live-index.js'
import { intakeSessions, deletedOrders } from '../forge/intake-sessions.js'
import { defaultWriteBack, defaultBudgets, declaredCriticalPaths } from '../state/settings.js'
import { runtime } from '../runtime/runtime-state.js'
import { issuesPortFor, writeBackDepsFor } from '../trackers/issues-port.js'
import { stopOrder } from '../line/run-control.js'
import type { LiveStandingSources } from './standing.js'
import type { ForgeLoop } from '../forge/forge-loop.js'

/**
 * What the record already says about these files (FR-077).
 *
 * One line per past decision, newest first and bounded — the point is to tell
 * the Architect "this was decided before", not to hand it the whole ledger.
 */
export async function priorArtFor(root: string, paths: readonly string[]): Promise<string[]> {
  const store = orderStoreAt(root)
  const orders = await store.list()
  const entries = (await Promise.all(orders.map((order) => store.entries(order.id)))).flat()

  return entries
    .filter((entry) => paths.some((p) => entry.subject.includes(p) || entry.reason.includes(p)))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10)
    .map((entry) => `${entry.at.slice(0, 10)} ${entry.actor}: ${entry.action} — ${entry.reason}`)
}

/** What the Forge's channels are built over, beside the host and the records. */
export interface ForgeRegistrationDeps {
  readonly standingSources: LiveStandingSources
  readonly loop: ForgeLoop
}

/**
 * The Forge: an idea or a tracker issue in, a compilable work order out, and
 * the channels around it — your tickets, a ticket for a typed idea, and
 * deleting an order outright.
 */
export function registerForgeChannels(
  context: ActivationContext,
  deps: ForgeRegistrationDeps
): ForgeChannels {
  const forge = createForge(context, deps)
  registerIssueChannels(context.api)
  reg(context.api, ...forgeChannelSpecs(forge))
  registerOrderDelete(context)
  return forge
}

function createForge(
  { api, dataRoot }: ActivationContext,
  { standingSources, loop }: ForgeRegistrationDeps
): ForgeChannels {
  const issuesPort = issuesPortFor(api)
  return createForgeChannels({
    store: createLiveOrderStore(dataRoot, indexFor),
    dataRoot,
    now: () => new Date().toISOString(),
    standingSources,
    writeBackDefault: () => defaultWriteBack(api),
    budgetDefaults: () => defaultBudgets(api),
    criticalPaths: () => declaredCriticalPaths(api),
    priorArtFor: (paths) => priorArtFor(dataRoot(), paths),
    // The redraft lands here, when the architect's turn ends — minutes after
    // the channel that started it answered.
    converge: (order, message, recordStart) =>
      loop.convergeMaybeScouted(order, message, recordStart),
    // FR-059a: asked when the order is agreed, so an issue that will never
    // move is known before the run rather than after it.
    capability: (order) => checkCapability(order, writeBackDepsFor(dataRoot(), order, issuesPort)),
    onAgreed: async (order) => {
      await writeBack(order, 'agreed', writeBackDepsFor(dataRoot(), order, issuesPort))
    },
    readIssue: (tracker, key) => readIssue(api, tracker, key),
    queueEntries: () => computeQueueEntries(dataRoot(), orderStoreAt(dataRoot())),
    onReleased: loop.onReleased,
  })
}

async function readIssue(
  api: ExtensionAPI,
  tracker: Parameters<ForgeDeps['readIssue']>[0],
  key: string
): ReturnType<ForgeDeps['readIssue']> {
  // Through the application's own tracker connection. This extension never
  // holds a credential and never contacts a tracker itself. A host with no
  // tracker connected answers "no issue" rather than throwing.
  const issue = await api.issues.get(tracker, key)
  if (issue === null) return null
  return {
    key: issue.key,
    title: issue.title,
    description: issue.description ?? '',
    url: issue.url ?? '',
    branchName: (issue as { branchName?: string | null }).branchName ?? null,
  }
}

function registerIssueChannels(api: ExtensionAPI): void {
  // Your tickets, so a ticket can be picked rather than typed from memory.
  //
  // The Forge has always taken a tracker key, and the only way to give it one
  // was to know it already. The host lists and searches issues — `listMine`
  // and `search` have been there the whole time — and nothing here asked.
  // Importing work is the front door of a tool that does work, and it did not
  // have one.
  const myIssues = foundryChannel('foundry:issues.mine', IssuesMinePayload, (payload) =>
    listMyIssues(api, payload?.term ?? '')
  )
  reg(api, {
    ...myIssues,
    onError: (error) => ({
      error: error instanceof Error ? error.message : 'Could not read your tickets.',
    }),
  })
  // A ticket for a typed idea, offered before it becomes an order (spec 061).
  reg(
    api,
    foundryChannel('foundry:ticket.offer', noPayload, async () => ({
      offer: await ticketOffer(api.issues),
    })),
    foundryChannel('foundry:ticket.create', TicketCreatePayload, (payload) =>
      fileTicket(api.issues, payload)
    )
  )
}

async function listMyIssues(api: ExtensionAPI, rawTerm: string) {
  const issues = api.issues
  const term = rawTerm.trim()
  const connected = await issues.connections()
  // Nothing connected is a real answer and not an error: the surface says
  // so rather than showing an empty list that looks like "no tickets".
  if (connected.length === 0) return { connected: [], issues: [] }
  const found =
    term === '' ? await issues.listMine({ limit: 50 }) : await issues.search(term, { limit: 50 })
  return {
    connected: connected.map((c) => ({
      tracker: String(c.tracker),
      account: String(c.account ?? ''),
    })),
    issues: (found.issues ?? []).map((issue) => ({
      tracker: String(issue.tracker),
      key: String(issue.key),
      title: String(issue.title ?? ''),
      status: String((issue as { status?: unknown }).status ?? ''),
    })),
    failures: (found.failures ?? []).map((f) => String((f as { message?: unknown }).message ?? f)),
  }
}

// Gone, rather than hidden.
//
// `order.cancel` marks an order `cancelled` and drops it off the list, and
// leaves its directory, its ledger, its worktree and its branch exactly
// where they were — so the records location and the target repository fill
// up with work nobody can reach or restart. This is the other answer.
function registerOrderDelete({ api, dataRoot }: ActivationContext): void {
  reg(
    api,
    foundryChannel('foundry:order.delete', OrderIdPayload, async ({ id }) => {
      const root = dataRoot()
      const order = await orderStoreAt(root).load(id)
      if (order === null) return { error: `No order ${id}.` }

      deletedOrders.add(id)
      // Its agents first. Deleting the records out from under a live session
      // leaves an agent writing into a worktree whose order no longer exists.
      await stopOrder(root, id, 'the order was deleted')
      // The architect too: it runs in the checkout about to be removed, and the
      // run graph that `stopOrder` reads does not know about it.
      const intake = intakeSessions.get(id)
      if (intake !== undefined) {
        runtime.supervisedRunner?.stop(intake, 'the order was deleted')
        intakeSessions.delete(id)
        announceLive(id)
      }
      const result = await deleteOrder(order, {
        exec: (o) => api.shell.exec(o),
        root,
        removeProjectAt: projectRemover(api.workspace),
      })
      indexFor(root).orderRemoved(id)
      return { ok: result.failed.length === 0, removed: result.removed, failed: result.failed }
    })
  )
}
