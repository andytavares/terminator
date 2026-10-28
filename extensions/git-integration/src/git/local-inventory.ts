import { isAbsolute, join } from 'node:path'

// The Worktrees tab's data: one row per local branch, plus one per detached
// worktree, from the core's worktree list and `git for-each-ref`.

export interface LocalInventoryRow {
  branch: string | null
  worktreePath: string | null
  isMain: boolean
  isCurrent: boolean
  /** ms epoch of the branch's last commit (the folder's mtime for a detached row). */
  lastCommitAt: number
  /** ms epoch: the worktree folder's birthtime, else the branch's oldest reflog entry. */
  createdAt: number | null
  /** ms epoch: the worktree folder or its index, whichever is newer; a branch's last commit. */
  modifiedAt: number | null
  merged: boolean
  upstream: string | null
  upstreamGone: boolean
  ahead: number
  behind: number
  prunable: boolean
  isAgent: boolean
  project: { id: string; name: string } | null
}

/** The shell local-inventory runs against; the backend binds it to runGit and fs. */
export interface InventoryShell {
  exec(cwd: string, args: string[]): Promise<string>
  listWorktrees(repoRoot: string): Promise<WorktreeEntry[]>
  stat(path: string): Promise<{ birthtimeMs: number; mtimeMs: number } | null>
  readFile(path: string): Promise<string | null>
  listProjects(): Promise<Array<{ id: string; name: string; worktreePath?: string }>>
}

export interface WorktreeEntry {
  path: string
  branch: string | null
  detached: boolean
  prunable: boolean
}

/** @internal */
export interface RefEntry {
  branch: string
  upstream: string | null
  track: string
  committerUnix: number
  worktreePath: string
}

/** One ref record of the listing: five NUL-separated fields. */
function parseRefRecord(record: string): RefEntry | null {
  const fields = record.split('\0')
  if (fields.length < 5 || fields[0] === '') return null
  return {
    branch: fields[0],
    upstream: fields[1] || null,
    track: fields[2],
    committerUnix: Number(fields[3]) || 0,
    worktreePath: fields[4],
  }
}

/** Parses the `for-each-ref` listing: five NUL-separated fields per branch, records
 *  newline-separated (the format's own terminator, since none is set). @internal */
export function parseRefListing(text: string): RefEntry[] {
  return text
    .replace(/\n$/, '')
    .split('\n')
    .map(parseRefRecord)
    .filter((entry): entry is RefEntry => entry !== null)
}

/** The oldest reflog entry of a branch, in ms; null when it has none. @internal */
export function parseReflogOldest(text: string): number | null {
  const lines = text.trim().split('\n').filter(Boolean)
  const unix = Number(lines.at(-1))
  return lines.length > 0 && Number.isFinite(unix) ? unix * 1000 : null
}

/** Claude Code worktrees and this app's agent branches. @internal */
export function isAgentRow(branch: string | null, worktreePath: string | null): boolean {
  return (
    (worktreePath !== null && worktreePath.includes('/.claude/worktrees/')) ||
    (branch !== null && branch.startsWith('worktree-agent-'))
  )
}

const TRACK_AHEAD_BEHIND = /ahead (\d+)|behind (\d+)/g

function aheadBehind(track: string): { ahead: number; behind: number } {
  let ahead = 0
  let behind = 0
  for (const match of track.matchAll(TRACK_AHEAD_BEHIND)) {
    if (match[1]) ahead = Number(match[1])
    if (match[2]) behind = Number(match[2])
  }
  return { ahead, behind }
}

/** The raw facts the rows are assembled from; gathered by loadLocalInventory. @internal */
export interface InventoryFacts {
  repoRoot: string
  worktrees: WorktreeEntry[]
  refListing: string
  defaultBranch: string
  mergedBranches: string[]
  currentBranch: string
  /** worktreePath → the folder's stat times, when the folder exists. */
  statTimes: Record<string, { birthtimeMs: number; mtimeMs: number }>
  /** worktreePath → its gitdir index's mtime, in ms; 0 when unknown. */
  indexTimes: Record<string, number>
  /** branch → its oldest reflog entry in ms. */
  reflogOldest: Record<string, number | null>
  projects: Array<{ id: string; name: string; worktreePath?: string }>
}

function projectForPath(
  projects: InventoryFacts['projects'],
  worktreePath: string | null
): { id: string; name: string } | null {
  const match = worktreePath && projects.find((p) => p.worktreePath === worktreePath)
  return match ? { id: match.id, name: match.name } : null
}

function worktreeTimes(facts: InventoryFacts, path: string | null) {
  const stats = path ? facts.statTimes[path] : undefined
  const index = path ? (facts.indexTimes[path] ?? 0) : 0
  return { stats, index }
}

function rowForBranch(ref: RefEntry, facts: InventoryFacts): LocalInventoryRow {
  const worktreePath = ref.worktreePath || null
  const { stats, index } = worktreeTimes(facts, worktreePath)
  const { ahead, behind } = aheadBehind(ref.track)
  return {
    branch: ref.branch,
    worktreePath,
    isMain: ref.branch === facts.defaultBranch,
    isCurrent: ref.branch === facts.currentBranch,
    lastCommitAt: ref.committerUnix * 1000,
    createdAt: stats ? Math.round(stats.birthtimeMs) : (facts.reflogOldest[ref.branch] ?? null),
    modifiedAt: stats ? Math.max(Math.round(stats.mtimeMs), index) : ref.committerUnix * 1000,
    merged: facts.mergedBranches.includes(ref.branch),
    upstream: ref.upstream,
    upstreamGone: ref.track === '[gone]',
    ahead,
    behind,
    prunable: false,
    isAgent: isAgentRow(ref.branch, worktreePath),
    project: projectForPath(facts.projects, worktreePath),
  }
}

