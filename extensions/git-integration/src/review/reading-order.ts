import { classifyTier, parseDiff } from '../github/pr-review-service'
import { analyseSnippet, symbolFromHunkHeader } from './symbols'
import type { ReadingStep, SymbolUse } from '../schemas/pr-review.schema'

interface RawPrFile {
  filename?: string
  path?: string
  status?: string
  additions?: number
  deletions?: number
  patch?: string
}

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

function referenceKind(addedText: string, symbol: string): ReferenceKind {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`<${escaped}\\b`).test(addedText)) return 'render'
  if (new RegExp(`\\b${escaped}\\s*\\(`).test(addedText)) return 'call'
  return 'use'
}

async function buildFileNode(file: RawPrFile): Promise<FileNode> {
  const path = file.path ?? file.filename ?? ''
  const additions = file.additions ?? 0
  const deletions = file.deletions ?? 0
  const tier = classifyTier(path)
  const diff = file.patch ? parseDiff(file.patch, path) : { path, hunks: [], isBinary: false }

  const definitions = new Set<string>()
  for (const hunk of diff.hunks) {
    const headerSymbol = symbolFromHunkHeader(hunk.header)
    if (headerSymbol) definitions.add(headerSymbol)
  }

  const definitionLines = diff.hunks
    .flatMap((h) => h.lines.filter((l) => l.type === 'add' || l.type === 'context'))
    .map((l) => l.content)
    .join('\n')
  const addedLines = diff.hunks
    .flatMap((h) => h.lines.filter((l) => l.type === 'add'))
    .map((l) => l.content)
  const addedText = addedLines.join('\n')

  const defAnalysis = definitionLines ? await analyseSnippet(path, definitionLines) : null
  const refAnalysis = addedText ? await analyseSnippet(path, addedText) : null
  const hasGrammar = defAnalysis !== null || refAnalysis !== null

  if (defAnalysis) for (const d of defAnalysis.definitions) definitions.add(d)

  const references = new Map<string, ReferenceKind>()
  if (refAnalysis) {
    for (const ref of refAnalysis.references) {
      if (definitions.has(ref)) continue
      references.set(ref, referenceKind(addedText, ref))
    }
  }

  return {
    path,
    size: additions + deletions,
    tier,
    isTest: tier === 2,
    hasGrammar,
    definitions,
    references,
  }
}

// ─── Tarjan SCC ─────────────────────────────────────────────────────────────────

function stronglyConnectedComponents(nodes: string[], edges: Map<string, Set<string>>): string[][] {
  let index = 0
  const indices = new Map<string, number>()
  const lowlink = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const result: string[][] = []

  function strongConnect(v: string): void {
    indices.set(v, index)
    lowlink.set(v, index)
    index++
    stack.push(v)
    onStack.add(v)

    for (const w of edges.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w)
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!))
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!))
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component: string[] = []
      let w: string
      do {
        w = stack.pop()!
        onStack.delete(w)
        component.push(w)
      } while (w !== v)
      result.push(component)
    }
  }

  for (const v of nodes) if (!indices.has(v)) strongConnect(v)
  return result
}

/**
 * Orders `files` for reading: symbols defined before they're used, test files
 * right after the last file they exercise, cycles kept adjacent, tier-3 last.
 */
