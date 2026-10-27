import type { ShellExec } from '../line/integrate.js'
import type { SensedItem, SensorSource } from './types.js'

// Collectors turn one sensor source into sensed items. Every command they run
// is read-only (`gh`, `git`); a failure is a fact about the environment, not
// a bug in the sensor, so it becomes a one-sentence problem, never a throw.

interface TrackerIssue {
  readonly key: string
  readonly title: string
  readonly url: string
  readonly updatedAt?: string
}

export interface CollectDeps {
  readonly exec: ShellExec
  readonly cwd: string
  readonly issues: {
    search(query: string, opts: { limit: number }): Promise<TrackerIssue[]>
    listMine(opts: { limit: number }): Promise<TrackerIssue[]>
  } | null
  readonly now: () => string
}

export interface CollectResult {
  readonly items: SensedItem[]
  readonly problem: string | null
  /** Keys of signals this run proves are over (a workflow now green); absent means none. */
  readonly resolvedKeys?: string[]
}

/** Lowercases, strips digits/hex ids/quoted strings/paths, collapses whitespace. */
function normalise(title: string): string {
  return title
    .toLowerCase()
    .replace(/"[^"]*"/g, ' ')
    .replace(/'[^']*'/g, ' ')
    .replace(/\/[^\s]*/g, ' ')
    .replace(/\b[0-9a-f]{6,}\b/g, ' ')
    .replace(/[0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseJson<T>(stdout: string): T | null {
  try {
    return JSON.parse(stdout) as T
  } catch {
    return null
  }
}

function problem(text: string): CollectResult {
  return { items: [], problem: text }
}

/** What to say when a `gh` listing fails, or prints something that is not its JSON. */
interface ListingProblems {
  readonly failed: string
  readonly unreadable: string
}

/** Runs one `gh` listing and reads its JSON rows, or says why it could not. */
async function ghRows<T>(
  deps: CollectDeps,
  args: string[],
  problems: ListingProblems
): Promise<{ rows: T[] } | { problem: string }> {
  const result = await deps.exec({ command: 'gh', args, cwd: deps.cwd })
  if (result.exitCode !== 0) return { problem: problems.failed }
  const rows = parseJson<T[]>(result.stdout)
  return rows === null ? { problem: problems.unreadable } : { rows }
}

/** The repository's default branch, or null when gh cannot say. */
async function defaultBranch(deps: CollectDeps): Promise<string | null> {
  const result = await deps.exec({
    command: 'gh',
    args: ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'],
    cwd: deps.cwd,
  })
  return result.exitCode === 0 ? result.stdout.trim() : null
}

interface FailedRun {
  displayTitle: string
  workflowName: string
  createdAt: string
  url: string
}

const LATEST_RUN_TIMEOUT_MS = 30_000

/** True when the newest completed run of `workflow` on `branch` succeeded; false when unknown. */
async function latestRunSucceeded(
  deps: CollectDeps,
  branch: string,
  workflow: string
): Promise<boolean> {
  const result = await deps.exec({
    command: 'gh',
    args: [
      ...['run', 'list', '--branch', branch, '--workflow', workflow, '--status', 'completed'],
      ...['--limit', '1', '--json', 'conclusion,url,headSha'],
    ],
    cwd: deps.cwd,
    timeoutMs: LATEST_RUN_TIMEOUT_MS,
  })
  if (result.exitCode !== 0) return false
  return parseJson<{ conclusion: string }[]>(result.stdout)?.[0]?.conclusion === 'success'
}

/** The workflows among `failed` whose newest run on `branch` now passes. */
async function greenWorkflows(
  deps: CollectDeps,
  branch: string,
  failed: readonly FailedRun[]
): Promise<Set<string>> {
  const green = new Set<string>()
  for (const workflow of new Set(failed.map((run) => run.workflowName))) {
    if (await latestRunSucceeded(deps, branch, workflow)) green.add(workflow)
  }
  return green
}

async function collectGithubRuns(
  source: Extract<SensorSource, { kind: 'github-runs' }>,
  deps: CollectDeps
): Promise<CollectResult> {
  const branch = source.branch ?? (await defaultBranch(deps))
  if (branch === null) return problem('gh repo view failed to read the default branch.')
  const listed = await ghRows<FailedRun>(
    deps,
    [
      ...['run', 'list', '--branch', branch, '--status', 'failure'],
      ...['--limit', String(source.limit)],
      ...['--json', 'databaseId,displayTitle,headSha,workflowName,createdAt,url'],
    ],
    {
      failed: 'gh run list failed to list failing runs.',
      unreadable: 'gh run list returned output that could not be read.',
    }
  )
  if ('problem' in listed) return problem(listed.problem)
  const green = await greenWorkflows(deps, branch, listed.rows)
  const items: SensedItem[] = listed.rows
    .filter((run) => !green.has(run.workflowName))
    .map((run) => ({
      key: `workflow:${run.workflowName}`,
      title: `${run.workflowName} failing on ${branch}`,
      evidence: { kind: 'ci-run', title: run.displayTitle, url: run.url, at: run.createdAt },
    }))
  return { items, problem: null, resolvedKeys: [...green].map((name) => `workflow:${name}`) }
}

async function collectGithubIssues(
  source: Extract<SensorSource, { kind: 'github-issues' }>,
  deps: CollectDeps
): Promise<CollectResult> {
  const listed = await ghRows<{ title: string; url: string; updatedAt?: string }>(
    deps,
    [
      ...['issue', 'list', '--label', source.label, '--state', 'open'],
      ...['--limit', String(source.limit), '--json', 'number,title,url,updatedAt'],
    ],
    {
      failed: 'gh issue list failed to list open issues.',
      unreadable: 'gh issue list returned output that could not be read.',
    }
  )
  if ('problem' in listed) return problem(listed.problem)
  const items: SensedItem[] = listed.rows.map((issue) => ({
    key: `issue:${source.label}:${normalise(issue.title)}`,
    title: issue.title,
    evidence: {
      kind: 'issue',
      title: issue.title,
      url: issue.url,
      at: issue.updatedAt ?? deps.now(),
    },
  }))
  return { items, problem: null }
}

async function collectTracker(
  source: Extract<SensorSource, { kind: 'tracker' }>,
  deps: CollectDeps
): Promise<CollectResult> {
  if (deps.issues === null) {
    return { items: [], problem: 'No tracker is connected.' }
  }

  const found =
    source.query !== null
      ? await deps.issues.search(source.query, { limit: source.limit })
      : await deps.issues.listMine({ limit: source.limit })

  const items: SensedItem[] = found.map((issue) => ({
    key: `tracker:${issue.key}`,
    title: issue.title,
    evidence: {
      kind: 'issue',
      title: issue.title,
      url: issue.url,
      at: issue.updatedAt ?? deps.now(),
    },
  }))
  return { items, problem: null }
}

export async function collect(source: SensorSource, deps: CollectDeps): Promise<CollectResult> {
  switch (source.kind) {
    case 'github-runs':
      return collectGithubRuns(source, deps)
    case 'github-issues':
      return collectGithubIssues(source, deps)
    case 'tracker':
      return collectTracker(source, deps)
  }
}
