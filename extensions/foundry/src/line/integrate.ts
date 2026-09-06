import * as fs from 'node:fs'
import * as path from 'node:path'
import { orderDir } from '../data-root.js'
import { raiseGate } from '../gates/rules.js'
import type { Gate } from '../gates/rules.js'
import type { WorkOrder } from '../order/schema.js'
import type { Verdict } from '../verify/verdict.js'

// The end of the line: a draft pull request, opened without being asked for.
//
// FR-053 and FR-057 together are the point of this file. Work ends in a draft
// because a review of a real change is worth more than a decision about
// whether to produce one, and the decision the operator is then offered is
// "mark it ready?" — never "shall I open it?". Nine decisions became one, and
// this is where the last of the eight went.
//
// The one exception is risk-ordered (FR-055): for the two highest grades the
// operator decides before anything reaches the remote, because a force-pushed
// branch is cheap to undo and a leaked migration is not.

/** The grades whose decision is taken before anything is pushed. */
export const GATED_GRADES = ['P0', 'P1'] as const

export type ShipMode = 'gate_then_push' | 'push_then_gate'

export interface ExecResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export interface ShellExec {
  (options: {
    command: 'git' | 'gh'
    args: string[]
    cwd: string
    timeoutMs?: number
  }): Promise<ExecResult>
}

export interface IntegrateDeps {
  readonly exec: ShellExec
  /** The resolved data root. Bodies are written under the order's directory. */
  readonly root: string
  readonly now: () => string
  /** FR-053/FR-054: the operator's setting, already read. */
  readonly autoOpen: boolean
  /** Put a gate in front of the operator and resolve with the option chosen. */
  readonly decide: (gate: Gate) => Promise<string>
  readonly record: (action: string, subject: string, reason: string) => Promise<void>
}

export interface Shipment {
  readonly verdicts: readonly Verdict[]
  /** What the inspection found. Empty means it found nothing, not that it did not run. */
  readonly findings: readonly string[]
}

export interface LanePullRequest {
  readonly lane: number
  readonly repo: string
  readonly cwd: string
  readonly branch: string
  readonly url: string
  readonly bodyPath: string
}

export interface ShipOutcome {
  readonly pulls: readonly LanePullRequest[]
  readonly bodyPaths: readonly string[]
  /** True when nothing was pushed, and `reason` says why. */
  readonly held: boolean
  readonly reason: string
}

export class PushRefusedError extends Error {
  readonly code = 'PUSH_REFUSED'
  constructor(repo: string, stderr: string) {
    super(`Pushing ${repo} was refused, so no pull request was opened: ${stderr.trim()}`)
    this.name = 'PushRefusedError'
  }
}

export class PullRequestFailedError extends Error {
  readonly code = 'PR_FAILED'
  constructor(what: string, stderr: string) {
    super(`${what}: ${stderr.trim()}`)
    this.name = 'PullRequestFailedError'
  }
}

/**
 * Whether the operator decides before the push or after the draft is open.
 *
 * Two behaviours rather than one, and deliberately: the cost is that the
 * operator cannot tell from the rule alone which they will get, which is why
 * the grade is shown on the order.
 */
export function shipModeFor(order: WorkOrder): ShipMode {
  return (GATED_GRADES as readonly string[]).includes(order.risk.grade)
    ? 'gate_then_push'
    : 'push_then_gate'
}

function verdictLine(order: WorkOrder, criterionId: string, verdicts: readonly Verdict[]): string {
  const statement = order.acceptance.find((c) => c.id === criterionId)?.statement ?? ''
  const found = verdicts.filter((v) => v.criterionId === criterionId)

  // No verdict is "not measured", never a pass. This is the same rule the
  // ladder enforces, said again at the surface a reviewer actually reads —
  // a criterion silently omitted from this table is how an unchecked change
  // gets approved.
  if (found.length === 0) return `| ${criterionId} | ${statement} | not measured | nothing ran |`

  const worst =
    found.find((v) => v.result === 'fail') ??
    found.find((v) => v.result === 'not_measured') ??
    found[0]
  const result = worst.result === 'not_measured' ? 'not measured' : worst.result
  return `| ${criterionId} | ${statement} | ${result} | ${worst.reason} |`
}

