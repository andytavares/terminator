import { classifyTier } from '../github/pr-review-service'
import { analyseLines } from './symbols'
import { symbolFromHunkHeader } from './hunk-header'
import type { ReadingStep, SymbolUse } from '../schemas/pr-review.schema'
import type { FileDiff } from '../schemas/git.schema'
import type { ParsedPrFile } from './parsed-file'

type ReferenceKind = 'call' | 'render' | 'use'

interface FileNode {
  path: string
  size: number
  tier: 0 | 1 | 2 | 3
  isTest: boolean
  hasGrammar: boolean
  definitions: Set<string>
  /** symbol -> how it first appears in the added lines */
  references: Map<string, ReferenceKind>
}

interface StepContext {
  byPath: Map<string, FileNode>
  definerOf: Map<string, string>
  stepOf: Map<string, number>
  /** How many files reference each symbol. */
  usageCount: Map<string, number>
}

/** A reference to a symbol another file defines, at that file's step. */
interface Candidate {
  symbol: string
  kind: ReferenceKind
  step: number
}

const KIND_PRIORITY: Record<ReferenceKind, number> = { call: 0, render: 1, use: 2 }
const KIND_VERB: Record<ReferenceKind, string> = { call: 'Calls', render: 'Renders', use: 'Uses' }

function referenceKind(addedText: string, symbol: string): ReferenceKind {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // A JSX element opens after whitespace, `(`, `{`, `=`, `>` or `?`/`:`; a type
  // argument (`Record<Priority, …>`) follows an identifier, so it is a use.
  if (new RegExp(`(^|[\\s({=>?:,])<${escaped}\\b`, 'm').test(addedText)) return 'render'
  if (new RegExp(`\\b${escaped}\\s*\\(`).test(addedText)) return 'call'
  return 'use'
}

function hunkHeaderSymbols(diff: FileDiff): string[] {
  return diff.hunks.flatMap((hunk) => symbolFromHunkHeader(hunk.header) ?? [])
}

function referencesOutside(
  symbols: string[],
  definitions: Set<string>,
  addedText: string
): Map<string, ReferenceKind> {
  const references = new Map<string, ReferenceKind>()
  for (const ref of symbols) {
    if (!definitions.has(ref)) references.set(ref, referenceKind(addedText, ref))
  }
  return references
}

async function buildFileNode(file: ParsedPrFile): Promise<FileNode> {
  const { path, additions, deletions, diff } = file
  const tier = classifyTier(path)
  const headLines = diff.hunks.flatMap((h) => h.lines.filter((l) => l.type !== 'remove'))
  const addedLines = diff.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add'))
  const defAnalysis = await analyseLines(path, headLines)
  const refAnalysis = await analyseLines(path, addedLines)
  const definitions = new Set([...hunkHeaderSymbols(diff), ...(defAnalysis?.definitions ?? [])])
  const addedText = addedLines.map((l) => l.content).join('\n')
  return {
    path,
    size: additions + deletions,
    tier,
    isTest: tier === 2,
    hasGrammar: defAnalysis !== null || refAnalysis !== null,
    definitions,
    references: referencesOutside(refAnalysis?.references ?? [], definitions, addedText),
  }
}

// ─── Tarjan SCC ─────────────────────────────────────────────────────────────────

interface TarjanState {
  edges: Map<string, Set<string>>
  index: number
  indices: Map<string, number>
  lowlink: Map<string, number>
  onStack: Set<string>
  stack: string[]
  components: string[][]
}

function popComponent(state: TarjanState, root: string): string[] {
  const component: string[] = []
  let w: string
  do {
    w = state.stack.pop()!
    state.onStack.delete(w)
    component.push(w)
  } while (w !== root)
  return component
}

function strongConnect(state: TarjanState, v: string): void {
  state.indices.set(v, state.index)
  state.lowlink.set(v, state.index)
  state.index++
  state.stack.push(v)
  state.onStack.add(v)
  for (const w of state.edges.get(v) ?? []) {
    if (!state.indices.has(w)) {
      strongConnect(state, w)
      state.lowlink.set(v, Math.min(state.lowlink.get(v)!, state.lowlink.get(w)!))
    } else if (state.onStack.has(w)) {
      state.lowlink.set(v, Math.min(state.lowlink.get(v)!, state.indices.get(w)!))
    }
  }
  if (state.lowlink.get(v) === state.indices.get(v)) state.components.push(popComponent(state, v))
}

