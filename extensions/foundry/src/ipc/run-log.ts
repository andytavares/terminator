import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import type { ExtensionAPI } from '@terminator/extension-sdk'

import { orderDir } from '../data-root.js'
import { nodeLabels, type RunNode } from '../line/run-graph.js'
import { transcriptPathFor } from '../runtime/claude-launch.js'
import { runtime } from '../runtime/runtime-state.js'
import { readTranscriptTail } from '../runtime/transcript-excerpt.js'
import { tailLines } from '../runtime/transcript-tailer.js'
import { orderStoreAt, readGraph } from '../state/live-index.js'
import { resolveFoundryDataRoot } from '../workspace-root.js'

const DEFAULT_LINES = 500
const MAX_LINES = 5000
/** The last lines kept of one command's log; its header says where the whole log is. */
const COMMAND_TAIL_LINES = 200

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

/** Everything the order's stations said, decided and ran, oldest first. Reads files only. */
export async function runLog(
  api: ExtensionAPI,
  { orderId, limit = DEFAULT_LINES }: z.infer<typeof RunLogPayload>
): Promise<{ lines: RunLogLine[] }> {
  const root = resolveFoundryDataRoot(api)
  const store = orderStoreAt(root)
  const graph = await readGraph(root, orderId)
  const order = await store.load(orderId)
  const labels = graph === null ? {} : nodeLabels(order, graph)
  const logs = await commandLogs(orderDir(root, orderId))
  const entries = [
    ...(graph?.nodes ?? []).flatMap((node) =>
      stationLines(node, labels[node.id] ?? node.id, limit)
    ),
    ...(await store.entries(orderId)).map(decisionLine),
    ...logs.map((log) => log.header),
  ]
  // The limit counts entries; a command's output rides under its header, so a long
  // suite log cannot push out what the stations said.
  const newest = entries.sort((a, b) => a.at - b.at).slice(-limit)
  const bodies = new Map(logs.map((log) => [log.header, log.body]))
  return { lines: newest.flatMap((line) => [line, ...(bodies.get(line) ?? [])]) }
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

interface CommandLog {
  readonly header: RunLogLine
  readonly body: RunLogLine[]
}

/** Each file in the order's `runs/` folder: a header line, and its last lines. */
async function commandLogs(orderFolder: string): Promise<CommandLog[]> {
  const folder = path.join(orderFolder, 'runs')
  const names = await fs.promises.readdir(folder).catch(() => [] as string[])
  const logs = await Promise.all(names.map((name) => oneLog(path.join(folder, name))))
  return logs.filter((log): log is CommandLog => log !== null)
}

async function oneLog(logPath: string): Promise<CommandLog | null> {
  const stat = await fs.promises.stat(logPath).catch(() => null)
  if (stat === null || !stat.isFile()) return null
  const lines = tailLines(logPath) ?? []
  if (lines.at(-1) === '') lines.pop()
  const line = (text: string): RunLogLine => ({
    at: stat.mtimeMs,
    station: 'commands',
    role: null,
    kind: 'command',
    text,
    logPath,
  })
  return {
    header: line(`${path.basename(logPath)} · ${stat.mtime.toISOString()}`),
    body: lines.slice(-COMMAND_TAIL_LINES).map(line),
  }
}
