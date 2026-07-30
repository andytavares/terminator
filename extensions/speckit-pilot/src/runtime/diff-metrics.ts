import { readFileSync, statSync } from 'fs'
import { join } from 'path'
import type { DiffSummary } from './review/diff-summary.js'

/**
 * Running git, as the extension gets it. `api.shell.exec` is restricted to git
 * and gh, which is exactly the reach this needs and no more.
 */
export type RunCommand = (
  command: string,
  args: string[],
  cwd: string
) => Promise<{ ok: boolean; stdout: string }>

// The diff summary. Two decisions hang off it: whether a finished session
// enters the review queue at all (FR-045 — an empty diff has nothing to
// review), and the >300-line P1 trigger (FR-048).

const EMPTY: DiffSummary = { files: 0, added: 0, removed: 0 }

/**
 * Parses `git diff --numstat` output: `<added>\t<removed>\t<path>` per file,
 * with `-` in both count columns for binary files.
 */
export function parseDiffStat(stdout: string): DiffSummary {
  let files = 0
  let added = 0
  let removed = 0

  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const [addedRaw, removedRaw, ...rest] = line.split('\t')
    // A well-formed row always has counts and a path; anything else is noise.
    if (rest.length === 0 || addedRaw === undefined || removedRaw === undefined) continue

    const addedCount = Number.parseInt(addedRaw, 10)
    const removedCount = Number.parseInt(removedRaw, 10)
    // Binary files report `-` for both counts. They changed, but there are no
    // lines to attribute, and inventing some would distort the P1 threshold.
    const isBinary = Number.isNaN(addedCount) && Number.isNaN(removedCount)
    if (!isBinary && (Number.isNaN(addedCount) || Number.isNaN(removedCount))) continue

    files += 1
    if (!isBinary) {
      added += addedCount
      removed += removedCount
    }
  }

  return { files, added, removed }
}

/** The paths a change touched. Risk grading is meaningless without them. */
export function parseChangedFiles(stdout: string): string[] {
  const files: string[] = []
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const parts = line.split('\t')
    const path = parts.at(-1)
    if (parts.length >= 3 && path !== undefined && path.trim() !== '') files.push(path.trim())
  }
  return files
}

/**
 * Files the working copy has that git has never seen.
 *
 * `git diff` does not show them at all, so an agent whose whole job was to add
 * files reported having changed nothing — no review, no `ready`, and a session
 * recorded as having finished without doing anything. Creating files is most
 * of what an agent does, so this is not an edge case.
 *
 * `--exclude-standard` honours .gitignore, which is what keeps node_modules and
 * build output out of it.
 */
export async function readUntrackedFiles(worktreePath: string, run: RunCommand): Promise<string[]> {
  try {
    const result = await run('git', ['ls-files', '--others', '--exclude-standard'], worktreePath)
    if (!result.ok) return []
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
  } catch {
    return []
  }
}

const MAX_COUNTED_BYTES = 2_000_000

/** Lines in a new file, so it counts towards the change like any other. */
function addedLinesIn(worktreePath: string, relativePath: string): number {
  try {
    const path = join(worktreePath, relativePath)
    // Bounded: a build artefact that escaped .gitignore must not be read into
    // memory on a poll that runs every thirty seconds.
    if (statSync(path).size > MAX_COUNTED_BYTES) return 0
    const contents = readFileSync(path, 'utf8')
    if (contents === '') return 0
    // Binary, near enough: no lines to attribute, and inventing some would
    // distort the >300-line review trigger.
    if (contents.includes('\u0000')) return 0
    return contents.endsWith('\n') ? contents.split('\n').length - 1 : contents.split('\n').length
  } catch {
    return 0
  }
}

/**
 * Reads which files a working copy changed against its base branch. Returns an
 * empty list when git cannot be read — but note the caller must treat that as
 * "unknown", not "nothing touched auth": an empty list downgrades every P0
 * trigger that depends on a path.
 */
export async function readChangedFiles(
  worktreePath: string,
  baseBranch: string,
  run: RunCommand
): Promise<string[]> {
  try {
    const result = await run('git', ['diff', '--numstat', baseBranch], worktreePath)
    const tracked = result.ok ? parseChangedFiles(result.stdout) : []
    // A new file is as much a change as an edited one, and risk grading needs
    // its path as much as any other — a new migration is still a migration.
    return [...tracked, ...(await readUntrackedFiles(worktreePath, run))]
  } catch {
    return []
  }
}

/**
 * Reads the working copy's change summary against its base branch. Never
 * throws: a summary we cannot read reports as empty, which keeps the session
 * out of the review queue rather than queueing something unreadable.
 */
export async function readDiffSummary(
  worktreePath: string,
  baseBranch: string,
  run: RunCommand
): Promise<DiffSummary> {
  try {
    // Against the base itself, not `base...HEAD`: the three-dot form sees only
    // what has been committed, and an agent that edits files and stops — which
    // is most of them — would report having changed nothing at all. Nothing
    // changed means nothing to review, so the review queue could never fill.
    const result = await run('git', ['diff', '--numstat', baseBranch], worktreePath)
    const tracked = result.ok ? parseDiffStat(result.stdout) : EMPTY

    // Plus the files git has never seen, which `git diff` does not report at
    // all — and which are most of what an agent produces.
    const untracked = await readUntrackedFiles(worktreePath, run)
    return {
      files: tracked.files + untracked.length,
      added:
        tracked.added +
        untracked.reduce((total, path) => total + addedLinesIn(worktreePath, path), 0),
      removed: tracked.removed,
    }
  } catch {
    return EMPTY
  }
}
