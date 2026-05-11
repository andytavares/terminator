import type { GitStatus, GitFileStatus, FileDiff, DiffHunk, DiffLine } from '../schemas/git.schema'

const DEFAULT_MAX_DIFF_BYTES = 500 * 1024 // 500 KB

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
  let hasConflicts = false
  let i = 0

  while (i < entries.length && files.length < maxFiles) {
    const entry = entries[i]
    if (entry.length < 3) {
      i++
      continue
    }

    const xy = entry.slice(0, 2)
    const path = entry.slice(3)
    const x = xy[0] // staged status
    const y = xy[1] // unstaged status

    if (xy === '??' || xy === '!!') {
      files.push({
        path,
        status: xy === '??' ? 'untracked' : 'ignored',
        staged: false,
        isBinary: false,
      })
      i++
      continue
    }

    if (
      xy === 'UU' ||
      xy === 'AA' ||
      xy === 'DD' ||
      xy === 'AU' ||
      xy === 'UA' ||
      xy === 'DU' ||
      xy === 'UD'
    ) {
      files.push({ path, status: 'conflicted', staged: false, isBinary: false })
      hasConflicts = true
      i++
      continue
    }

    // Renamed/copied — next NUL token is the original path
    if (x === 'R' || x === 'C') {
      const originalPath = entries[i + 1] ?? ''
      files.push({
        path,
        originalPath,
        status: 'renamed',
        staged: true,
        isBinary: false,
      })
      i += 2
      continue
    }

    // Determine status from XY codes
    const status = resolveStatus(x, y)
    const staged = x !== ' ' && x !== '?'

    files.push({ path, status, staged, isBinary: false })
    i++
  }

  // Count remaining entries to determine truncation
  const remaining = entries.slice(i).filter((e) => e.length >= 3).length
  const truncated = files.length >= maxFiles && remaining > 0

  return { branch: '', files, hasConflicts, truncated }
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

export function parseDiff(stdout: string, maxBytes: number = DEFAULT_MAX_DIFF_BYTES): FileDiff {
  const truncated = Buffer.byteLength(stdout, 'utf8') > maxBytes
  const content = truncated ? stdout.slice(0, maxBytes) : stdout

  if (content.includes('Binary files') && content.includes('differ')) {
    return { path: '', hunks: [], isBinary: true, truncated }
  }

  const hunks: DiffHunk[] = []
  const lines = content.split('\n')
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      // Parse hunk header: @@ -oldStart[,oldCount] +newStart[,newCount] @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      oldLine = match ? parseInt(match[1], 10) : 1
      newLine = match ? parseInt(match[2], 10) : 1
      currentHunk = { header: line, lines: [] }
      hunks.push(currentHunk)
      continue
    }

    if (!currentHunk) continue

    if (line.startsWith('+')) {
      const diffLine: DiffLine = {
        type: 'add',
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine++,
      }
      currentHunk.lines.push(diffLine)
    } else if (line.startsWith('-')) {
      const diffLine: DiffLine = {
        type: 'remove',
        content: line.slice(1),
        oldLineNumber: oldLine++,
        newLineNumber: null,
      }
      currentHunk.lines.push(diffLine)
    } else if (line.startsWith(' ')) {
      const diffLine: DiffLine = {
        type: 'context',
        content: line.slice(1),
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
      }
      currentHunk.lines.push(diffLine)
    }
    // Skip diff header lines (---, +++, diff --git, index ...)
  }

  return { path: '', hunks, isBinary: false, truncated }
}