/**
 * What a reviewer reads.
 *
 * A verdict per criterion, in a table, including the ones nothing checked —
 * FR-056 asks for every criterion, and "every" is the load-bearing word.
 */
export function prBody(order: WorkOrder, shipment: Shipment): string {
  const lines: string[] = [
    `## ${order.title}`,
    '',
    order.intent.problem === '' ? '_No problem statement._' : order.intent.problem,
    '',
    order.intent.outcome === '' ? '' : `**Outcome.** ${order.intent.outcome}`,
    '',
    '### What was done',
    '',
  ]

  for (const unit of order.plan.units) {
    lines.push(`- **${unit.id}** ${unit.title} — ${unit.role}`)
  }
  if (order.plan.units.length === 0) lines.push('_No units._')

  lines.push(
    '',
    '### Verdicts',
    '',
    '| | Criterion | Result | Notes |',
    '| --- | --- | --- | --- |'
  )
  for (const criterion of order.acceptance) {
    lines.push(verdictLine(order, criterion.id, shipment.verdicts))
  }
  if (order.acceptance.length === 0) lines.push('| — | _No criteria._ | not measured | |')

  lines.push('', '### Inspection', '')
  if (shipment.findings.length === 0) {
    lines.push('Nothing found.')
  } else {
    for (const finding of shipment.findings) lines.push(`- ${finding}`)
  }

  lines.push(
    '',
    '---',
    '',
    `Opened as a draft by Foundry from work order \`${order.id}\`. Risk ${order.risk.grade}.`,
    'Nothing here was merged by a machine — marking it ready and merging are both yours.'
  )
  return lines.join('\n')
}

function bodyPathFor(root: string, order: WorkOrder, lane: number): string {
  return path.join(orderDir(root, order.id), `pull-request-lane-${lane}.md`)
}

function pullsPath(root: string, orderId: string): string {
  return path.join(orderDir(root, orderId), 'pulls.json')
}

/**
 * The drafts this order opened.
 *
 * Written down rather than held in memory because the operator's decision to
 * mark one ready arrives later — possibly after a restart — and "which pull
 * request" has to survive that. An unreadable file reads as none, which
 * refuses to mark anything ready rather than guessing at a URL.
 */
export async function readPulls(root: string, orderId: string): Promise<LanePullRequest[]> {
  try {
    const raw: unknown = JSON.parse(await fs.promises.readFile(pullsPath(root, orderId), 'utf8'))
    return Array.isArray(raw) ? (raw as LanePullRequest[]) : []
  } catch {
    return []
  }
}

async function writeBody(file: string, contents: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  await fs.promises.writeFile(file, contents, 'utf8')
}

/**
 * Push one lane's branch.
 *
 * `HEAD:<branch>` rather than the branch name alone so this works from a
 * detached head, which is what a worktree left mid-run can be.
 */
async function pushLane(
  repo: { name: string; path: string; headBranch: string },
  deps: IntegrateDeps
): Promise<void> {
  const result = await deps.exec({
    command: 'git',
    args: ['push', '--set-upstream', 'origin', `HEAD:${repo.headBranch}`],
    cwd: repo.path,
    timeoutMs: 120_000,
  })
  if (result.exitCode !== 0) throw new PushRefusedError(repo.name, result.stderr)
}

