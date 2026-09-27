import { parseDiff } from '../github/pr-review-service'
import type { DiffLine } from '../schemas/git.schema'
import type { MovedBlock } from '../schemas/pr-review.schema'

const MIN_RUN_LINES = 3

interface Run {
  path: string
  startLine: number
  lines: string[]
  rawFirstLine: string
}

function normalize(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

/**
 * Collects maximal runs of consecutive `type` lines, treating blank lines as
 * transparent (they neither break a run nor count toward its length).
 */
function collectRuns(lines: DiffLine[], type: 'remove' | 'add', path: string, into: Run[]): void {
  let current: { text: string; lineNumber: number }[] = []

  const flush = (): void => {
    if (current.length >= MIN_RUN_LINES) {
      into.push({
        path,
        startLine: current[0].lineNumber,
        lines: current.map((c) => c.text),
        rawFirstLine: current[0].text,
      })
    }
    current = []
  }

  for (const line of lines) {
    if (line.content.trim() === '') continue // blank lines are transparent
    if (line.type === type) {
      const lineNumber = type === 'remove' ? line.oldLineNumber : line.newLineNumber
      if (lineNumber == null) continue
      current.push({ text: line.content, lineNumber })
    } else {
      flush()
    }
  }
  flush()
}

const SYMBOL_PATTERNS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(|async\s*\(|function|[A-Za-z_$][\w$]*\s*=>)/,
  /^\s*def\s+([A-Za-z_][\w]*)/,
]

function extractSymbol(line: string): string | null {
  for (const pattern of SYMBOL_PATTERNS) {
    const match = line.match(pattern)
    if (match) return match[1]
  }
  return null
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

/**
 * Detects code moved between hunks (or files): a run of >= 3 consecutive
 * removed lines that is whitespace-equal to a run of >= 3 consecutive added
 * lines elsewhere. Pure — does not need tree-sitter.
 */
export function detectMovedBlocks(
  files: Array<{ filename?: string; path?: string; patch?: string }>
): MovedBlock[] {
  const removedRuns: Run[] = []
  const addedRuns: Run[] = []

  for (const file of files) {
    const path = file.path ?? file.filename ?? ''
    if (!path || !file.patch) continue
    const diff = parseDiff(file.patch, path)
    for (const hunk of diff.hunks) {
      collectRuns(hunk.lines, 'remove', path, removedRuns)
      collectRuns(hunk.lines, 'add', path, addedRuns)
    }
  }

  const usedAdded = new Set<number>()
  const results: MovedBlock[] = []

  for (const removed of removedRuns) {
    const normRemoved = removed.lines.map(normalize)
    for (let i = 0; i < addedRuns.length; i++) {
      if (usedAdded.has(i)) continue
      const added = addedRuns[i]
      if (added.lines.length !== removed.lines.length) continue
      if (added.path === removed.path && added.startLine === removed.startLine) continue
      const normAdded = added.lines.map(normalize)
      if (!arraysEqual(normRemoved, normAdded)) continue

      usedAdded.add(i)
      results.push({
        fromPath: removed.path,
        fromLine: removed.startLine,
        toPath: added.path,
        toLine: added.startLine,
        lineCount: removed.lines.length,
        symbol: extractSymbol(removed.rawFirstLine),
      })
      break
    }
  }

  return results
}
