import { commitWorktree } from './commit.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { orderDir } from '../data-root.js'
import { raiseGate } from '../gates/rules.js'
import { laneViews, mayMergeLane } from '../order/lanes.js'
import { branchFor, checkoutPath } from './worktree.js'
import type { Gate } from '../gates/rules.js'
import type { WorkOrder } from '../order/schema.js'
import type { Verdict } from '../verify/verdict.js'
import { PICTURES_STEP_NAME } from '../verify/ladder.js'
import type { LadderOutcome } from '../verify/ladder.js'
import type { CiOutcome } from './ship-tail.js'
import { gradeInWords } from '../runtime/review/risk-grade.js'

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

/** The grades whose decision is taken before anything is pushed. @internal */
export const GATED_GRADES = ['P0', 'P1'] as const

export type ShipMode = 'gate_then_push' | 'push_then_gate'

export interface ExecResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

/** What to say when a step ran out of time, so it is never read as a refusal or a pass. */
export function timeoutNotice(what: string, timeoutMs: number): string {
  return `${what} timed out after ${Math.round(timeoutMs / 1000)} seconds`
}

/** Long enough for a slow remote, short enough that a hung one is noticed. */
export const NETWORK_STEP_TIMEOUT_MS = 120_000

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
  /**
   * Watch the drafts' CI before the ready-for-review gate is raised (D2).
   *
   * Absent means shipping behaves exactly as it did before CI was watched at
   * all — no watching, no note on the gate, nothing withheld.
   */
  readonly watchCi?: (pulls: readonly LanePullRequest[]) => Promise<CiOutcome>
  /**
   * Every lane's draft is open and `pulls.json` is written; the CI watch has
   * not started. A failure here never affects shipping.
   */
  readonly onDraftOpened?: (pulls: readonly LanePullRequest[]) => Promise<void>
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
  /**
   * Whether the inspector ran, and why not when it did not. Absent means not
   * known, which reads as the older "no findings" rather than as a skip.
   */
  readonly inspection?: { readonly ran: boolean; readonly reason: string }
  /** Checks that already failed on the base branch before this change, by name. */
  readonly failingOnBase?: readonly string[]
  /** Checks that failed and passed on one commit and that the operator chose to ship with. */
  readonly knownFlaky?: readonly KnownFlaky[]
}

