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

async function collectGithubRuns(
  source: Extract<SensorSource, { kind: 'github-runs' }>,
  deps: CollectDeps
): Promise<CollectResult> {
  let branch = source.branch
  if (branch === null) {
    const branchResult = await deps.exec({
      command: 'gh',
      args: ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'],
      cwd: deps.cwd,
    })
    if (branchResult.exitCode !== 0) {
      return { items: [], problem: 'gh repo view failed to read the default branch.' }
    }
    branch = branchResult.stdout.trim()
  }

  const args = [
    'run',
    'list',
    '--branch',
    branch,
    '--status',
    'failure',
    '--limit',
    String(source.limit),
    '--json',
    'databaseId,displayTitle,headSha,workflowName,createdAt,url',
  ]
  const result = await deps.exec({ command: 'gh', args, cwd: deps.cwd })
  if (result.exitCode !== 0) {
    return { items: [], problem: 'gh run list failed to list failing runs.' }
  }

  const runs = parseJson<
    {
      displayTitle: string
      workflowName: string
      createdAt: string
      url: string
    }[]
  >(result.stdout)
  if (runs === null) {
    return { items: [], problem: 'gh run list returned output that could not be read.' }
  }

  const items: SensedItem[] = runs.map((run) => ({
    key: `workflow:${run.workflowName}`,
    title: `${run.workflowName} failing on ${branch}`,
    evidence: { kind: 'ci-run', title: run.displayTitle, url: run.url, at: run.createdAt },
  }))
  return { items, problem: null }
}

async function collectGithubIssues(
  source: Extract<SensorSource, { kind: 'github-issues' }>,
  deps: CollectDeps
): Promise<CollectResult> {
  const args = [
    'issue',
    'list',
    '--label',
    source.label,
    '--state',
    'open',
    '--limit',
    String(source.limit),
    '--json',
    'number,title,url,updatedAt',
  ]
  const result = await deps.exec({ command: 'gh', args, cwd: deps.cwd })
  if (result.exitCode !== 0) {
    return { items: [], problem: 'gh issue list failed to list open issues.' }
  }

  const issues = parseJson<{ title: string; url: string; updatedAt?: string }[]>(result.stdout)
  if (issues === null) {
    return { items: [], problem: 'gh issue list returned output that could not be read.' }
  }

  const items: SensedItem[] = issues.map((issue) => ({
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
    key: `tracker:${normalise(issue.title)}`,
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