function stronglyConnectedComponents(nodes: string[], edges: Map<string, Set<string>>): string[][] {
  const state: TarjanState = {
    edges,
    index: 0,
    indices: new Map(),
    lowlink: new Map(),
    onStack: new Set(),
    stack: [],
    components: [],
  }
  for (const v of nodes) if (!state.indices.has(v)) strongConnect(state, v)
  return state.components
}

// ─── Ordering ───────────────────────────────────────────────────────────────────

/** Symbol -> path of the first file that defines it. */
function firstDefiners(nodes: FileNode[]): Map<string, string> {
  const definerOf = new Map<string, string>()
  for (const node of nodes) {
    for (const def of node.definitions) {
      if (!definerOf.has(def)) definerOf.set(def, node.path)
    }
  }
  return definerOf
}

/** Edges definer -> dependent: "read the definer before this file". */
function dependencyEdges(
  graphNodes: FileNode[],
  definerOf: Map<string, string>
): Map<string, Set<string>> {
  const edges = new Map(graphNodes.map((n) => [n.path, new Set<string>()]))
  for (const node of graphNodes) {
    for (const symbol of node.references.keys()) {
      const definer = definerOf.get(symbol)
      if (!definer || definer === node.path) continue
      // A definer outside the graph (a test or tier-3 file) adds no ordering edge.
      edges.get(definer)?.add(node.path)
    }
  }
  return edges
}

/** The DAG of components: which components each one must precede, and how many precede it. */
function condensedDag(components: string[][], edges: Map<string, Set<string>>) {
  const componentOf = new Map<string, number>()
  components.forEach((members, i) => members.forEach((path) => componentOf.set(path, i)))
  const successors = new Map(components.map((_, i) => [i, new Set<number>()]))
  const indegree = new Map(components.map((_, i) => [i, 0]))
  for (const [from, tos] of edges) {
    const fromComponent = componentOf.get(from)!
    for (const to of tos) {
      const toComponent = componentOf.get(to)!
      if (fromComponent === toComponent || successors.get(fromComponent)!.has(toComponent)) continue
      successors.get(fromComponent)!.add(toComponent)
      indegree.set(toComponent, indegree.get(toComponent)! + 1)
    }
  }
  return { successors, indegree }
}

/** Topological order of the components, the largest free component first, its biggest file first. */
function orderByDependency(
  components: string[][],
  edges: Map<string, Set<string>>,
  byPath: Map<string, FileNode>
): string[] {
  const { successors, indegree } = condensedDag(components, edges)
  const sizeOf = (path: string) => byPath.get(path)!.size
  const componentSize = (i: number) => components[i].reduce((s, p) => s + sizeOf(p), 0)
  const remaining = new Set(components.map((_, i) => i))
  const ordered: string[] = []
  while (remaining.size > 0) {
    const available = [...remaining].filter((i) => indegree.get(i) === 0)
    available.sort((a, b) => componentSize(b) - componentSize(a))
    const next = available[0]
    remaining.delete(next)
    ordered.push(...[...components[next]].sort((a, b) => sizeOf(b) - sizeOf(a)))
    for (const to of successors.get(next) ?? []) indegree.set(to, indegree.get(to)! - 1)
  }
  return ordered
}

function lastReferencedPosition(
  test: FileNode,
  definerOf: Map<string, string>,
  ordered: string[]
): number {
  let last = -1
  for (const symbol of test.references.keys()) {
    const definer = definerOf.get(symbol)
    if (definer) last = Math.max(last, ordered.indexOf(definer))
  }
  return last
}

/** Places each test file right after the last file (by final position) it references. */
function withTestsAttached(
  ordered: string[],
  testNodes: FileNode[],
  definerOf: Map<string, string>
): string[] {
  const result = [...ordered]
  for (const test of testNodes) {
    const insertAfter = lastReferencedPosition(test, definerOf, result)
    if (insertAfter === -1) {
      result.push(test.path) // fallback: no in-PR reference found
    } else {
      result.splice(insertAfter + 1, 0, test.path)
    }
  }
  return result
}

