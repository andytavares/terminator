import { Parser, type Node } from 'web-tree-sitter'
import {
  classifyHunk,
  classifyTier,
  computeFileCyclomaticDelta,
  parseDiff,
  COVERAGE_CHECK_NAMES,
} from '../github/pr-review-service'
import { analyseSnippet, loadLanguageFor } from './symbols'
import type {
  Chapter,
  DryViolation,
  FunctionComplexity,
  PrInsights,
  ReadingStep,
} from '../schemas/pr-review.schema'

interface RawPrFile {
  filename?: string
  path?: string
  additions?: number
  deletions?: number
  patch?: string
}

interface StatusCheckLike {
  name: string
  state: string
  description?: string
}

export interface ComputeInsightsOptions {
  readingOrder: ReadingStep[]
  chapters: Chapter[]
  statusChecks: StatusCheckLike[]
  dryViolations: DryViolation[]
  localCoverage: number | null
  /** Repo-wide grep for test references, when the caller can provide one. */
  findTestReferences?: (symbols: string[]) => Promise<Set<string>>
}

function pathOf(file: RawPrFile): string {
  return file.path ?? file.filename ?? ''
}

function linesOf(
  hunkLines: Array<{ type: string; content: string }>,
  type: 'add' | 'remove'
): string[] {
  return hunkLines.filter((l) => l.type === type).map((l) => l.content)
}

// ─── Complexity ─────────────────────────────────────────────────────────────────

// Code in a language with no bundled grammar gets the keyword count; configuration
// and prose (YAML, JSON, Markdown) have no branches worth counting.
const UNPARSED_CODE_RE = /\.(kt|kts|swift|scala|c|m|mm|dart|lua|ex|exs|clj|hs|groovy|tf)$/

async function computeComplexity(files: RawPrFile[]): Promise<PrInsights['complexity']> {
  const functions: FunctionComplexity[] = []
  let totalDelta = 0
  let anyGrammar = false
  let anyFallback = false

  for (const file of files) {
    const path = pathOf(file)
    if (!file.patch || !path) continue
    const diff = parseDiff(file.patch, path)
    const headLines = diff.hunks.flatMap((h) =>
      h.lines.filter((l) => l.type === 'add' || l.type === 'context')
    )
    const headText = headLines.map((l) => l.content).join('\n')
    // Snippet rows are 1-based over the concatenated head lines; map back to the file.
    const fileLineOf = (row: number) => headLines[row - 1]?.newLineNumber ?? null
    const baseText = diff.hunks
      .flatMap((h) => h.lines.filter((l) => l.type === 'remove' || l.type === 'context'))
      .map((l) => l.content)
      .join('\n')

    const headAnalysis = headText ? await analyseSnippet(path, headText) : null
    const baseAnalysis = baseText ? await analyseSnippet(path, baseText) : null

    if (headAnalysis || baseAnalysis) {
      anyGrammar = true
      const baseByName = new Map((baseAnalysis?.functions ?? []).map((f) => [f.name, f.branches]))
      const headFns = headAnalysis?.functions ?? []
      const seen = new Set<string>()
      for (const fn of headFns) {
        seen.add(fn.name)
        const delta = fn.branches - (baseByName.get(fn.name) ?? 0)
        totalDelta += delta
        if (delta > 0) {
          functions.push({ path, name: fn.name, line: fileLineOf(fn.line), branchDelta: delta })
        }
      }
      // A function whose branches only shrank still contributes to the total delta.
      for (const [name, baseBranches] of baseByName) {
        if (!seen.has(name)) totalDelta += -baseBranches
      }
    } else if (UNPARSED_CODE_RE.test(path)) {
      anyFallback = true
      const delta = computeFileCyclomaticDelta(diff)
      totalDelta += delta
      if (delta > 0) {
        functions.push({
          path,
          name: path.split('/').pop() ?? path,
          line: null,
          branchDelta: delta,
        })
      }
    }
  }

  functions.sort((a, b) => b.branchDelta - a.branchDelta)

  const source =
    anyGrammar || !anyFallback ? 'tree-sitter · hunk base vs head' : 'keyword count · approximate'

  return { branchDelta: totalDelta, functions, source }
}