function rowForDetached(entry: WorktreeEntry, facts: InventoryFacts): LocalInventoryRow {
  const { stats, index } = worktreeTimes(facts, entry.path)
  return {
    branch: null,
    worktreePath: entry.path,
    isMain: false,
    isCurrent: false,
    lastCommitAt: stats ? Math.round(stats.mtimeMs) : 0,
    createdAt: stats ? Math.round(stats.birthtimeMs) : null,
    modifiedAt: stats ? Math.max(Math.round(stats.mtimeMs), index) : null,
    merged: false,
    upstream: null,
    upstreamGone: false,
    ahead: 0,
    behind: 0,
    prunable: entry.prunable,
    isAgent: isAgentRow(null, entry.path),
    project: projectForPath(facts.projects, entry.path),
  }
}

/** Assembles the rows from the facts the git reads produced. @internal */
export function inventoryRows(facts: InventoryFacts): LocalInventoryRow[] {
  const { worktrees } = facts
  const prunablePaths = new Set(worktrees.filter((w) => w.prunable).map((w) => w.path))
  const rows = parseRefListing(facts.refListing).map((ref) => {
    const row = rowForBranch(ref, facts)
    return { ...row, prunable: row.worktreePath !== null && prunablePaths.has(row.worktreePath) }
  })
  for (const entry of worktrees.filter((w) => w.detached)) rows.push(rowForDetached(entry, facts))
  return rows
}

async function defaultBranchOf(shell: InventoryShell, repoRoot: string): Promise<string> {
  const head = await shell
    .exec(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    .catch(() => '')
  return head.trim().replace(/^origin\//, '') || 'main'
}

async function statTimesOf(
  shell: InventoryShell,
  worktrees: WorktreeEntry[]
): Promise<Pick<InventoryFacts, 'statTimes' | 'indexTimes'>> {
  const statTimes: InventoryFacts['statTimes'] = {}
  const indexTimes: InventoryFacts['indexTimes'] = {}
  for (const w of worktrees) {
    const times = await shell.stat(w.path)
    if (times) statTimes[w.path] = times
    indexTimes[w.path] = await indexMtimeOf(shell, w.path)
  }
  return { statTimes, indexTimes }
}

/** The mtime of `path`, in ms; 0 when it cannot be stat'ed. */
async function mtimeOf(shell: InventoryShell, path: string): Promise<number> {
  const times = await shell.stat(path)
  return times ? Math.round(times.mtimeMs) : 0
}

/** The mtime of a worktree's index, reached through the `.git` file's gitdir line. */
async function indexMtimeOf(shell: InventoryShell, worktreePath: string): Promise<number> {
  const dotGit = await shell.readFile(join(worktreePath, '.git'))
  const gitdir = dotGit?.match(/^gitdir: (.+)$/m)?.[1].trim()
  if (!gitdir) return 0
  const dir = isAbsolute(gitdir) ? gitdir : join(worktreePath, gitdir)
  return mtimeOf(shell, join(dir, 'index'))
}

async function reflogOldestOf(
  shell: InventoryShell,
  repoRoot: string,
  branches: string[]
): Promise<Record<string, number | null>> {
  const oldest: Record<string, number | null> = {}
  for (const branch of branches) {
    const ref = 'refs/heads/' + branch
    const out = await shell.exec(repoRoot, ['reflog', 'show', '--format=%ct', ref]).catch(() => '')
    oldest[branch] = parseReflogOldest(out)
  }
  return oldest
}

const FOR_EACH_REF_FORMAT =
  '%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:unix)%00%(worktreepath)'

async function readBranchFacts(repoRoot: string, shell: InventoryShell, defaultBranch: string) {
  const [refListing, mergedText, currentBranch] = await Promise.all([
    shell.exec(repoRoot, ['for-each-ref', 'refs/heads', `--format=${FOR_EACH_REF_FORMAT}`]),
    shell.exec(repoRoot, ['branch', '--merged', defaultBranch, '--format=%(refname:short)']),
    shell.exec(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
  ])
  return {
    refListing,
    mergedBranches: mergedText
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean),
    currentBranch: currentBranch.trim(),
  }
}

/** The Worktrees tab's inventory: every local branch and worktree of `repoRoot`. */
export async function loadLocalInventory(
  repoRoot: string,
  shell: InventoryShell
): Promise<LocalInventoryRow[]> {
  const [worktrees, defaultBranch] = await Promise.all([
    shell.listWorktrees(repoRoot),
    defaultBranchOf(shell, repoRoot),
  ])
  const branchFacts = await readBranchFacts(repoRoot, shell, defaultBranch)
  const [times, reflogOldest, projects] = await Promise.all([
    statTimesOf(shell, worktrees),
    reflogOldestOf(
      shell,
      repoRoot,
      parseRefListing(branchFacts.refListing).map((r) => r.branch)
    ),
    shell.listProjects(),
  ])
  return inventoryRows({
    repoRoot,
    worktrees,
    defaultBranch,
    ...branchFacts,
    ...times,
    reflogOldest,
    projects,
  })
}