export interface KnownFlaky {
  readonly step: string
  readonly command: string | null
  /** The failing run's log, then the passing run's. */
  readonly logs: readonly string[]
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

/** One bullet per criterion; a run that judged nothing says so instead of passing. */
function acceptanceLines(order: WorkOrder, shipment: Shipment): string[] {
  if (shipment.verdicts.length === 0) {
    return ['- No verdicts were recorded. The criteria were not judged.']
  }
  return order.acceptance.map((criterion) => {
    const worst = worstVerdict(criterion.id, shipment.verdicts)
    const outcome =
      worst === undefined
        ? 'not measured: nothing ran'
        : worst.result === 'pass'
          ? 'passed'
          : `${worst.result === 'fail' ? 'failed' : 'not measured'}: ${worst.reason}`
    return `- ${criterion.id}: ${criterion.statement} — ${outcome}`
  })
}

/** What the inspection did, one bullet per fact. */
function inspectionLines(shipment: Shipment): string[] {
  if (shipment.inspection?.ran === false) return [`- Not run: ${shipment.inspection.reason}`]
  if (shipment.findings.length === 0) return ['- Found nothing.']
  return shipment.findings.map((finding) => `- ${finding}`)
}

/** "Tests come first (every unit)" becomes "Tests come first · every unit". */
function ruleBullet(rule: string): string {
  return `- ${rule.replace(/ \(([^()]*)\)$/, ' · $1')}`
}

/**
 * The reason to show for a failed `git`/`gh` call.
 *
 * `gh pr create` can fail with nothing on stderr and its actual reason on
 * stdout instead (e.g. "a pull request for branch ... already exists"), and
 * some failures print nothing at all — stderr alone left the operator with a
 * message ending in ": " and no reason.
 */
function detailFor(result: ExecResult): string {
  if (result.timedOut) return timeoutNotice('the command', NETWORK_STEP_TIMEOUT_MS)
  const stderr = result.stderr.trim()
  if (stderr !== '') return stderr
  const stdout = result.stdout.trim()
  if (stdout !== '') return stdout
  return `exit code ${result.exitCode}`
}

/** @internal */
export class PushRefusedError extends Error {
  readonly code = 'PUSH_REFUSED'
  constructor(repo: string, result: ExecResult) {
    super(
      `Pushing ${repo} ${result.timedOut ? 'failed' : 'was refused'}, so no pull request was opened: ${detailFor(result)}`
    )
    this.name = 'PushRefusedError'
  }
}

class PullRequestFailedError extends Error {
  readonly code = 'PR_FAILED'
  constructor(what: string, result: ExecResult) {
    super(`${what}: ${detailFor(result)}`)
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

/** fail beats not measured beats the first; undefined when nothing was judged. */
function worstVerdict(criterionId: string, verdicts: readonly Verdict[]): Verdict | undefined {
  const found = verdicts.filter((v) => v.criterionId === criterionId)
  return (
    found.find((v) => v.result === 'fail') ??
    found.find((v) => v.result === 'not_measured') ??
    found[0]
  )
}

function verdictLine(order: WorkOrder, criterionId: string, verdicts: readonly Verdict[]): string {
  const statement = order.acceptance.find((c) => c.id === criterionId)?.statement ?? ''
  const worst = worstVerdict(criterionId, verdicts)

  // No verdict is "not measured", never a pass. This is the same rule the
  // ladder enforces, said again at the surface a reviewer actually reads —
  // a criterion silently omitted from this table is how an unchecked change
  // gets approved.
  if (worst === undefined) return `| ${criterionId} | ${statement} | not measured | nothing ran |`

  const result = worst.result === 'not_measured' ? 'not measured' : worst.result
  return `| ${criterionId} | ${statement} | ${result} | ${worst.reason} |`
}

/** Which lane a body is for, and the drafts already open beside it. */
interface BodyPlace {
  readonly lane: number
  readonly opened: readonly LanePullRequest[]
}

const FIRST_LANE: BodyPlace = { lane: 1, opened: [] }

/**
 * The lane section of a body: what else this change is part of.
 *
 * Only for an order that spans repositories. One lane produces no section at
 * all, because "1 of 1" on a pull request is noise (FR-068).
 */
function laneSection(order: WorkOrder, { lane, opened }: BodyPlace): string[] {
  if (order.plan.lanes.length < 2) return []

  const views = laneViews(order)
  const lines = ['', `### Part of a ${views.length}-repository change`, '']
  for (const view of views) {
    lines.push(
      `${view.lane.ord}. \`${view.lane.repo}\` — ${lanePosition(view.lane.ord, { lane, opened })}`
    )
  }
  return [...lines, ...laneWarnings(views.find((view) => view.lane.ord === lane))]
}

/** Where another lane stands from this one: this one, its draft, or before or after it. */
function lanePosition(ord: number, { lane, opened }: BodyPlace): string {
  if (ord === lane) return '**this one**'
  const url = opened.find((pull) => pull.lane === ord)?.url
  return url ?? (ord < lane ? 'merges before this' : 'merges after this')
}

function laneWarnings(mine: ReturnType<typeof laneViews>[number] | undefined): string[] {
  if (mine === undefined) return []
  const lines: string[] = []
  if (mine.collisions.length > 0) {
    lines.push(
      '',
      `Shared with the other lanes: ${mine.collisions.map((path) => `\`${path}\``).join(', ')}.`
    )
  }
  if (mine.blockedBy.length > 0)
    lines.push(`Do not merge this before lane ${mine.blockedBy.join(', ')}.`)
  return lines
}

/**
 * What a reviewer reads.
 *
 * A verdict per criterion, in a table, including the ones nothing checked —
 * FR-056 asks for every criterion, and "every" is the load-bearing word.
 * @internal
 */
export function prBody(
  order: WorkOrder,
  shipment: Shipment,
  place: BodyPlace = FIRST_LANE
): string {
  return [
    ...introLines(order),
    ...verdictTable(order, shipment),
    ...leftForYouLines(order, shipment),
    ...verificationLines(shipment.ladder ?? null),
    ...rulesLines(shipment.rulesInForce ?? []),
    '',
    '### Inspection',
    '',
    ...inspectionLines(shipment),
    ...laneSection(order, place),
    '',
    '---',
    '',
    `Opened as a draft by Foundry from work order \`${order.id}\`. Risk ${order.risk.grade}.`,
    'Nothing here was merged by a machine — marking it ready and merging are both yours.',
  ].join('\n')
}

function introLines(order: WorkOrder): string[] {
  const units = order.plan.units.map((unit) => `- **${unit.id}** ${unit.title} — ${unit.role}`)
  return [
    `## ${order.title}`,
    '',
    order.intent.problem === '' ? '_No problem statement._' : order.intent.problem,
    '',
    order.intent.outcome === '' ? '' : `**Outcome.** ${order.intent.outcome}`,
    '',
    '### What was done',
    '',
    ...(units.length === 0 ? ['_No units._'] : units),
  ]
}

function verdictTable(order: WorkOrder, shipment: Shipment): string[] {
  const rows = order.acceptance.map((criterion) =>
    verdictLine(order, criterion.id, shipment.verdicts)
  )
  return [
    '',
    '### Verdicts',
    '',
    '| | Criterion | Result | Notes |',
    '| --- | --- | --- | --- |',
    ...(rows.length === 0 ? ['| — | _No criteria._ | not measured | |'] : rows),
  ]
}

/** Every item that still needs a person, from what the order and shipment already hold. */
function leftForYouLines(order: WorkOrder, shipment: Shipment): string[] {
  const failing = order.acceptance.filter(
    (criterion) => worstVerdict(criterion.id, shipment.verdicts)?.result !== 'pass'
  )
  const items = [
    ...failing.map((criterion) => criterionItem(criterion, shipment.verdicts)),
    ...unmeasuredStepItems(shipment.ladder ?? null),
    ...failingOnBaseItems(order, shipment.failingOnBase ?? []),
    ...knownFlakyItems(shipment.knownFlaky ?? []),
    ...pendingDecisionItems(order),
  ]
  const bullets = items.length === 0 ? [] : ['', ...items]
  return [
    '',
    "### What's left for you",
    '',
    summaryOf(order, failing.length, items.length),
    ...bullets,
  ]
}

function summaryOf(order: WorkOrder, failingCount: number, itemCount: number): string {
  if (itemCount === 0) return 'Nothing. Every criterion passed and nothing is pending.'
  const total = order.acceptance.length
  const passing = `**${total - failingCount} of ${total}** criteria pass.`
  return failingCount === 0
    ? `${passing} These still need you:`
    : `${passing} ${failingCount} need you.`
}

function criterionItem(
  criterion: WorkOrder['acceptance'][number],
  verdicts: readonly Verdict[]
): string {
  const worst = worstVerdict(criterion.id, verdicts)
  const head = `- **${criterion.id}** ${criterion.statement}:`
  if (worst?.result === 'fail') return `${head} failed. ${worst.reason}`
  return `${head} not measured. ${worst?.reason || 'nothing ran'}`
}

function unmeasuredStepItems(ladder: LadderOutcome | null): string[] {
  return (ladder?.steps ?? [])
    .filter((step) => step.result === 'not_measured')
    .map((step) => `- **${step.name}**: not measured. ${step.reason}`)
}

function failingOnBaseItems(order: WorkOrder, names: readonly string[]): string[] {
  const base = order.context.repos[0]?.baseBranch ?? 'the base branch'
  return names.map(
    (name) => `- **${name}**: fails on ${base} before this change. Not this pull request's to fix.`
  )
}

function knownFlakyItems(flaky: readonly KnownFlaky[]): string[] {
  return flaky.map((f) => {
    const command = f.command === null ? '' : ` (\`${f.command}\`)`
    return `- **Known flaky**: ${f.step}${command} failed and passed on the same commit. Logs: ${f.logs.join(' and ')}`
  })
}

function pendingDecisionItems(order: WorkOrder): string[] {
  return [
    ...order.redTeam
      .filter((finding) => finding.status === 'accepted')
      .map((f) => `- **${f.id}** accepted by you: ${f.text}. Reason: ${f.reason}`),
    ...order.assumptions
      .filter((assumption) => !assumption.struck)
      .map((a) => `- **${a.id}** assumed: ${a.text}. Nobody struck it.`),
    ...order.openQuestions
      .filter((question) => question.answer === null)
      .map((q) => `- **${q.id}** still open: ${q.text}`),
  ]
}

function verificationLines(ladder: LadderOutcome | null): string[] {
  if (ladder === null) return []
  const rows = ladder.steps.map((step) => {
    const result =
      step.result === 'not_measured' || step.result === 'elsewhere'
        ? `${step.result === 'elsewhere' ? 'decided' : 'not measured'} — ${step.reason}`
        : step.result
    return `| ${step.name} | ${step.rung} | ${result} |`
  })
  const lines = [
    '',
    '### Verification',
    '',
    '| Step | Rung | Result |',
    '| --- | --- | --- |',
    ...rows,
    ...picturesLines(ladder),
  ]
  const count = ladder.unmeasured.length
  if (count === 0) return lines
  return [
    ...lines,
    '',
    `**${count} ${count === 1 ? 'check was' : 'checks were'} not measured here**: ${ladder.unmeasured.join(', ')}. This repository has no command for them, so they are reported as unmeasured rather than as passing.`,
  ]
}

// The images are named, not embedded: GitHub has no public API to upload an image into a
// pull request body (attachments are web-UI only), and the repository is never given them.
function picturesLines(ladder: LadderOutcome): string[] {
  const step = ladder.steps.find((s) => s.name === PICTURES_STEP_NAME)
  if (step === undefined) return []
  if (step.pictures === undefined) return ['', `Pictures: not measured — ${step.reason}`]
  const { folder, images } = step.pictures
  return [
    '',
    `Pictures: ${images.length} ${images.length === 1 ? 'image' : 'images'}, kept in \`${folder}\`.`,
  ]
}

function rulesLines(rules: readonly string[]): string[] {
  if (rules.length === 0) return []
  return [
    '',
    `Judged against ${rules.length} house ${rules.length === 1 ? 'rule' : 'rules'}: ${rules.join(', ')}.`,
  ]
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

/** Writes `body` to the pull request's body file and has gh put it on the pull request. */
async function rewriteBody(pull: LanePullRequest, body: string, deps: IntegrateDeps) {
  await writeBody(pull.bodyPath, body)
  return deps.exec({
    command: 'gh',
    args: ['pr', 'edit', pull.url, '--body-file', pull.bodyPath],
    cwd: pull.cwd,
    timeoutMs: 60_000,
  })
}

/** A question about the order's open drafts, which are its evidence. */
interface DraftsAsk {
  readonly id: string
  readonly rule: Parameters<typeof raiseGate>[0]['rule']
  readonly summary: string
  readonly why: string
  readonly pulls: readonly LanePullRequest[]
  /** What the ledger records once the gate is raised. */
  readonly action: string
}

async function raiseOnDrafts(ask: DraftsAsk, order: WorkOrder, deps: IntegrateDeps) {
  const gate = raiseGate({
    id: ask.id,
    rule: ask.rule,
    orderId: order.id,
    summary: ask.summary,
    why: ask.why,
    evidence: ask.pulls.map((pull) => ({ kind: 'report_file' as const, path: pull.bodyPath })),
    riskGrade: order.risk.grade,
    blockedUnits: 0,
    at: deps.now(),
  })
  await deps.raiseGate?.(gate)
  await deps.record(ask.action, order.id, gate.why)
  return gate
}

/**
 * The branch and checkout path each lane is actually on, in lane order.
 *
 * `context.repos[].headBranch` is initialised empty and written by nothing,
 * so reading it raw pushed `HEAD:` and asked for a pull request with
 * `--head ''` — which every mocked-exec test accepted as a fine argument
 * list, and which the first real `git` refused outright.
 *
 * And the *path* the same way, for the same reason one layer down.
 * `context.repos[].path` is the repository, where `main` is checked out; the
 * work is in the lane's worktree. Pushing `HEAD:<branch>` from the repository
 * pushes `main` — so the branch reached the remote at exactly the commit it
 * was cut from, and GitHub answered the pull request with "No commits between
 * main and foundry/wo-live-run". Watched on a live run that had done
 * everything else right: the builder's commit was sitting in the worktree the
 * push never looked at.
 */
function resolvedRepos(order: WorkOrder, deps: IntegrateDeps) {
  return [...order.context.repos]
    .sort((a, b) => a.lane - b.lane)
    .map((repo) => ({
      ...repo,
      headBranch: branchFor(order, repo.lane),
      path: checkoutPath(deps.root, order, repo.name),
    }))
}

/**
 * Push every lane's branch, for a fix round updating drafts that already
 * exist. No draft is opened here — the pull requests are already open, and
 * this only moves the commits a fix round produced onto their branches.
 */
export async function pushLanes(order: WorkOrder, deps: IntegrateDeps): Promise<void> {
  for (const repo of resolvedRepos(order, deps)) {
    await pushLane(repo, deps)
  }
}

/**
 * Commit what a step wrote into each lane's checkout, and push the lanes that
 * gained a commit. Returns whether anything was committed.
 */
export async function commitAndPushLanes(
  order: WorkOrder,
  message: string,
  deps: IntegrateDeps
): Promise<boolean> {
  let any = false
  for (const repo of resolvedRepos(order, deps)) {
    if ((await commitWorktree(repo.path, message, deps.exec)).kind === 'committed') {
      any = true
      await pushLane(repo, deps)
    }
  }
  return any
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
    timeoutMs: NETWORK_STEP_TIMEOUT_MS,
  })
  if (result.exitCode !== 0 || result.timedOut) throw new PushRefusedError(repo.name, result)
}

type ResolvedRepo = ReturnType<typeof resolvedRepos>[number]

/** One lane's draft to open: the repository it is for and the body file it carries. */
interface DraftTarget {
  readonly repo: Pick<ResolvedRepo, 'name' | 'path' | 'baseBranch' | 'headBranch' | 'lane'>
  readonly bodyPath: string
}

function laneDraft({ repo, bodyPath }: DraftTarget, url: string): LanePullRequest {
  return {
    lane: repo.lane,
    repo: repo.name,
    cwd: repo.path,
    branch: repo.headBranch,
    url,
    bodyPath,
  }
}

async function openDraft(
  order: WorkOrder,
  target: DraftTarget,
  deps: IntegrateDeps
): Promise<LanePullRequest> {
  const { repo, bodyPath } = target
  const result = await deps.exec({
    command: 'gh',
    args: [
      ...['pr', 'create', '--draft', '--head', repo.headBranch, '--base', repo.baseBranch],
      ...['--title', order.title],
      // Never `--body`: a pull request body is long, multi-line, full of
      // backticks and written by an agent. Through argv that is a quoting bug
      // waiting for the one description that contains a quote.
      ...['--body-file', bodyPath],
    ],
    cwd: repo.path,
    timeoutMs: 120_000,
  })
  if (result.exitCode !== 0) {
    throw new PullRequestFailedError(`Opening the pull request for ${repo.name} failed`, result)
  }
  return laneDraft(target, result.stdout.trim().split('\n').pop()?.trim() ?? '')
}

/**
 * A pull request already open for this lane's branch, if there is one.
 *
 * An agent can open one before shipping runs, and `gh pr create` refuses a
 * second for the same branch on every retry. A failed or unreadable lookup is
 * "none": creating is still the right next move, and it reports its own error.
 */
async function findOpenPull(
  repo: { path: string; baseBranch: string; headBranch: string },
  deps: IntegrateDeps
): Promise<OpenPull | null> {
  const result = await deps.exec({
    command: 'gh',
    args: [
      ...['pr', 'list', '--head', repo.headBranch, '--base', repo.baseBranch],
      ...['--state', 'open', '--json', 'url,number,isDraft'],
    ],
    cwd: repo.path,
    timeoutMs: 60_000,
  })
  return result.exitCode === 0 ? firstOpenPull(result.stdout) : null
}

interface OpenPull {
  readonly url: string
  readonly isDraft: boolean
}

function firstOpenPull(stdout: string): OpenPull | null {
  try {
    const listed: unknown = JSON.parse(stdout)
    if (!Array.isArray(listed)) return null
    const first = listed[0] as { url?: unknown; isDraft?: unknown } | undefined
    if (typeof first?.url !== 'string' || first.url === '') return null
    return { url: first.url, isDraft: first.isDraft === true }
  } catch {
    return null
  }
}

/**
 * Take over a pull request somebody else opened on the lane's branch: give it
 * Foundry's title and body, and return it to draft. Neither step stops
 * shipping — the pull request exists either way, and conversion to draft
 * depends on the GitHub plan.
 */
async function adoptPull(
  order: WorkOrder,
  target: DraftTarget & { open: OpenPull },
  deps: IntegrateDeps
): Promise<LanePullRequest> {
  const { repo, bodyPath, open } = target
  const edit = ['pr', 'edit', open.url, '--title', order.title, '--body-file', bodyPath]
  await ghOrRecord(deps, { cwd: repo.path, args: edit, failed: 'ship.adopt_edit_failed' }, open.url)
  if (!open.isDraft) {
    const undo = ['pr', 'ready', '--undo', open.url]
    await ghOrRecord(deps, { cwd: repo.path, args: undo, failed: 'ship.undraft_failed' }, open.url)
  }
  return laneDraft(target, open.url)
}

/** Runs one `gh` call that must not stop shipping, recording why when it fails. */
async function ghOrRecord(
  deps: IntegrateDeps,
  call: { cwd: string; args: string[]; failed: string },
  subject: string
): Promise<void> {
  const result = await deps.exec({
    command: 'gh',
    args: call.args,
    cwd: call.cwd,
    timeoutMs: 60_000,
  })
  if (result.exitCode !== 0) await deps.record(call.failed, subject, detailFor(result))
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
    throw new PullRequestFailedError(`Marking ${pull.url} ready failed`, result)
  }
}

