import * as fs from 'node:fs'

import type { LedgerEntry } from '../ledger/append.js'
import type { OrderStore } from '../order/store.js'
import type { WorkOrder } from '../order/schema.js'
import type { CommandProposal } from '../profile/command-proposal.js'
import { defaultHintsDir } from '../profile/hints.js'
import { recordExitCodes } from '../profile/proof.js'
import { resolveProfile } from '../profile/resolve.js'
import { emptyProfile } from '../profile/schema.js'
import { readProfile, writeProfile } from '../profile/store.js'
import { runOnFreshBase } from './baseline.js'
import type { BaselineDeps, FreshBaseRun } from './baseline.js'
import { lastLines } from './execution-parts.js'

// What the scout proposed is proved on the base branch before the order or the
// profile takes it, and a command someone else gave is never replaced.

export interface ScoutProofDeps {
  readonly base: BaselineDeps
  readonly store: OrderStore
}

const EXCERPT_LINES = 20

function record(
  deps: ScoutProofDeps,
  entry: Pick<LedgerEntry, 'orderId' | 'action' | 'subject' | 'reason'> &
    Partial<Pick<LedgerEntry, 'evidence'>>
): Promise<void> {
  return deps.store.record({
    at: deps.base.now(),
    actor: 'role:scout',
    evidence: [],
    ...entry,
  })
}

/** The first proposal for each check, for the checks nobody has given a command. */
async function worthProving(
  order: WorkOrder,
  proposals: readonly CommandProposal[],
  deps: ScoutProofDeps
): Promise<CommandProposal[]> {
  const repoPath = leadRepoPath(order)
  const resolved = resolveProfile({
    repoPath,
    hintsDir: defaultHintsDir(),
    stored: await readProfile(deps.base.root, repoPath),
  })
  const wanted: CommandProposal[] = []
  for (const proposal of proposals) {
    const held = order.context.toolchain[proposal.check] ?? resolved.checks[proposal.check]
    const reason =
      held !== null
        ? `${proposal.check} already has \`${held.command}\` from ${held.source}`
        : wanted.some((w) => w.check === proposal.check)
          ? `${proposal.check} was proposed twice`
          : null
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
  readonly evidence?: LedgerEntry['evidence'][number]
}

function skipped(deps: ScoutProofDeps, { orderId, proposal, why }: Verdict): Promise<void> {
  return record(deps, {
    orderId,
    action: 'scout.command.skipped',
    subject: proposal.check,
    reason: `Did not run the scout's \`${proposal.command}\`: ${why}.`,
  })
}

function leadRepoPath(order: WorkOrder): string {
  const lead = [...order.context.repos].sort((a, b) => a.lane - b.lane)[0]
  return lead?.path ?? ''
}

/**
 * Run what the scout proposed on the base branch. A command that exits 0 goes into the
 * repository's profile and the order's toolchain; one that does not is said so in the ledger.
 */
export async function proveScoutCommands(
  orderId: string,
  proposals: readonly CommandProposal[],
  deps: ScoutProofDeps
): Promise<void> {
  const order = await deps.store.load(orderId)
  if (order === null || proposals.length === 0) return
  const wanted = await worthProving(order, proposals, deps)
  if (wanted.length === 0) return
  const run = await runOnFreshBase(
    order,
    deps.base,
    wanted.map((p) => p.command)
  ).catch((error: unknown) => error as Error)
  for (const proposal of wanted) {
    if (run instanceof Error) await unproved(deps, { orderId, proposal, why: run.message })
    else await settle(deps, { order, proposal, run })
  }
}

interface Settling {
  readonly order: WorkOrder
  readonly proposal: CommandProposal
  readonly run: FreshBaseRun
}

async function settle(deps: ScoutProofDeps, settling: Settling): Promise<void> {
  const { order, proposal, run } = settling
  const code = run.exitCodes[proposal.command] ?? null
  if (code !== 0) {
    const why = code === null ? 'did not run to an exit' : `exited ${code}`
    const log = await fs.promises
      .readFile(run.logPaths[proposal.command] ?? '', 'utf8')
      .catch(() => '')
    const evidence = {
      kind: 'stdout',
      path: run.logPaths[proposal.command] ?? '',
      exitCode: code ?? undefined,
      excerpt: lastLines(log, EXCERPT_LINES),
    }
    await unproved(deps, { orderId: order.id, proposal, why, evidence })
    return
  }
  await keep(deps, settling)
}

function unproved(deps: ScoutProofDeps, verdict: Verdict): Promise<void> {
  const { orderId, proposal, why, evidence } = verdict
  return record(deps, {
    orderId,
    action: 'scout.command.unproved',
    subject: proposal.check,
    reason: `The scout's \`${proposal.command}\` ${why} on the base branch, so it is not used.`,
    evidence: evidence === undefined ? [] : [evidence],
  })
}

async function keep(deps: ScoutProofDeps, { order, proposal, run }: Settling): Promise<void> {
  const { check, command, evidence } = proposal
  const entry = { command, source: 'scout' as const, evidence }
  const repoPath = leadRepoPath(order)
  const stored = (await readProfile(deps.base.root, repoPath)) ?? emptyProfile(repoPath)
  await writeProfile(deps.base.root, repoPath, {
    ...stored,
    checks: { ...stored.checks, [check]: entry },
  })
  if (run.commit !== null) {
    const result = { commit: run.commit, at: deps.base.now(), exitCodes: { [command]: 0 } }
    await recordExitCodes(deps.base.root, repoPath, result)
  }
  const current = (await deps.store.load(order.id)) ?? order
  if (current.context.toolchain[check] === null) {
    const toolchain = { ...current.context.toolchain, [check]: entry }
    await deps.store.save({ ...current, context: { ...current.context, toolchain } })
  }
  await record(deps, {
    orderId: order.id,
    action: 'scout.command.proved',
    subject: check,
    reason: `The scout's \`${command}\` (read from ${evidence}) exited 0 on the base branch, so ${check} now runs it.`,
  })
}
