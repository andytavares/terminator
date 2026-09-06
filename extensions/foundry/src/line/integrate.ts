import * as fs from 'node:fs'
import * as path from 'node:path'
import { orderDir } from '../data-root.js'
import { raiseGate } from '../gates/rules.js'
import { laneViews, mayMergeLane } from '../order/lanes.js'
import type { Gate } from '../gates/rules.js'
import type { WorkOrder } from '../order/schema.js'
import type { Verdict } from '../verify/verdict.js'
import type { LadderOutcome } from '../verify/ladder.js'

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
  /** Put the "mark it ready?" decision where the operator will see it. */
  readonly raiseGate?: (gate: Gate) => Promise<void>
}

export interface Shipment {
  readonly verdicts: readonly Verdict[]
  /** What the inspection found. Empty means it found nothing, not that it did not run. */
  readonly findings: readonly string[]
  /**
   * The verification climb, where there was one.
   *
   * Carried so the body can say which rungs never ran. A repository with no
   * lint command is allowed to ship a draft; it is not allowed to ship one
   * that implies it was linted.
   */
  readonly ladder?: LadderOutcome | null
  /**
   * The house rules this change was judged against (FR-042).
   *
   * Named on the decision and in the body, so "which rules were in force" is
   * answerable at review time rather than inferred from a directory listing.
   */
  readonly rulesInForce?: readonly string[]
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
  /** The "mark it ready?" decision, once there is a draft to mark. */
  readonly gate?: Gate
}