/** The drafts an order has open, and the body file each was given. */
export interface OpenDrafts {
  readonly pulls: readonly LanePullRequest[]
  readonly bodyPaths: readonly string[]
}

/** One order's shipping: what it is, what it shipped with, and the seams it ships through. */
interface Shipping {
  readonly order: WorkOrder
  readonly shipment: Shipment
  readonly deps: IntegrateDeps
}

/**
 * Open the order's drafts: push, and open a draft per repository, in merge
 * order. Nothing here watches CI or raises the ready question — see
 * `watchAndFinish`, which is the other half of `shipOrder`.
 *
 * A lane that already has a draft in `pulls.json` — the order came back round
 * after a send-back, or a resumed run reached the tail again — is pushed to
 * and left as it is: a second `gh pr create` for the same branch is refused.
 * `onDraftOpened` fires only when a draft was actually created or adopted here.
 *
 * A lane not in `pulls.json` may still have a pull request open on its branch
 * — an agent can open one before shipping runs, and `gh pr create` refuses a
 * second. That one is adopted: retitled, given the body, returned to draft.
 *
 * The body is written whatever happens, including when the operator has turned
 * pushing off — what would have shipped is worth reading even when it did not.
 *
 * Merge order matters here and only here: a consumer's draft is opened after
 * its producer's, so the consumer can carry the producer's URL and the
 * reviewer opens them in the order they land. Lanes that share nothing are
 * unordered and this loop costs them one comparison.
 */
