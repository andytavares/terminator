import type { Node } from 'web-tree-sitter'
import { classifyHunk } from '../github/pr-review-service'
import type { ComplexityHotspot } from '../github/pr-review-service'
import {
  analyseLines,
  analyseSnippet,
  withSyntaxTree,
  type SnippetAnalysis,
  type SnippetFunction,
} from './symbols'
import type { ParsedPrFile } from './parsed-file'
import type { FileDiff } from '../schemas/git.schema'
import type {
  Chapter,
  DryViolation,
  FunctionComplexity,
  PrInsights,
  ReadingStep,
} from '../schemas/pr-review.schema'

export interface ComputeInsightsOptions {
  readingOrder: ReadingStep[]
  chapters: Chapter[]
  dryViolations: DryViolation[]
}

function linesOf(
  hunkLines: Array<{ type: string; content: string }>,
  type: 'add' | 'remove'
): string[] {
  return hunkLines.filter((l) => l.type === type).map((l) => l.content)
}

// ─── Complexity ─────────────────────────────────────────────────────────────────

interface FileComplexity {
  delta: number
  functions: FunctionComplexity[]
}

function branchDeltaByFunction(head: SnippetFunction[], base: SnippetFunction[]) {
  const baseByName = new Map(base.map((f) => [f.name, f.branches]))
  const headNames = new Set(head.map((f) => f.name))
  let total = 0
  const grown: Array<{ fn: SnippetFunction; delta: number }> = []
  for (const fn of head) {
    const delta = fn.branches - (baseByName.get(fn.name) ?? 0)
    total += delta
    if (delta > 0) grown.push({ fn, delta })
  }
  // A function whose branches only shrank still contributes to the total delta.
  for (const [name, baseBranches] of baseByName) {
    if (!headNames.has(name)) total -= baseBranches
  }
  return { total, grown }
}

async function parsedComplexity({
  path,
  diff,
}: Pick<ParsedPrFile, 'path' | 'diff'>): Promise<FileComplexity | null> {
  const headLines = diff.hunks.flatMap((h) => h.lines.filter((l) => l.type !== 'remove'))
  const baseLines = diff.hunks.flatMap((h) => h.lines.filter((l) => l.type !== 'add'))
  const head = await analyseLines(path, headLines)
  const base = await analyseLines(path, baseLines)
  if (!head && !base) return null
  // Snippet rows are 1-based over the concatenated head lines; map back to the file.
  const fileLineOf = (row: number) => headLines[row - 1]?.newLineNumber ?? null
  const { total, grown } = branchDeltaByFunction(head?.functions ?? [], base?.functions ?? [])
  const functions = grown.map(({ fn, delta }) => ({
    path,
    name: fn.name,
    line: fileLineOf(fn.line),
    branchDelta: delta,
  }))
  return { delta: total, functions }
}

async function fileComplexity(file: ParsedPrFile): Promise<FileComplexity | null> {
  if (!file.patch || !file.path) return null
  return parsedComplexity(file)
}

const HOTSPOT_BRANCHES = 5

/** A file's branch delta and its hotspot hunks; null when no grammar parses the file. */
export async function measureDiffComplexity(
  path: string,
  diff: FileDiff
): Promise<{ delta: number; hotspots: ComplexityHotspot[] } | null> {
  const whole = await parsedComplexity({ path, diff })
  if (!whole) return null
  const hotspots: ComplexityHotspot[] = []
  for (const [hunkIndex, hunk] of diff.hunks.entries()) {
    const part = await parsedComplexity({ path, diff: { ...diff, hunks: [hunk] } })
    const delta = part?.delta ?? 0
    if (delta < HOTSPOT_BRANCHES) continue
    const message = `Complexity hotspot — this block adds ${delta} branches.`
    hotspots.push({ hunkIndex, complexityDelta: delta, message })
  }
  return { delta: whole.delta, hotspots }
}

async function computeComplexity(files: ParsedPrFile[]): Promise<PrInsights['complexity']> {
  const measured: FileComplexity[] = []
  for (const file of files) {
    const result = await fileComplexity(file)
    if (result) measured.push(result)
  }
  const functions = measured.flatMap((m) => m.functions)
  functions.sort((a, b) => b.branchDelta - a.branchDelta)
  const branchDelta = measured.reduce((sum, m) => sum + m.delta, 0)
  return { branchDelta, functions, source: 'tree-sitter · hunk base vs head' }
}

// ─── Added text ─────────────────────────────────────────────────────────────────

function addedTextOf(file: ParsedPrFile): string {
  return file.diff.hunks.flatMap((h) => linesOf(h.lines, 'add')).join('\n')
}

/** Analyses the lines a file adds; null when it has no patch, no added text or no grammar. */
async function analyseAddedText(file: ParsedPrFile): Promise<SnippetAnalysis | null> {
  if (!file.patch) return null
  const text = addedTextOf(file)
  if (!text) return null
  return analyseSnippet(file.path, text)
}

// ─── Health flags ───────────────────────────────────────────────────────────────

const FUNCTION_NODE_TYPES = new Set([
  'function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
])

function maxNestingDepth(node: Node): number {
  let max = 0
  function visit(n: Node, depth: number): void {
    const nextDepth = n.type === 'statement_block' ? depth + 1 : depth
    if (nextDepth > max) max = nextDepth
    for (let i = 0; i < n.childCount; i++) visit(n.child(i)!, nextDepth)
  }
  visit(node, 0)
  return max
}

function countParams(node: Node): number {
  const params = node.childForFieldName('parameters')
  if (!params) return 0
  let count = 0
  for (let i = 0; i < params.childCount; i++) {
    const child = params.child(i)!
    if (child.type !== '(' && child.type !== ')' && child.type !== ',') count++
  }
  return count
}