// ─── Coverage ───────────────────────────────────────────────────────────────────

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|py|rb|go|java|cs)$/

function isTestPath(path: string): boolean {
  return classifyTier(path) === 2
}

function testStem(path: string): string {
  return (path.split('/').pop() ?? path).toLowerCase()
}

async function computeCoverage(
  files: RawPrFile[],
  opts: ComputeInsightsOptions
): Promise<PrInsights['coverage']> {
  const sourceFiles = files.filter((f) => SOURCE_FILE_RE.test(pathOf(f)) && !isTestPath(pathOf(f)))
  const testFiles = files.filter((f) => isTestPath(pathOf(f)))

  const changedSourceFiles = sourceFiles.length
  const changedSourceFilesWithTests = sourceFiles.filter((src) => {
    const stem = testStem(src.path ?? src.filename ?? '').replace(/\.[^.]+$/, '')
    return testFiles.some((t) => testStem(t.path ?? t.filename ?? '').includes(stem))
  }).length

  // Names of every function changed in a (non-test) source file with a grammar.
  const changedFunctionNames: string[] = []
  for (const file of sourceFiles) {
    const path = pathOf(file)
    if (!file.patch) continue
    const diff = parseDiff(file.patch, path)
    const headText = diff.hunks.flatMap((h) => linesOf(h.lines, 'add')).join('\n')
    if (!headText) continue
    const analysis = await analyseSnippet(path, headText)
    if (!analysis) continue
    for (const fn of analysis.functions) changedFunctionNames.push(fn.name)
  }

  const referencedByPrTests = new Set<string>()
  for (const file of testFiles) {
    const path = pathOf(file)
    if (!file.patch) continue
    const diff = parseDiff(file.patch, path)
    const addedText = diff.hunks.flatMap((h) => linesOf(h.lines, 'add')).join('\n')
    if (!addedText) continue
    const analysis = await analyseSnippet(path, addedText)
    if (!analysis) continue
    for (const ref of analysis.references) referencedByPrTests.add(ref)
  }

  const uniqueChanged = [...new Set(changedFunctionNames)]
  const missingFromPrTests = uniqueChanged.filter((name) => !referencedByPrTests.has(name))
  const fromRepo =
    missingFromPrTests.length > 0 && opts.findTestReferences
      ? await opts.findTestReferences(missingFromPrTests)
      : new Set<string>()

  const untestedFunctions = missingFromPrTests.filter((name) => !fromRepo.has(name))
  const testedFunctions = uniqueChanged.length - untestedFunctions.length

  let patchPercent: number | null = null
  for (const check of opts.statusChecks) {
    const nameLower = check.name.toLowerCase()
    if (!COVERAGE_CHECK_NAMES.some((n) => nameLower.includes(n))) continue
    const match = check.description?.match(/(\d+(?:\.\d+)?)\s*%/)
    if (match) {
      patchPercent = Math.round(Number(match[1]))
      break
    }
  }
  if (patchPercent === null && opts.localCoverage != null) {
    patchPercent = Math.round(opts.localCoverage)
  }

  return {
    changedFunctions: uniqueChanged.length,
    testedFunctions,
    untestedFunctions,
    patchPercent,
    source: 'test files referencing each changed function',
    changedSourceFiles,
    changedSourceFilesWithTests,
  }
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

async function computeHealthFlags(
  files: RawPrFile[],
  dryViolations: DryViolation[]
): Promise<HealthFlag[]> {
  const flags: HealthFlag[] = []

  for (const file of files) {
    const path = pathOf(file)
    if (!file.patch) continue
    const diff = parseDiff(file.patch, path)
    const addedLines = diff.hunks.flatMap((h) => linesOf(h.lines, 'add'))
    const addedText = addedLines.join('\n')
    if (!addedText) continue

    if (/@ts-ignore/.test(addedText)) {
      flags.push({ kind: 'ts-ignore', label: 'New @ts-ignore', path })
    }
    if (/eslint-disable/.test(addedText)) {
      flags.push({ kind: 'eslint-disable', label: 'New eslint-disable', path })
    }
    if (/\b(TODO|FIXME)\b/.test(addedText)) {
      flags.push({ kind: 'todo', label: 'New TODO/FIXME', path })
    }
    if (/\.tsx?$/.test(path) && /:\s*any\b/.test(addedText)) {
      flags.push({ kind: 'any', label: 'New `any` type', path })
    }

    const language = await loadLanguageFor(path)
    if (!language) continue
    const parser = new Parser()
    parser.setLanguage(language)
    const tree = parser.parse(addedText)
    if (!tree) continue

    const visit = (n: Node): void => {
      if (FUNCTION_NODE_TYPES.has(n.type)) {
        const lineSpan = n.endPosition.row - n.startPosition.row + 1
        if (lineSpan > 80) {
          flags.push({ kind: 'long-function', label: `Function over 80 lines (${lineSpan})`, path })
        }
        const nesting = maxNestingDepth(n)
        if (nesting > 4) {
          flags.push({ kind: 'deep-nesting', label: `Nesting depth ${nesting}`, path })
        }
        const params = countParams(n)
        if (params > 5) {
          flags.push({ kind: 'many-params', label: `${params} parameters`, path })
        }
      }
      for (let i = 0; i < n.childCount; i++) visit(n.child(i)!)
    }
    visit(tree.rootNode)
  }

  for (const violation of dryViolations) {
    flags.push({
      kind: 'duplicate-block',
      label: `${violation.lineCount} duplicated lines across ${violation.files.length} files`,
      path: violation.files[0] ?? '',
    })
  }

  return flags
}

// ─── Understandability ──────────────────────────────────────────────────────────

async function computeUnderstandability(
  files: RawPrFile[],
  opts: ComputeInsightsOptions
): Promise<PrInsights['understandability']> {
  let linesToRead = 0
  let newExports = 0

  for (const file of files) {
    const path = pathOf(file)
    if (!file.patch || classifyTier(path) === 3) continue
    const diff = parseDiff(file.patch, path)
    for (const hunk of diff.hunks) {
      if (classifyHunk(hunk) !== 'semantic') continue
      linesToRead += linesOf(hunk.lines, 'add').length + linesOf(hunk.lines, 'remove').length
    }
    const addedText = diff.hunks.flatMap((h) => linesOf(h.lines, 'add')).join('\n')
    if (!addedText) continue
    const analysis = await analyseSnippet(path, addedText)
    if (analysis) newExports += analysis.definitions.length
  }

  const chainLength = new Map<number, number>()
  let longestChain = 0
  for (const step of opts.readingOrder) {
    let best = 1
    for (const use of step.uses) {
      if (use.definedInStep == null) continue
      best = Math.max(best, (chainLength.get(use.definedInStep) ?? 1) + 1)
    }
    chainLength.set(step.step, best)
    longestChain = Math.max(longestChain, best)
  }

  const chapterOf = new Map<string, string>()
  for (const chapter of opts.chapters) {
    for (const f of chapter.files) chapterOf.set(f.path, chapter.id)
  }
  let crossChapterRefs = 0
  for (const step of opts.readingOrder) {
    const stepChapter = chapterOf.get(step.path)
    for (const use of step.uses) {
      if (!use.definedInPath) continue
      const defChapter = chapterOf.get(use.definedInPath)
      if (defChapter && stepChapter && defChapter !== stepChapter) crossChapterRefs++
    }
  }

  const level: PrInsights['understandability']['level'] =
    linesToRead > 1000 || longestChain >= 6
      ? 'hard'
      : linesToRead < 300 && longestChain <= 2
        ? 'easy'
        : 'moderate'

  return {
    level,
    linesToRead,
    newExports,
    longestChain,
    crossChapterRefs,
    source: 'reading-order graph',
  }
}

/**
 * Computes the Review brief (R4): complexity, coverage, code health and
 * understandability, each with the source that produced it.
 */
export async function computeInsights(
  files: unknown[],
  opts: ComputeInsightsOptions
): Promise<PrInsights> {
  const rawFiles = files as RawPrFile[]
  const complexity = await computeComplexity(rawFiles)
  const coverage = await computeCoverage(rawFiles, opts)
  const flags = await computeHealthFlags(rawFiles, opts.dryViolations)
  const understandability = await computeUnderstandability(rawFiles, opts)

  return {
    complexity,
    coverage,
    health: { flags, source: 'tree-sitter · detectDryViolations' },
    understandability,
  }
}