export async function openDrafts(
  order: WorkOrder,
  shipment: Shipment,
  deps: IntegrateDeps
): Promise<ShipOutcome> {
  const ship: Shipping = { order, shipment, deps }
  const repos = resolvedRepos(order, deps)
  const bodyPaths = await writeFirstBodies(ship, repos)
  const reason = await heldBeforePush(order, deps)
  if (reason !== null) {
    await deps.record('ship.held', order.id, reason)
    return { pulls: [], bodyPaths, held: true, reason }
  }

  const { pulls, created } = await openLanes(ship, repos)
  if (created > 0 && pulls.length > 1) await crossLink(ship, pulls)
  await fs.promises.writeFile(
    pullsPath(deps.root, order.id),
    JSON.stringify(pulls, null, 2),
    'utf8'
  )
  if (created > 0) {
    try {
      await deps.onDraftOpened?.(pulls)
    } catch {
      // Telling a tracker is never worth the drafts that are already open.
    }
  }
  return { pulls, bodyPaths, held: false, reason: '' }
}

// Written before anything is pushed, so the operator can read what would have shipped
// even if nothing does; rewritten per lane once the sibling URLs exist.
async function writeFirstBodies(
  { order, shipment, deps }: Shipping,
  repos: readonly ResolvedRepo[]
): Promise<string[]> {
  const bodyPaths: string[] = []
  for (const repo of repos) {
    const file = bodyPathFor(deps.root, order, repo.lane)
    await writeBody(file, prBody(order, shipment, { lane: repo.lane, opened: [] }))
    bodyPaths.push(file)
  }
  return bodyPaths
}

