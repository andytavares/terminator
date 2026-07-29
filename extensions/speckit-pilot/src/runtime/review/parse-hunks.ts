import type { Hunk } from './hunk-decisions.js'

// Splits a unified diff into individually reviewable hunks (FR-052).
//
// The unit of decision is the hunk, not the file, because one file routinely
// holds both the change you asked for and the one you did not — which is the
// case the intent step exists to catch and this surface exists to act on.

const FILE_HEADER = /^\+\+\+ b\/(.+)$/
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = []
  let file = ''
  let current: { oldStart: number; newStart: number; lines: string[] } | null = null
  let index = 0

  const flush = (): void => {
    if (current === null || file === '') return
    hunks.push({
      id: `${file}:${current.newStart}:${++index}`,
      file,
      oldStart: current.oldStart,
      newStart: current.newStart,
      lines: current.lines,
    })
    current = null
  }

  for (const line of patch.split('\n')) {
    // A new file's header closes the previous file's last hunk. Without this
    // the `--- a/...` line — which starts with `-` — reads as a deletion and
    // lands in the wrong hunk.
    if (line.startsWith('diff --git ') || line.startsWith('--- ')) {
      flush()
      continue
    }

    const fileMatch = line.match(FILE_HEADER)
    if (fileMatch !== null) {
      flush()
      file = fileMatch[1]
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
    if (current !== null && /^[-+ ]/.test(line)) current.lines.push(line)
  }

  flush()
  return hunks
}