// ─── Steps ──────────────────────────────────────────────────────────────────────

function referenceCounts(nodes: FileNode[]): Map<string, number> {
  const usageCount = new Map<string, number>()
  for (const node of nodes) {
    for (const symbol of node.references.keys()) {
      usageCount.set(symbol, (usageCount.get(symbol) ?? 0) + 1)
    }
  }
  return usageCount
}

/** The file's definition the most other files use; the first one on a tie. */
function headlineSymbol(node: FileNode, usageCount: Map<string, number>): string | null {
  let mainSymbol: string | null = null
  let mainSymbolCount = -1
  for (const def of node.definitions) {
    const count = usageCount.get(def) ?? 0
    if (count > mainSymbolCount) {
      mainSymbol = def
      mainSymbolCount = count
    }
  }
  return mainSymbol
}

function symbolUses(node: FileNode, ctx: StepContext): SymbolUse[] {
  return [...node.references.keys()].map((symbol) => {
    const definer = ctx.definerOf.get(symbol)
    const definedInStep = definer ? (ctx.stepOf.get(definer) ?? null) : null
    return { symbol, definedInStep: definedInStep ?? null, definedInPath: definer ?? null }
  })
}

/** The reference that best explains the file's place: calls before renders before uses, then earliest step. */
function primaryReference(node: FileNode, ctx: StepContext): Candidate | undefined {
  const candidates: Candidate[] = []
  for (const [symbol, kind] of node.references) {
    const definer = ctx.definerOf.get(symbol)
    if (!definer || definer === node.path) continue
    const definerStep = ctx.stepOf.get(definer)
    if (definerStep !== undefined) candidates.push({ symbol, kind, step: definerStep })
  }
  candidates.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || a.step - b.step)
  return candidates[0]
}

function stepReason(node: FileNode, primary: Candidate | undefined, mainSymbol: string | null) {
  if (node.isTest && primary !== undefined) {
    return `Tests step ${primary.step}, read right after it`
  }
  if (node.isTest) return 'Tests nothing in this PR, read wherever'
  if (primary !== undefined)
    return `${KIND_VERB[primary.kind]} ${primary.symbol} (step ${primary.step})`
  if (mainSymbol !== null) return `Defines ${mainSymbol} · depends on nothing in this PR`
  return 'No dependencies detected in this PR'
}

function readingStepFor(path: string, ctx: StepContext): ReadingStep {
  const node = ctx.byPath.get(path)!
  const mainSymbol = headlineSymbol(node, ctx.usageCount)
  const reason = stepReason(node, primaryReference(node, ctx), mainSymbol)
  return {
    step: ctx.stepOf.get(path)!,
    path,
    symbol: mainSymbol,
    reason,
    uses: symbolUses(node, ctx),
  }
}

/** Orders `files` for reading: symbols defined before they're used, test files right after
 * the last file they exercise, cycles kept adjacent, tier-3 last. */
export async function buildReadingOrder(files: ParsedPrFile[]): Promise<ReadingStep[]> {
  const nodes = await Promise.all(files.map(buildFileNode))
  if (nodes.length === 0) return []
  const definerOf = firstDefiners(nodes)
  const byPath = new Map(nodes.map((n) => [n.path, n]))
  const graphNodes = nodes.filter((n) => n.tier !== 3 && !n.isTest)
  const edges = dependencyEdges(graphNodes, definerOf)
  const components = stronglyConnectedComponents(
    graphNodes.map((n) => n.path),
    edges
  )
  const testNodes = nodes.filter((n) => n.tier !== 3 && n.isTest)
  const finalOrder = [
    ...withTestsAttached(orderByDependency(components, edges, byPath), testNodes, definerOf),
    ...nodes.filter((n) => n.tier === 3).map((n) => n.path),
  ]
  const stepOf = new Map(finalOrder.map((p, i) => [p, i + 1]))
  const ctx: StepContext = { byPath, definerOf, stepOf, usageCount: referenceCounts(nodes) }
  return finalOrder.map((path) => readingStepFor(path, ctx))
}