/** Why nothing may be pushed yet, or null when the drafts can open now. */
async function heldBeforePush(order: WorkOrder, deps: IntegrateDeps): Promise<string | null> {
  if (!deps.autoOpen) {
    return 'Opening a draft pull request is turned off, so nothing was pushed. The body is written and waiting.'
  }
  if (shipModeFor(order) === 'push_then_gate') return null
  const chosen = await deps.decide(pushGate(order, deps.now()))
  if (chosen === 'approve') return null
  return `The ${gradeInWords(order.risk.grade)} shipping decision is waiting on you, so nothing was pushed yet.`
}

function pushGate(order: WorkOrder, at: string): Gate {
  const triggers = order.risk.triggers.length === 0 ? '' : ` (${order.risk.triggers.join(', ')})`
  return raiseGate({
    id: `${order.id}-ship`,
    rule: 'risk.p0',
    orderId: order.id,
    // The rule is named for the grade that made it unconditional; the grade
    // that actually fired is carried here, because at P1 the id alone would
    // read as wrong.
    summary: `Push and open a draft pull request for ${order.title}?`,
    why: `This order is graded ${gradeInWords(order.risk.grade)}, so the decision is taken before anything reaches the remote${triggers}.`,
    riskGrade: order.risk.grade,
    blockedUnits: order.plan.units.length,
    at,
  })
}