interface HealthFlag {
  kind: string
  label: string
  path: string
}

function flagsForFunction(node: Node, path: string): HealthFlag[] {
  const flags: HealthFlag[] = []
  const lineSpan = node.endPosition.row - node.startPosition.row + 1
  if (lineSpan > 80) {
    flags.push({ kind: 'long-function', label: `Function over 80 lines (${lineSpan})`, path })
  }
  const nesting = maxNestingDepth(node)
  if (nesting > 4) flags.push({ kind: 'deep-nesting', label: `Nesting depth ${nesting}`, path })
  const params = countParams(node)
  if (params > 5) flags.push({ kind: 'many-params', label: `${params} parameters`, path })
  return flags
}

function collectFunctionFlags(root: Node, path: string): HealthFlag[] {
  const flags: HealthFlag[] = []
  const visit = (n: Node): void => {
    if (FUNCTION_NODE_TYPES.has(n.type)) flags.push(...flagsForFunction(n, path))
    for (let i = 0; i < n.childCount; i++) visit(n.child(i)!)
  }
  visit(root)
  return flags
}

interface AddedTextMarker {
  kind: string
  label: string
  pattern: RegExp
}

const ADDED_TEXT_MARKERS: AddedTextMarker[] = [
  { kind: 'todo', label: 'New TODO/FIXME', pattern: /\b(TODO|FIXME)\b/ },
]

function addedTextFlags(path: string, addedText: string): HealthFlag[] {
  return ADDED_TEXT_MARKERS.filter((marker) => marker.pattern.test(addedText)).map(
    ({ kind, label }) => ({ kind, label, path })
  )
}

function duplicateBlockFlags(dryViolations: DryViolation[]): HealthFlag[] {
  return dryViolations.map((violation) => ({
    kind: 'duplicate-block',
    label: `${violation.lineCount} duplicated lines across ${violation.files.length} files`,
    path: violation.files[0] ?? '',
  }))
}

async function computeHealthFlags(
  files: ParsedPrFile[],
  dryViolations: DryViolation[]
): Promise<HealthFlag[]> {
  const flags: HealthFlag[] = []
  for (const file of files) {
    const { path } = file
    const addedText = file.patch ? addedTextOf(file) : ''
    if (!addedText) continue
    flags.push(...addedTextFlags(path, addedText))
    const functionFlags = await withSyntaxTree(path, addedText, (root) =>
      collectFunctionFlags(root, path)
    )
    if (functionFlags) flags.push(...functionFlags)
  }
  return [...flags, ...duplicateBlockFlags(dryViolations)]
}

// ─── Understandability ──────────────────────────────────────────────────────────

function semanticLinesToRead(diff: FileDiff): number {
  return diff.hunks
    .filter((hunk) => classifyHunk(hunk) === 'semantic')
    .reduce(
      (sum, hunk) => sum + linesOf(hunk.lines, 'add').length + linesOf(hunk.lines, 'remove').length,
      0
    )
}

function longestDependencyChain(readingOrder: ReadingStep[]): number {
  const chainLength = new Map<number, number>()
  let longest = 0
  for (const step of readingOrder) {
    let best = 1
    for (const use of step.uses) {
      if (use.definedInStep == null) continue
      best = Math.max(best, (chainLength.get(use.definedInStep) ?? 1) + 1)
    }
    chainLength.set(step.step, best)
    longest = Math.max(longest, best)
  }
  return longest
}

function countCrossChapterRefs(readingOrder: ReadingStep[], chapters: Chapter[]): number {
  const chapterOf = new Map<string, string>()
  for (const chapter of chapters) {
    for (const f of chapter.files) chapterOf.set(f.path, chapter.id)
  }
  let crossChapterRefs = 0
  for (const step of readingOrder) {
    const stepChapter = chapterOf.get(step.path)
    for (const use of step.uses) {
      if (!use.definedInPath) continue
      const defChapter = chapterOf.get(use.definedInPath)
      if (defChapter && stepChapter && defChapter !== stepChapter) crossChapterRefs++
    }
  }
  return crossChapterRefs
}

type UnderstandabilityLevel = PrInsights['understandability']['level']

function understandabilityLevel(linesToRead: number, longestChain: number): UnderstandabilityLevel {
  if (linesToRead > 1000 || longestChain >= 6) return 'hard'
  if (linesToRead < 300 && longestChain <= 2) return 'easy'
  return 'moderate'
}

async function computeUnderstandability(
  files: ParsedPrFile[],
  opts: ComputeInsightsOptions
): Promise<PrInsights['understandability']> {
  let linesToRead = 0
  let newExports = 0
  for (const file of files) {
    if (!file.patch) continue
    linesToRead += semanticLinesToRead(file.diff)
    const analysis = await analyseAddedText(file)
    if (analysis) newExports += analysis.definitions.length
  }
  const longestChain = longestDependencyChain(opts.readingOrder)
  return {
    level: understandabilityLevel(linesToRead, longestChain),
    linesToRead,
    newExports,
    longestChain,
    crossChapterRefs: countCrossChapterRefs(opts.readingOrder, opts.chapters),
    source: 'reading-order graph',
  }
}

/**
 * Computes the Review brief (R4): complexity, code health and
 * understandability, each with the source that produced it.
 */
export async function computeInsights(
  files: ParsedPrFile[],
  opts: ComputeInsightsOptions
): Promise<PrInsights> {
  const complexity = await computeComplexity(files)
  const flags = await computeHealthFlags(files, opts.dryViolations)
  const understandability = await computeUnderstandability(files, opts)

  return {
    complexity,
    health: { flags, source: 'tree-sitter · detectDryViolations' },
    understandability,
  }
}
