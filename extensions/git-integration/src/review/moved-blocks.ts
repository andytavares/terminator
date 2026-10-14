import type { DiffLine } from '../schemas/git.schema'
import type { MovedBlock } from '../schemas/pr-review.schema'
import type { ParsedPrFile } from './parsed-file'

const MIN_RUN_LINES = 3

interface Run {
  path: string
  startLine: number
  lines: string[]
  rawFirstLine: string
}

interface RunLine {
  text: string
  lineNumber: number
}

const SYMBOL_PATTERNS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(|async\s*\(|function|[A-Za-z_$][\w$]*\s*=>)/,
  /^\s*def\s+([A-Za-z_][\w]*)/,
]

function normalize(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

/** The run `current` forms, when it is long enough to count as a moved block. */
function completedRun(current: RunLine[], path: string): Run[] {
  if (current.length < MIN_RUN_LINES) return []
  const lines = current.map((c) => c.text)
  return [{ path, startLine: current[0].lineNumber, lines, rawFirstLine: current[0].text }]
}

/**
 * Collects maximal runs of consecutive `type` lines, treating blank lines as
 * transparent (they neither break a run nor count toward its length).
 */
function runsIn(lines: DiffLine[], type: 'remove' | 'add', path: string): Run[] {
  const runs: Run[] = []
  let current: RunLine[] = []
  for (const line of lines) {
    if (line.content.trim() === '') continue // blank lines are transparent
    if (line.type !== type) {
      runs.push(...completedRun(current, path))
      current = []
      continue
    }
    const lineNumber = type === 'remove' ? line.oldLineNumber : line.newLineNumber
    if (lineNumber != null) current.push({ text: line.content, lineNumber })
  }
  return [...runs, ...completedRun(current, path)]
}

function runsOf(files: ParsedPrFile[], type: 'remove' | 'add'): Run[] {
  return files
    .filter((file) => file.path)
    .flatMap((file) => file.diff.hunks.flatMap((hunk) => runsIn(hunk.lines, type, file.path)))
}

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

/** Whether `added` is `removed` put somewhere else: same lines up to whitespace, another place. */
function isMoveOf(removed: Run, added: Run): boolean {
  if (added.lines.length !== removed.lines.length) return false
  if (added.path === removed.path && added.startLine === removed.startLine) return false
  return arraysEqual(removed.lines.map(normalize), added.lines.map(normalize))
}

function movedBlockFrom(removed: Run, added: Run): MovedBlock {
  return {
    fromPath: removed.path,
    fromLine: removed.startLine,
    toPath: added.path,
    toLine: added.startLine,
    lineCount: removed.lines.length,
    symbol: extractSymbol(removed.rawFirstLine),
  }
}

/**
 * Detects code moved between hunks (or files): a run of >= 3 consecutive
 * removed lines that is whitespace-equal to a run of >= 3 consecutive added
 * lines elsewhere. Pure — does not need tree-sitter.
 */
export function detectMovedBlocks(files: ParsedPrFile[]): MovedBlock[] {
  const addedRuns = runsOf(files, 'add')
  const usedAdded = new Set<number>()
  const results: MovedBlock[] = []
  for (const removed of runsOf(files, 'remove')) {
    const match = addedRuns.findIndex((added, i) => !usedAdded.has(i) && isMoveOf(removed, added))
    if (match === -1) continue
    usedAdded.add(match)
    results.push(movedBlockFrom(removed, addedRuns[match]))
  }
  return results
}