export async function buildReadingOrder(rawFiles: unknown[]): Promise<ReadingStep[]> {
  const files = rawFiles as RawPrFile[]
  const nodes = await Promise.all(files.map(buildFileNode))
  if (nodes.length === 0) return []

  // First definer wins.
  const symbolMap = new Map<string, string>()
  for (const node of nodes) {
    for (const def of node.definitions) {
      if (!symbolMap.has(def)) symbolMap.set(def, node.path)
    }
  }

  const byPath = new Map(nodes.map((n) => [n.path, n]))

  const tier3 = nodes.filter((n) => n.tier === 3)
  const testNodes = nodes.filter((n) => n.tier !== 3 && n.isTest)
  const graphNodes = nodes.filter((n) => n.tier !== 3 && !n.isTest)
  const graphPaths = graphNodes.map((n) => n.path)

  // Edges: definer -> dependent ("read the definer before this file").
  const edges = new Map<string, Set<string>>()
  for (const path of graphPaths) edges.set(path, new Set())
  for (const node of graphNodes) {
    for (const symbol of node.references.keys()) {
      const definer = symbolMap.get(symbol)
      if (!definer || definer === node.path) continue
      if (!edges.has(definer)) continue // definer outside the graph (test/tier3) — no ordering edge
      edges.get(definer)!.add(node.path)
    }
  }

  const sccs = stronglyConnectedComponents(graphPaths, edges)
  const sccOf = new Map<string, number>()
  sccs.forEach((component, i) => component.forEach((path) => sccOf.set(path, i)))

  // Condensed DAG over SCCs.
  const condensedEdges = new Map<number, Set<number>>()
  const condensedIndegree = new Map<number, number>()
  sccs.forEach((_, i) => {
    condensedEdges.set(i, new Set())
    condensedIndegree.set(i, 0)
  })
  for (const [from, tos] of edges) {
    const fromScc = sccOf.get(from)!
    for (const to of tos) {
      const toScc = sccOf.get(to)!
      if (fromScc === toScc) continue
      if (!condensedEdges.get(fromScc)!.has(toScc)) {
        condensedEdges.get(fromScc)!.add(toScc)
        condensedIndegree.set(toScc, condensedIndegree.get(toScc)! + 1)
      }
    }
  }

  const sccSize = (i: number): number => sccs[i].reduce((s, p) => s + byPath.get(p)!.size, 0)

  const placedSccs = new Set<number>()
  const orderedPaths: string[] = []
  const remaining = new Set(sccs.map((_, i) => i))

  while (remaining.size > 0) {
    const available = [...remaining].filter((i) => condensedIndegree.get(i) === 0)
    available.sort((a, b) => sccSize(b) - sccSize(a))
    const next = available[0]
    remaining.delete(next)
    placedSccs.add(next)
    const members = [...sccs[next]].sort((a, b) => byPath.get(b)!.size - byPath.get(a)!.size)
    orderedPaths.push(...members)
    for (const to of condensedEdges.get(next) ?? []) {
      condensedIndegree.set(to, condensedIndegree.get(to)! - 1)
    }
  }

  // Attach test files right after the last file (by final position) they reference.
  const positionOf = new Map(orderedPaths.map((p, i) => [p, i]))
  for (const test of testNodes) {
    let insertAfter = -1
    for (const symbol of test.references.keys()) {
      const definer = symbolMap.get(symbol)
      if (!definer) continue
      const pos = positionOf.get(definer)
      if (pos !== undefined && pos > insertAfter) insertAfter = pos
    }
    if (insertAfter === -1) {
      orderedPaths.push(test.path) // fallback: no in-PR reference found
    } else {
      orderedPaths.splice(insertAfter + 1, 0, test.path)
    }
    // Recompute positions after each insertion.
    orderedPaths.forEach((p, i) => positionOf.set(p, i))
  }

  for (const node of tier3) orderedPaths.push(node.path)

  const finalOrder = orderedPaths
  const stepOf = new Map(finalOrder.map((p, i) => [p, i + 1]))

  // How many *other* files reference each symbol — used to pick each file's
  // headline symbol and whether anything in this PR depends on it.
  const usageCount = new Map<string, number>()
  for (const node of nodes) {
    for (const symbol of node.references.keys()) {
      usageCount.set(symbol, (usageCount.get(symbol) ?? 0) + 1)
    }
  }

  const steps: ReadingStep[] = finalOrder.map((path) => {
    const node = byPath.get(path)!
    const step = stepOf.get(path)!

    let mainSymbol: string | null = null
    let mainSymbolCount = -1
    for (const def of node.definitions) {
      const count = usageCount.get(def) ?? 0
      if (count > mainSymbolCount) {
        mainSymbol = def
        mainSymbolCount = count
      }
    }
    const uses: SymbolUse[] = [...node.references.keys()].map((symbol) => {
      const definer = symbolMap.get(symbol)
      const definedInStep = definer ? (stepOf.get(definer) ?? null) : null
      return { symbol, definedInStep: definedInStep ?? null, definedInPath: definer ?? null }
    })

    interface Candidate {
      symbol: string
      kind: ReferenceKind
      step: number
    }
    const kindPriority: Record<ReferenceKind, number> = { call: 0, render: 1, use: 2 }
    const candidates: Candidate[] = []
    for (const [symbol, kind] of node.references) {
      const definer = symbolMap.get(symbol)
      if (!definer || definer === path) continue
      const definerStep = stepOf.get(definer)
      if (definerStep === undefined) continue
      candidates.push({ symbol, kind, step: definerStep })
    }
    candidates.sort((a, b) => kindPriority[a.kind] - kindPriority[b.kind] || a.step - b.step)
    const primary = candidates[0]

    let reason: string
    if (node.isTest) {
      reason =
        primary !== undefined
          ? `Tests step ${primary.step}, read right after it`
          : 'Tests nothing in this PR, read wherever'
    } else if (primary !== undefined) {
      const word =
        primary.kind === 'call' ? 'Calls' : primary.kind === 'render' ? 'Renders' : 'Uses'
      reason = `${word} ${primary.symbol} (step ${primary.step})`
    } else if (mainSymbol !== null) {
      reason = `Defines ${mainSymbol} · depends on nothing in this PR`
    } else {
      reason = 'No dependencies detected in this PR'
    }

    return { step, path, symbol: mainSymbol, reason, uses }
  })

  return steps
}
