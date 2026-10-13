import type { GitStatus, GitFileStatus, FileDiff, DiffHunk, DiffLine } from '../schemas/git.schema'

const DEFAULT_MAX_DIFF_BYTES = 500 * 1024 // 500 KB

const CONFLICT_CODES = new Set(['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'])

const HUNK_START_RE = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** A status entry, and how many NUL-separated tokens it used up. */
interface StatusEntry {
  file: GitFileStatus
  consumed: number
}

/** The hunk being read and the next line number on each side. */
interface HunkCursor {
  hunk: DiffHunk
  oldLine: number
  newLine: number
}

function resolveStatus(x: string, y: string): GitFileStatus['status'] {
  const code = x !== ' ' ? x : y
  switch (code) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'renamed'
    default:
      return 'modified'
  }
}

/** Reads the entry at `entries[i]`; a rename or copy names its source in the next token. */
function statusEntryAt(entries: string[], i: number): StatusEntry {
  const xy = entries[i].slice(0, 2)
  const path = entries[i].slice(3)
  const [x, y] = [xy[0], xy[1]] // staged, unstaged
  if (xy === '??' || xy === '!!') {
    const status = xy === '??' ? 'untracked' : 'ignored'
    return { file: { path, status, staged: false, isBinary: false }, consumed: 1 }
  }
  if (CONFLICT_CODES.has(xy)) {
    return { file: { path, status: 'conflicted', staged: false, isBinary: false }, consumed: 1 }
  }
  if (x === 'R' || x === 'C') {
    const originalPath = entries[i + 1] ?? ''
    const file: GitFileStatus = {
      path,
      originalPath,
      status: 'renamed',
      staged: true,
      isBinary: false,
    }
    return { file, consumed: 2 }
  }
  const staged = x !== ' ' && x !== '?'
  return { file: { path, status: resolveStatus(x, y), staged, isBinary: false }, consumed: 1 }
}

export function parseStatus(
  stdout: string,
  maxFiles: number
): Omit<GitStatus, 'branch'> & { branch: string } {
  if (!stdout.trim()) {
    return { branch: '', files: [], hasConflicts: false, truncated: false }
  }
  // git status --porcelain=v1 -z uses NUL as separator
  const entries = stdout.split('\0').filter((e) => e.length > 0)
  const files: GitFileStatus[] = []
  let i = 0
  while (i < entries.length && files.length < maxFiles) {
    if (entries[i].length < 3) {
      i++
      continue
    }
    const { file, consumed } = statusEntryAt(entries, i)
    files.push(file)
    i += consumed
  }
  const remaining = entries.slice(i).filter((e) => e.length >= 3).length
  const truncated = files.length >= maxFiles && remaining > 0
  const hasConflicts = files.some((f) => f.status === 'conflicted')
  return { branch: '', files, hasConflicts, truncated }
}

function openHunk(header: string): HunkCursor {
  // @@ -oldStart[,oldCount] +newStart[,newCount] @@
  const match = header.match(HUNK_START_RE)
  if (!match) return { hunk: { header, lines: [] }, oldLine: 1, newLine: 1 }
  const [oldLine, newLine] = [parseInt(match[1], 10), parseInt(match[2], 10)]
  return { hunk: { header, lines: [] }, oldLine, newLine }
}

/** The diff line `line` is, advancing the cursor's line numbers; null for a header line. */
function nextDiffLine(cursor: HunkCursor, line: string): DiffLine | null {
  const content = line.slice(1)
  if (line.startsWith('+')) {
    return { type: 'add', content, oldLineNumber: null, newLineNumber: cursor.newLine++ }
  }
  if (line.startsWith('-')) {
    return { type: 'remove', content, oldLineNumber: cursor.oldLine++, newLineNumber: null }
  }
  if (!line.startsWith(' ')) return null // ---, +++, diff --git, index ...
  return {
    type: 'context',
    content,
    oldLineNumber: cursor.oldLine++,
    newLineNumber: cursor.newLine++,
  }
}

export function parseDiff(stdout: string, maxBytes: number = DEFAULT_MAX_DIFF_BYTES): FileDiff {
  const truncated = Buffer.byteLength(stdout, 'utf8') > maxBytes
  const content = truncated ? stdout.slice(0, maxBytes) : stdout
  if (content.includes('Binary files') && content.includes('differ')) {
    return { path: '', hunks: [], isBinary: true, truncated }
  }
  const hunks: DiffHunk[] = []
  let cursor: HunkCursor | null = null
  for (const line of content.split('\n')) {
    if (line.startsWith('@@')) {
      cursor = openHunk(line)
      hunks.push(cursor.hunk)
      continue
    }
    if (!cursor) continue
    const diffLine = nextDiffLine(cursor, line)
    if (diffLine) cursor.hunk.lines.push(diffLine)
  }
  return { path: '', hunks, isBinary: false, truncated }
}
