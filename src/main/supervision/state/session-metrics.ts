import type { DiffSummary } from '../../../shared/types/supervision.js'
import type { RunCommand } from '../../codehost/check-status.js'

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
    const result = await run('git', ['diff', '--numstat', `${baseBranch}...HEAD`], worktreePath)
    return result.ok ? parseChangedFiles(result.stdout) : []
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
    const result = await run('git', ['diff', '--numstat', `${baseBranch}...HEAD`], worktreePath)
    return result.ok ? parseDiffStat(result.stdout) : EMPTY
  } catch {
    return EMPTY
  }
}