async function openDraft(
  order: WorkOrder,
  repo: { name: string; path: string; baseBranch: string; headBranch: string; lane: number },
  bodyPath: string,
  deps: IntegrateDeps
): Promise<LanePullRequest> {
  const result = await deps.exec({
    command: 'gh',
    args: [
      'pr',
      'create',
      '--draft',
      '--head',
      repo.headBranch,
      '--base',
      repo.baseBranch,
      '--title',
      order.title,
      // Never `--body`: a pull request body is long, multi-line, full of
      // backticks and written by an agent. Through argv that is a quoting bug
      // waiting for the one description that contains a quote.
      '--body-file',
      bodyPath,
    ],
    cwd: repo.path,
    timeoutMs: 120_000,
  })
  if (result.exitCode !== 0) {
    throw new PullRequestFailedError(
      `Opening the pull request for ${repo.name} failed`,
      result.stderr
    )
  }
  return {
    lane: repo.lane,
    repo: repo.name,
    cwd: repo.path,
    branch: repo.headBranch,
    url: result.stdout.trim().split('\n').pop()?.trim() ?? '',
    bodyPath,
  }
}

/** Turn a draft into a review request. The operator's decision, never ours. */
export async function markReady(
  pull: { url: string; cwd: string },
  deps: IntegrateDeps
): Promise<void> {
  const result = await deps.exec({
    command: 'gh',
    args: ['pr', 'ready', pull.url],
    cwd: pull.cwd,
    timeoutMs: 60_000,
  })
  if (result.exitCode !== 0) {
    throw new PullRequestFailedError(`Marking ${pull.url} ready failed`, result.stderr)
  }
}

/**
 * Ship the order: push, and open a draft per repository.
 *
 * The body is written whatever happens, including when the operator has turned
 * pushing off — what would have shipped is worth reading even when it did not.
 */
export async function shipOrder(
  order: WorkOrder,
  shipment: Shipment,
  deps: IntegrateDeps
): Promise<ShipOutcome> {
  const body = prBody(order, shipment)
  const repos = [...order.context.repos].sort((a, b) => a.lane - b.lane)
  const bodyPaths: string[] = []

  for (const repo of repos) {
    const file = bodyPathFor(deps.root, order, repo.lane)
    await writeBody(file, body)
    bodyPaths.push(file)
  }

  if (!deps.autoOpen) {
    const reason =
      'Opening a draft pull request is turned off, so nothing was pushed. The body is written and waiting.'
    await deps.record('ship.held', order.id, reason)
    return { pulls: [], bodyPaths, held: true, reason }
  }

  if (shipModeFor(order) === 'gate_then_push') {
    const gate = raiseGate({
      id: `${order.id}-ship`,
      rule: 'risk.p0',
      orderId: order.id,
      // The rule is named for the grade that made it unconditional; the grade
      // that actually fired is carried here, because at P1 the id alone would
      // read as wrong.
      summary: `Push and open a draft pull request for ${order.title}?`,
      why: `This order is graded ${order.risk.grade}, so the decision is taken before anything reaches the remote${order.risk.triggers.length === 0 ? '' : ` (${order.risk.triggers.join(', ')})`}.`,
      riskGrade: order.risk.grade,
      blockedUnits: order.plan.units.length,
      at: deps.now(),
    })
    const chosen = await deps.decide(gate)
    if (chosen !== 'approve') {
      const reason = `The ${order.risk.grade} shipping decision was answered "${chosen}", so nothing was pushed.`
      await deps.record('ship.held', order.id, reason)
      return { pulls: [], bodyPaths, held: true, reason }
    }
  }

  const pulls: LanePullRequest[] = []
  for (const repo of repos) {
    await pushLane(repo, deps)
    const pull = await openDraft(order, repo, bodyPathFor(deps.root, order, repo.lane), deps)
    pulls.push(pull)
    await deps.record('ship.draft_opened', pull.url, `Draft pull request for lane ${repo.lane}.`)
  }

  await fs.promises.writeFile(
    pullsPath(deps.root, order.id),
    JSON.stringify(pulls, null, 2),
    'utf8'
  )
  return { pulls, bodyPaths, held: false, reason: '' }
}
