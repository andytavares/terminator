import type { Hunk } from './hunk-decisions.js'

// Splits a unified diff into individually reviewable hunks (FR-052).
//
// The unit of decision is the hunk, not the file, because one file routinely
// holds both the change you asked for and the one you did not — which is the
// case the intent step exists to catch and this surface exists to act on.

const NEW_SIDE = /^\+\+\+ (?:b\/)?(.+)$/
const OLD_SIDE = /^--- (?:a\/)?(.+)$/
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = []
  let file = ''
  let oldFile = ''
  let current: { oldStart: number; newStart: number; lines: string[] } | null = null
  // A file git has never seen. `git diff --no-index /dev/null <file>` is how a
  // new file gets hunks at all, and reversing them needs the same `/dev/null`
  // on the way out — asking git to reverse an addition against a file it
  // believes pre-existed just fails.
  let isNew = false
  // And the mirror of it. A deletion's new side is `/dev/null`, which used to
  // match no file header at all — so the hunk kept the *previous* file's name
  // and the operator was shown one file's deleted lines labelled as another's.
  let isDeleted = false
  let index = 0

  const flush = (): void => {
    // Cleared even when it is discarded. Leaving it set let a hunk with no file
    // header survive until the next header claimed it.
    const pending = current
    current = null
    if (pending === null || file === '') return
    hunks.push({
      id: `${file}:${pending.newStart}:${++index}`,
      file,
      oldStart: pending.oldStart,
      isNew,
      isDeleted,
      newStart: pending.newStart,
      lines: pending.lines,
    })
  }

  for (const line of patch.split('\n')) {
    // A new file's header closes the previous file's last hunk. Without this
    // the `--- a/...` line — which starts with `-` — reads as a deletion and
    // lands in the wrong hunk.
    if (line.startsWith('diff --git ') || line.startsWith('--- ')) {
      flush()
      if (line.startsWith('--- ')) {
        isNew = line.trim() === '--- /dev/null'
        // Kept, because a deletion's new side names no file and this is the
        // only place the name appears.
        oldFile = isNew ? '' : (line.match(OLD_SIDE)?.[1] ?? '')
      }
      continue
    }

    if (line.startsWith('+++ ')) {
      flush()
      isDeleted = line.trim() === '+++ /dev/null'
      file = isDeleted ? oldFile : (line.match(NEW_SIDE)?.[1] ?? '')
      continue
    }

    const hunkMatch = line.match(HUNK_HEADER)
    if (hunkMatch !== null) {
      flush()
      // Both sides kept: reverting a rejected hunk needs a patch, and a patch
      // needs the range it applies to on the old side as well as the new.
      current = {
        oldStart: Number.parseInt(hunkMatch[1], 10),
        newStart: Number.parseInt(hunkMatch[2], 10),
        lines: [],
      }
      continue
    }

    // Context and change lines belong to the open hunk; diff metadata
    // (`diff --git`, `index`, `--- a/`) is deliberately dropped.
    //
    // `\ No newline at end of file` is kept: it is part of the hunk, and a
    // patch rebuilt without it is refused outright — `--recount` cannot help,
    // because the marker is not a count.
    if (current !== null && /^[-+ \\]/.test(line)) current.lines.push(line)
  }

  flush()
  return hunks
}