/** One line on how the criteria came out, for the gate's own reason. */
function criteriaSummary(shipment: Shipment): string {
  const results = shipment.verdicts.map((v) => v.result)
  const failed = results.filter((r) => r === 'fail').length
  const unmeasured = results.filter((r) => r === 'not_measured').length
  if (failed > 0) return `${failed} criteria failed`
  if (unmeasured > 0) return `${unmeasured} criteria not measured`
  return 'every criterion passed'
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
 * The lane section of a body: what else this change is part of.
 *
 * Only for an order that spans repositories. One lane produces no section at
 * all, because "1 of 1" on a pull request is noise (FR-068).
 */
function laneSection(order: WorkOrder, lane: number, opened: readonly LanePullRequest[]): string[] {
  if (order.plan.lanes.length < 2) return []

  const views = laneViews(order)
  const mine = views.find((view) => view.lane.ord === lane)
  const lines = ['', `### Part of a ${views.length}-repository change`, '']

  for (const view of views) {
    const url = opened.find((pull) => pull.lane === view.lane.ord)?.url
    const position =
      view.lane.ord === lane
        ? '**this one**'
        : (url ?? (view.lane.ord < lane ? 'merges before this' : 'merges after this'))
    lines.push(`${view.lane.ord}. \`${view.lane.repo}\` — ${position}`)
  }

  if (mine !== undefined && mine.collisions.length > 0) {
    lines.push(
      '',
      `Shared with the other lanes: ${mine.collisions.map((path) => `\`${path}\``).join(', ')}.`
    )
  }
  if (mine !== undefined && mine.blockedBy.length > 0) {
    const first = mine.blockedBy.join(', ')
    lines.push(`Do not merge this before lane ${first}.`)
  }
  return lines
}

/**
 * What a reviewer reads.
 *
 * A verdict per criterion, in a table, including the ones nothing checked —
 * FR-056 asks for every criterion, and "every" is the load-bearing word.
 */
export function prBody(
  order: WorkOrder,
  shipment: Shipment,
  lane = 1,
  opened: readonly LanePullRequest[] = []
): string {
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

  const ladder = shipment.ladder ?? null
  if (ladder !== null) {
    lines.push('', '### Verification', '', '| Rung | Step | Result |', '| --- | --- | --- |')
    for (const step of ladder.steps) {
      const result =
        step.result === 'not_measured' || step.result === 'elsewhere'
          ? `${step.result === 'elsewhere' ? 'decided' : 'not measured'} — ${step.reason}`
          : step.result
      lines.push(`| ${step.rung} | ${step.name} | ${result} |`)
    }
    if (ladder.unmeasured.length > 0) {
      lines.push(
        '',
        `**${ladder.unmeasured.length} ${ladder.unmeasured.length === 1 ? 'check was' : 'checks were'} not measured here**: ${ladder.unmeasured.join(', ')}. This repository has no command for them, so they are reported as unmeasured rather than as passing.`
      )
    }
  }

  if ((shipment.rulesInForce?.length ?? 0) > 0) {
    lines.push(
      '',
      `Judged against ${shipment.rulesInForce?.length} house ${shipment.rulesInForce?.length === 1 ? 'rule' : 'rules'}: ${shipment.rulesInForce?.join(', ')}.`
    )
  }

  lines.push('', '### Inspection', '')
  if (shipment.findings.length === 0) {
    lines.push('Nothing found.')
  } else {
    for (const finding of shipment.findings) lines.push(`- ${finding}`)
  }

  lines.push(...laneSection(order, lane, opened))

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
 * Ship the order: push, and open a draft per repository, in merge order.
 *
 * The body is written whatever happens, including when the operator has turned
 * pushing off — what would have shipped is worth reading even when it did not.
 *
 * Merge order matters here and only here: a consumer's draft is opened after
 * its producer's, so the consumer can carry the producer's URL and the
 * reviewer opens them in the order they land. Lanes that share nothing are
 * unordered and this loop costs them one comparison.
 */
export async function shipOrder(
  order: WorkOrder,
  shipment: Shipment,
  deps: IntegrateDeps
): Promise<ShipOutcome> {
  const repos = [...order.context.repos].sort((a, b) => a.lane - b.lane)
  const bodyPaths: string[] = []

  for (const repo of repos) {
    const file = bodyPathFor(deps.root, order, repo.lane)
    // Written before anything is pushed, so the operator can read what would
    // have shipped even when nothing does. Rewritten per lane afterwards once
    // the sibling URLs exist.
    await writeBody(file, prBody(order, shipment, repo.lane, []))
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
    // The lanes this one waits on are open by now — this loop runs in merge
    // order — so the cross-links in its body are real URLs rather than
    // "merges before this".
    const held = mayMergeLane(
      order,
      repo.lane,
      pulls.map((pull) => pull.lane)
    )
    const file = bodyPathFor(deps.root, order, repo.lane)
    await writeBody(file, prBody(order, shipment, repo.lane, pulls))

    await pushLane(repo, deps)
    const pull = await openDraft(order, repo, file, deps)
    pulls.push(pull)
    await deps.record(
      'ship.draft_opened',
      pull.url,
      held.allowed
        ? `Draft pull request for lane ${repo.lane}.`
        : `Draft pull request for lane ${repo.lane}, held from merging: ${held.reason ?? ''}`
    )
  }

  // Now every sibling URL exists, so the earlier lanes can name the later
  // ones. This has to go back to GitHub — `gh pr create` read the file once
  // and rewriting it afterwards changes a local file and nothing else, which
  // would leave lane 1 permanently saying "merges after this".
  //
  // Only where there is a sibling to link to, and never for the last lane,
  // whose body already had every URL when it was created.
  if (pulls.length > 1) {
    for (const pull of pulls.slice(0, -1)) {
      await writeBody(pull.bodyPath, prBody(order, shipment, pull.lane, pulls))
      const edited = await deps.exec({
        command: 'gh',
        args: ['pr', 'edit', pull.url, '--body-file', pull.bodyPath],
        cwd: pull.cwd,
        timeoutMs: 60_000,
      })
      // A failed cross-link is cosmetic. The drafts are open and the work is
      // pushed; losing that over a description would be the worse failure.
      if (edited.exitCode !== 0) {
        await deps.record(
          'ship.crosslink_failed',
          pull.url,
          `The cross-links could not be written back: ${edited.stderr.trim()}`
        )
      }
    }
  }

  await fs.promises.writeFile(
    pullsPath(deps.root, order.id),
    JSON.stringify(pulls, null, 2),
    'utf8'
  )

  // The decision the operator is finally offered (FR-057). Raised here rather
  // than by the executor because it is about the pull request, which does not
  // exist until now — and it is one of the four rules that stay live at every
  // autonomy setting, so a lights-out run reaches exactly this point and stops.
  const unmeasured = shipment.ladder?.unmeasured ?? []
  const rules = shipment.rulesInForce ?? []
  const gate = raiseGate({
    id: `${order.id}-ready`,
    rule: 'ready-for-review',
    orderId: order.id,
    summary: `Mark ${pulls.length === 1 ? 'the draft' : `${pulls.length} drafts`} for ${order.title} ready?`,
    why: [
      `${order.plan.units.length} units, ${criteriaSummary(shipment)}.`,
      unmeasured.length === 0
        ? 'Everything this repository can check was checked.'
        : `Not measured here: ${unmeasured.join(', ')}.`,
      shipment.findings.length === 0
        ? 'The inspection found nothing.'
        : `The inspection found ${shipment.findings.length}.`,
      rules.length === 0 ? '' : `Judged against: ${rules.join(', ')}.`,
    ]
      .filter((line) => line !== '')
      .join(' '),
    evidence: pulls.map((pull) => ({ kind: 'report_file' as const, path: pull.bodyPath })),
    riskGrade: order.risk.grade,
    blockedUnits: 0,
    at: deps.now(),
  })
  await deps.raiseGate?.(gate)
  await deps.record('ship.ready_asked', order.id, gate.why)

  return { pulls, bodyPaths, held: false, reason: '', gate }
}
