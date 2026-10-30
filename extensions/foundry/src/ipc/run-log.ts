import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import type { ExtensionAPI } from '@terminator/extension-sdk'

import { orderDir } from '../data-root.js'
import { nodeLabels, type RunNode } from '../line/run-graph.js'
import { transcriptPathFor } from '../runtime/claude-launch.js'
import { runtime } from '../runtime/runtime-state.js'
import { readTranscriptTail } from '../runtime/transcript-excerpt.js'
import { orderStoreAt, readGraph } from '../state/live-index.js'
import { resolveFoundryDataRoot } from '../workspace-root.js'

const DEFAULT_LINES = 500
const MAX_LINES = 5000

export const RunLogPayload = z.object({
  orderId: z.string(),
  limit: z.number().int().positive().max(MAX_LINES).optional(),
})

export interface RunLogLine {
  readonly at: number
  /** The node's label, the ledger's actor, or `commands`. */
  readonly station: string
  readonly role: string | null
  readonly kind: 'say' | 'tool' | 'decision' | 'command'
  readonly text: string
  readonly logPath?: string
}

/**
 * Everything the order's stations said, decided and ran, oldest first.
 *
 * Reads files and the index only. A finished session has no stored transcript path, so it is
 * found where Claude keeps it for the node's worktree.
 */
export async function runLog(
  api: ExtensionAPI,
  { orderId, limit = DEFAULT_LINES }: z.infer<typeof RunLogPayload>
): Promise<{ lines: RunLogLine[] }> {
  const root = resolveFoundryDataRoot(api)
  const store = orderStoreAt(root)
  const graph = await readGraph(root, orderId)
  const order = await store.load(orderId)
  const labels = graph === null ? {} : nodeLabels(order, graph)
  const merged = [
    ...(graph?.nodes ?? []).flatMap((node) =>
      stationLines(node, labels[node.id] ?? node.id, limit)
    ),
    ...(await store.entries(orderId)).map(decisionLine),
    ...(await commandLines(orderDir(root, orderId), limit)),
  ]
  return { lines: merged.sort((a, b) => a.at - b.at).slice(-limit) }
}

function transcriptPathOf(node: RunNode): string | null {
  if (node.sessionId === null) return null
  const live = runtime.supervision?.runs.get(node.sessionId)
  if (live) return live.transcriptPath
  return node.worktreePath === null ? null : transcriptPathFor(node.worktreePath, node.sessionId)
}

function stationLines(node: RunNode, station: string, limit: number): RunLogLine[] {
  const file = transcriptPathOf(node)
  if (file === null) return []
  return readTranscriptTail(file, limit).map((line) => ({
    at: line.at,
    station,
    role: node.role,
    kind: line.kind === 'tool' ? 'tool' : 'say',
    text: line.text,
  }))
}

function decisionLine(entry: {
  at: string
  actor: string
  action: string
  reason: string
}): RunLogLine {
  return {
    at: Date.parse(entry.at) || 0,
    station: entry.actor,
    role: null,
    kind: 'decision',
    text: `${entry.action} · ${entry.reason}`,
  }
}

/** A header line per file in the order's `runs/` folder, then its lines. */
async function commandLines(orderFolder: string, limit: number): Promise<RunLogLine[]> {
  const folder = path.join(orderFolder, 'runs')
  const names = await fs.promises.readdir(folder).catch(() => [] as string[])
  const perFile = await Promise.all(names.map((name) => oneLog(path.join(folder, name), limit)))
  return perFile.flat()
}

async function oneLog(logPath: string, limit: number): Promise<RunLogLine[]> {
  try {
    const stat = await fs.promises.stat(logPath)
    if (!stat.isFile()) return []
    const body = (await fs.promises.readFile(logPath, 'utf8')).replace(/\n$/, '').split('\n')
    const line = (text: string): RunLogLine => ({
      at: stat.mtimeMs,
      station: 'commands',
      role: null,
      kind: 'command',
      text,
      logPath,
    })
    return [
      line(`${path.basename(logPath)} · ${stat.mtime.toISOString()}`),
      ...body.slice(-limit).map(line),
    ]
  } catch {
    return []
  }
}
