import type { LedgerEntry } from '../ledger/append.js'
import type { OrderStore } from '../order/store.js'
import type { WorkOrder } from '../order/schema.js'
import type { CommandProposal } from '../profile/command-proposal.js'
import { defaultHintsDir } from '../profile/hints.js'
import { resolveProfile, type ResolvedProfile } from '../profile/resolve.js'
import { emptyProfile, isRemoved, type Profile } from '../profile/schema.js'
import { readProfile, writeProfile } from '../profile/store.js'
import { leadRepo } from '../order/lead-repo.js'

// What the scout proposed fills a check that has no command, unproven: the base branch
// is assumed to pass (ADR 137). A command someone else gave is never replaced.

export interface ScoutCommandDeps {
  /** The data root the stored profiles live under. */
  readonly root: string
  readonly now: () => string
  readonly store: OrderStore
}

function record(
  deps: ScoutCommandDeps,
  entry: Pick<LedgerEntry, 'orderId' | 'action' | 'subject' | 'reason'> &
    Partial<Pick<LedgerEntry, 'evidence'>>
): Promise<void> {
  return deps.store.record({
    at: deps.now(),
    actor: 'role:scout',
    evidence: [],
    ...entry,
  })
}

interface Holding {
  readonly order: WorkOrder
  readonly stored: Profile | null
  readonly resolved: ResolvedProfile
}

/** Why a proposal is not worth keeping, or null when it is. */
function skipReason(
  proposal: CommandProposal,
  holding: Holding,
  wanted: readonly CommandProposal[]
): string | null {
  const { check } = proposal
  if (isRemoved(holding.stored?.checks[check] ?? null)) {
    return `the operator said ${check} has no command`
  }
  const held = holding.order.context.toolchain[check] ?? holding.resolved.checks[check]
  if (held !== null) return `${check} already has \`${held.command}\` from ${held.source}`
  return wanted.some((w) => w.check === check) ? `${check} was proposed twice` : null
}

/** The first proposal for each check, for the checks nobody has given a command. */
async function worthKeeping(
  order: WorkOrder,
  proposals: readonly CommandProposal[],
  deps: ScoutCommandDeps
): Promise<CommandProposal[]> {
  const repoPath = leadRepo(order)?.path ?? ''
  const stored = await readProfile(deps.root, repoPath)
  const resolved = resolveProfile({ repoPath, hintsDir: defaultHintsDir(), stored })
  const wanted: CommandProposal[] = []
  for (const proposal of proposals) {
    const reason = skipReason(proposal, { order, stored, resolved }, wanted)
    if (reason === null) wanted.push(proposal)
    else await skipped(deps, { orderId: order.id, proposal, why: reason })
  }
  return wanted
}

/** Why a proposal was left alone or did not hold, for one order. */
interface Verdict {
  readonly orderId: string
  readonly proposal: CommandProposal
  readonly why: string
}

function skipped(deps: ScoutCommandDeps, { orderId, proposal, why }: Verdict): Promise<void> {
  return record(deps, {
    orderId,
    action: 'scout.command.skipped',
    subject: proposal.check,
    reason: `Did not run the scout's \`${proposal.command}\`: ${why}.`,
  })
}

/** Keep the first scout proposal for each check that has no command; nothing is run. */
export async function keepScoutCommands(
  orderId: string,
  proposals: readonly CommandProposal[],
  deps: ScoutCommandDeps
): Promise<void> {
  const order = await deps.store.load(orderId)
  if (order === null || proposals.length === 0) return
  for (const proposal of await worthKeeping(order, proposals, deps)) {
    await keep(deps, { order, proposal })
  }
}

interface Settling {
  readonly order: WorkOrder
  readonly proposal: CommandProposal
}

async function keep(deps: ScoutCommandDeps, { order, proposal }: Settling): Promise<void> {
  const { check, command, evidence } = proposal
  const entry = { command, source: 'scout' as const, evidence }
  const repoPath = leadRepo(order)?.path ?? ''
  const stored = (await readProfile(deps.root, repoPath)) ?? emptyProfile(repoPath)
  await writeProfile(deps.root, repoPath, {
    ...stored,
    checks: { ...stored.checks, [check]: entry },
  })
  const current = (await deps.store.load(order.id)) ?? order
  if (current.context.toolchain[check] === null) {
    const toolchain = { ...current.context.toolchain, [check]: entry }
    await deps.store.save({ ...current, context: { ...current.context, toolchain } })
  }
  await record(deps, {
    orderId: order.id,
    action: 'scout.command.kept',
    subject: check,
    reason: `Kept the scout's \`${command}\` for ${check}, not run.`,
  })
}
