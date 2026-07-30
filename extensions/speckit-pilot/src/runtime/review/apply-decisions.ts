import type { Hunk } from './hunk-decisions.js'

// Making a rejection mean something.
//
// Per-hunk review was decision-only: you accepted and rejected, the queue
// recorded it, and the working copy kept every line either way. A reject that
// changes nothing is worse than no review at all, because you believe the
// change is gone.
//
// So a finished review reverts exactly the rejected hunks and leaves the
// accepted ones alone — `git apply --reverse` against a patch rebuilt from
// what was rejected.

/** How many lines each side of a hunk covers, counted from its own body. */
function counts(lines: readonly string[]): { old: number; next: number } {
  let oldCount = 0
  let newCount = 0
  for (const line of lines) {
    if (line.startsWith('-')) oldCount += 1
    else if (line.startsWith('+')) newCount += 1
    else {
      oldCount += 1
      newCount += 1
    }
  }
  return { old: oldCount, next: newCount }
}

/**
 * A unified diff of the given hunks, grouped by file and in file order.
 *
 * Returns an empty string when there is nothing to build, so a caller can tell
 * "nothing was rejected" from "a patch that applies to nothing" — `git apply`
 * treats an empty patch as an error, and that error would read as a failed
 * review rather than a clean one.
 */
export function buildPatch(hunks: readonly Hunk[]): string {
  if (hunks.length === 0) return ''

  const byFile = new Map<string, Hunk[]>()
  for (const hunk of hunks) {
    byFile.set(hunk.file, [...(byFile.get(hunk.file) ?? []), hunk])
  }

  const out: string[] = []
  for (const [file, fileHunks] of byFile) {
    // `/dev/null` for a file that did not exist, which is what `git diff
    // --no-index` produced when the hunks were read. Naming the file on both
    // sides makes `git apply --reverse` refuse.
    out.push(fileHunks.some((hunk) => hunk.isNew) ? '--- /dev/null' : `--- a/${file}`)
    out.push(`+++ b/${file}`)
    // In order, because `git apply` tracks the offset each hunk introduces for
    // the ones after it and cannot do that from a shuffled list.
    for (const hunk of [...fileHunks].sort((a, b) => a.oldStart - b.oldStart)) {
      const { old: oldCount, next: newCount } = counts(hunk.lines)
      out.push(`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`, ...hunk.lines)
    }
  }
  // Trailing newline: a patch without one is truncated as far as `git apply`
  // is concerned, and it refuses the last hunk.
  return `${out.join('\n')}\n`
}

export interface ApplyResult {
  readonly ok: boolean
  /** How many hunks were taken back out of the working copy. */
  readonly reverted: number
  /** Why not, in git's own words. Null when it worked. */
  readonly error: string | null
}

export interface ApplyOptions {
  /**
   * Reverses the given patch against the working copy.
   *
   * The transport is the caller's: the extension host's shell has no stdin, so
   * the patch goes via a file there, while a test can hand it to git directly.
   */
  readonly applyReverse: (patch: string) => Promise<{ ok: boolean; stderr: string }>
}

/**
 * Takes the rejected hunks back out of the working copy.
 *
 * Nothing is applied unless everything applies: `git apply` is all-or-nothing
 * per invocation, and a half-reverted review would leave a working copy that
 * matches neither what was accepted nor what the agent wrote.
 */
export async function revertRejected(
  rejected: readonly Hunk[],
  options: ApplyOptions
): Promise<ApplyResult> {
  if (rejected.length === 0) return { ok: true, reverted: 0, error: null }

  const result = await options.applyReverse(buildPatch(rejected))
  return {
    ok: result.ok,
    reverted: result.ok ? rejected.length : 0,
    // Reported rather than swallowed: a rejection that silently failed to
    // revert is the exact failure this whole feature exists to prevent.
    error: result.ok ? null : result.stderr.trim() || 'git apply refused the patch',
  }
}
