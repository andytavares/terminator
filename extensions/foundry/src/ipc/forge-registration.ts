import { noPayload } from '@terminator/extension-sdk'
import type { ExtensionAPI } from '@terminator/extension-sdk'

import { createForgeChannels, forgeChannelSpecs } from './forge-channels.js'
import { createProfileChannels, profileChannelSpecs } from './profile-channels.js'
import { defaultHintsDir } from '../profile/hints.js'
import { foundryChannel } from './channel.js'
import { IssuesMinePayload, OrderIdPayload, TicketCreatePayload } from './payloads.js'
import { createLiveOrderStore } from '../order/store.js'
import { deleteOrder } from '../line/teardown.js'
import { projectRemover } from '../line/order-project.js'
import { baselineDepsFor } from '../line/baseline-deps.js'
import { fileTicket, ticketOffer } from '../forge/ticket-offer.js'
import { checkCapability, writeBack } from '../trackers/write-back.js'

import type { ForgeChannels, ForgeDeps } from './forge-channels.js'
import { reg } from './register.js'
import type { ActivationContext } from './register.js'
import { announceLive, indexFor, orderStoreAt, queueEntriesOf } from '../state/live-index.js'
import { intakeSessions, deletedOrders } from '../forge/intake-sessions.js'
import { defaultWriteBack, defaultBudgets, declaredCriticalPaths } from '../state/settings.js'
import { runtime } from '../runtime/runtime-state.js'
import { issuesPortFor, writeBackDepsFor } from '../trackers/issues-port.js'
import { stopOrder } from '../line/run-control.js'
import type { LiveStandingSources } from './standing.js'
import type { ForgeLoop } from '../forge/forge-loop.js'
import { isoNow, shellExecOf } from '../host-calls.js'

// What the record already says about these files (FR-077): one line per past
// decision, newest first and bounded, to tell the Architect it was decided before.
/** @internal */
export async function priorArtInRecords(root: string, paths: readonly string[]): Promise<string[]> {
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

// The Forge: an idea or tracker issue in, a compilable work order out, and the
// channels around it (your tickets, a ticket for a typed idea, deleting an order).
export function registerForgeChannels(
  context: ActivationContext,
  deps: ForgeRegistrationDeps
): ForgeChannels {
  const forge = createForge(context, deps)
  registerIssueChannels(context.api)
  reg(context.api, ...forgeChannelSpecs(forge))
  registerProfileChannels(context)
  registerOrderDelete(context)
  return forge
}

function registerProfileChannels({ api, dataRoot }: ActivationContext): void {
  const store = createLiveOrderStore(dataRoot, indexFor)
  const channels = createProfileChannels({
    dataRoot,
    hintsDir: defaultHintsDir(),
    store,
    baseline: () => baselineDepsFor(api, dataRoot(), store),
  })
  reg(api, ...profileChannelSpecs(channels))
}

function createForge(
  { api, dataRoot }: ActivationContext,
  { standingSources, loop }: ForgeRegistrationDeps
): ForgeChannels {
  const issuesPort = issuesPortFor(api)
  const store = createLiveOrderStore(dataRoot, indexFor)
  return createForgeChannels({
    store,
    dataRoot,
    now: isoNow,
    standingSources,
    writeBackDefault: () => defaultWriteBack(api),
    budgetDefaults: () => defaultBudgets(api),
    criticalPaths: (repoPaths) => declaredCriticalPaths(api, repoPaths),
    priorArtFor: (paths) => priorArtInRecords(dataRoot(), paths),
    // The redraft lands here, when the architect's turn ends — minutes after
    // the channel that started it answered.
    converge: (order, message, recordStart) =>
      loop.convergeMaybeScouted(order, message, recordStart),
    // FR-059a: asked when the order is agreed, so an issue that will never
    // move is known before the run rather than after it.
    capability: (order) => checkCapability(order, writeBackDepsFor(dataRoot(), order, issuesPort)),
    onAgreed: async (order) => {
      await writeBack(order, { event: 'agreed' }, writeBackDepsFor(dataRoot(), order, issuesPort))
    },
    readIssue: (tracker, key) => readTrackerIssue(api, tracker, key),
    queueEntries: queueEntriesOf(dataRoot),
    onReleased: loop.onReleased,
  })
}

async function readTrackerIssue(
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
  // Your tickets, so one can be picked rather than typed from memory, through the
  // host's `listMine` and `search`.
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
    foundryChannel('foundry:ticket.offer', noPayload, () => offerTicket(api)),
    foundryChannel('foundry:ticket.create', TicketCreatePayload, (payload) =>
      fileTicket(api.issues, payload)
    )
  )
}

export async function offerTicket(api: ExtensionAPI) {
  return { offer: await ticketOffer(api.issues) }
}

export async function listMyIssues(api: ExtensionAPI, rawTerm: string) {
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

// Deletes an order outright. `order.cancel` only marks it, leaving its directory,
// ledger, worktree and branch to fill the records and the repository.
function registerOrderDelete({ api, dataRoot }: ActivationContext): void {
  reg(
    api,
    foundryChannel('foundry:order.delete', OrderIdPayload, ({ id }) =>
      removeOrder({ api, dataRoot }, id)
    )
  )
}

export async function removeOrder({ api, dataRoot }: ActivationContext, id: string) {
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
    exec: shellExecOf(api),
    root,
    removeProjectAt: projectRemover(api.workspace),
  })
  indexFor(root).orderRemoved(id)
  return { ok: result.failed.length === 0, removed: result.removed, failed: result.failed }
}