/** Every lane's draft, in merge order: kept, adopted or opened. */
async function openLanes(
  ship: Shipping,
  repos: readonly ResolvedRepo[]
): Promise<{ pulls: LanePullRequest[]; created: number }> {
  const existing = await readPulls(ship.deps.root, ship.order.id)
  const pulls: LanePullRequest[] = []
  let created = 0
  for (const repo of repos) {
    const already = existing.find((pull) => pull.lane === repo.lane)
    if (already !== undefined) {
      await pushLane(repo, ship.deps)
      pulls.push(already)
    } else {
      pulls.push(await openLane(ship, { repo, opened: pulls }))
      created += 1
    }
  }
  return { pulls, created }
}

// Push one lane and open its draft, or adopt the one open on its branch. Lanes run in
// merge order, so the ones it waits on are open and its cross-links are real URLs.
async function openLane(
  { order, shipment, deps }: Shipping,
  { repo, opened }: { repo: ResolvedRepo; opened: readonly LanePullRequest[] }
): Promise<LanePullRequest> {
  const bodyPath = bodyPathFor(deps.root, order, repo.lane)
  await writeBody(bodyPath, prBody(order, shipment, { lane: repo.lane, opened }))
  await pushLane(repo, deps)
  const open = await findOpenPull(repo, deps)
  if (open !== null) {
    const adopted = await adoptPull(order, { repo, bodyPath, open }, deps)
    await deps.record(
      'ship.draft_adopted',
      adopted.url,
      `A pull request was already open on ${repo.headBranch}; Foundry adopted it instead of opening another.`
    )
    return adopted
  }
  const pull = await openDraft(order, { repo, bodyPath }, deps)
  await deps.record('ship.draft_opened', pull.url, openedNote(order, { repo, opened }))
  return pull
}

/** The ledger's note for a draft just opened, saying when the lane may not merge yet. */
function openedNote(
  order: WorkOrder,
  { repo, opened }: { repo: ResolvedRepo; opened: readonly LanePullRequest[] }
): string {
  const held = mayMergeLane(
    order,
    repo.lane,
    opened.map((pull) => pull.lane)
  )
  return held.allowed
    ? `Draft pull request for lane ${repo.lane}.`
    : `Draft pull request for lane ${repo.lane}, held from merging: ${held.reason ?? ''}`
}

// With every sibling URL known, earlier lanes name the later ones on GitHub itself:
// `gh pr create` read the body file once, so editing it later changes nothing there.
// Never for the last lane, which had every URL when created.
async function crossLink({ order, shipment, deps }: Shipping, pulls: readonly LanePullRequest[]) {
  for (const pull of pulls.slice(0, -1)) {
    const body = prBody(order, shipment, { lane: pull.lane, opened: pulls })
    const edited = await rewriteBody(pull, body, deps)
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

/**
 * Rewrite each draft's body from a shipment that now knows more — the final
 * check ran after the drafts opened, so the first body carried no verification
 * table. A failed edit is cosmetic and recorded, like a failed cross-link.
 */
export async function refreshBodies(
  order: WorkOrder,
  { shipment, pulls }: { shipment: Shipment; pulls: readonly LanePullRequest[] },
  deps: IntegrateDeps
): Promise<void> {
  for (const pull of pulls) {
    const body = prBody(order, shipment, { lane: pull.lane, opened: pulls })
    const edited = await rewriteBody(pull, body, deps)
    if (edited.exitCode !== 0) {
      await deps.record(
        'ship.body_refresh_failed',
        pull.url,
        `The body could not be updated: ${edited.stderr.trim()}`
      )
    }
  }
}

/**
 * Ship the order: open the drafts, watch their CI, then ask whether to mark
 * them ready.
 */
export async function shipOrder(
  order: WorkOrder,
  shipment: Shipment,
  deps: IntegrateDeps
): Promise<ShipOutcome> {
  const opened = await openDrafts(order, shipment, deps)
  if (opened.held) return opened
  return watchAndFinish(order, { shipment, drafts: opened }, deps)
}

/** Watch the drafts' CI, then `finishShipping`. */
export async function watchAndFinish(
  order: WorkOrder,
  { shipment, drafts }: { shipment: Shipment; drafts: OpenDrafts },
  deps: IntegrateDeps
): Promise<ShipOutcome> {
  // Watched before the ready-for-review gate is raised (D2): a draft whose
  // CI has not been watched, or is still red, is not "ready for review" —
  // it is a fix round away, or the automatic rounds already ran and it needs
  // the operator, not a gate that reads as if the work were done.
  const ci: CiOutcome = deps.watchCi ? await deps.watchCi(drafts.pulls) : { kind: 'none' }
  return finishShipping(order, { shipment, drafts, ci }, deps)
}

/** How shipping came out: what shipped, the drafts it opened, and what CI said of them. */
export interface ShippedDrafts {
  readonly shipment: Shipment
  readonly drafts: OpenDrafts
  readonly ci: CiOutcome
}

/**
 * The last step of shipping, once a CI outcome is known: raise the gate the
 * outcome calls for, or none at all for a halted run.
 *
 * Pulled out of `shipOrder` so a fix round for a `ci.red` gate — reached
 * directly from the inbox rather than through a fresh run of the recipe —
 * can produce the same gate from the same rules, instead of a second copy of
 * this logic drifting from the first.
 */
export async function finishShipping(
  order: WorkOrder,
  shipped: ShippedDrafts,
  deps: IntegrateDeps
): Promise<ShipOutcome> {
  const { drafts, ci } = shipped
  const { pulls, bodyPaths } = drafts
  if (ci.kind === 'halted') {
    // The run that halted raised its own gate; raising another here would
    // be a second interruption for the one thing that already stopped.
    await deps.record('ship.ci_halted', order.id, ci.reason)
    return { pulls, bodyPaths, held: true, reason: ci.reason }
  }
  if (ci.kind === 'red') {
    const gate = await raiseOnDrafts(ciRedAsk(order, { pulls, ci }), order, deps)
    return { pulls, bodyPaths, held: true, reason: gate.why, gate }
  }
  // The decision the operator is finally offered (FR-057). Raised here rather
  // than by the executor because it is about the pull request, which does not
  // exist until now — and it is one of the four rules that stay live at every
  // autonomy setting, so a lights-out run reaches exactly this point and stops.
  const gate = await raiseOnDrafts(readyAsk(order, shipped), order, deps)
  return { pulls, bodyPaths, held: false, reason: '', gate }
}

function ciRedAsk(
  order: WorkOrder,
  { pulls, ci }: { pulls: readonly LanePullRequest[]; ci: Extract<CiOutcome, { kind: 'red' }> }
): DraftsAsk {
  const names = ci.checks
    .filter((check) => check.bucket === 'fail' || check.bucket === 'cancel')
    .map((check) => check.name)
    .join(', ')
  const tail = ci.excerpt.split('\n').slice(-20).join('\n')
  return {
    id: `${order.id}-ci-red`,
    rule: 'ci.red',
    summary: `CI is still red on ${names} for ${order.title}`,
    why: `**${ci.rounds} automatic rounds ran and CI is still red.**\n\n\`\`\`\n${tail}\n\`\`\``,
    pulls,
    action: 'ship.ci_red',
  }
}

function readyAsk(order: WorkOrder, { shipment, drafts, ci }: ShippedDrafts): DraftsAsk {
  const { pulls } = drafts
  return {
    id: `${order.id}-ready`,
    rule: 'ready-for-review',
    summary: `Mark ${pulls.length === 1 ? 'the draft' : `${pulls.length} drafts`} for ${order.title} ready?`,
    why: readyWhy(order, shipment, ciNoteFor(ci)),
    pulls,
    action: 'ship.ready_asked',
  }
}

function ciNoteFor(ci: CiOutcome): string {
  if (ci.kind === 'green') return `CI passed: ${ci.checks.length} checks.`
  if (ci.kind === 'not_measured') return `CI not measured: ${ci.reason}.`
  return ''
}

function readyWhy(order: WorkOrder, shipment: Shipment, ciNote: string): string {
  const units = order.plan.units.length
  const unmeasured = shipment.ladder?.unmeasured ?? []
  const rules = shipment.rulesInForce ?? []
  return [
    `**${units} ${units === 1 ? 'unit' : 'units'}.**${ciNote === '' ? '' : ` ${ciNote}`}`,
    '### Acceptance\n\n' + acceptanceLines(order, shipment).join('\n'),
    '### Inspection\n\n' + inspectionLines(shipment).join('\n'),
    unmeasured.length === 0
      ? ''
      : '### Not measured here\n\n' + unmeasured.map((name) => `- ${name}`).join('\n'),
    rules.length === 0 ? '' : '### Judged against\n\n' + rules.map(ruleBullet).join('\n'),
  ]
    .filter((block) => block !== '')
    .join('\n\n')
}
