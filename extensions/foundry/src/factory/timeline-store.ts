import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { RunGraph } from '../line/run-graph.js'
import type { ToolActivity } from '../runtime/transcript-tailer.js'
import type { FrameNode, Timeline, ToolEntry, GraphFrame } from './replay.js'

// What a run did, written down as it happened, so the hall can play it back.
//
// One append-only JSON-lines file beside the order's run graph. Two writers:
// the graph writer, which records each node's standing when it changes, and
// the stall watcher, which already reads every live run's transcript and
// records each tool call it has not recorded before. Nothing here decides
// anything; a line that will not parse is skipped, never fatal.

export const TIMELINE_FILE = 'run-timeline.jsonl'

const NodeStateSchema = z.enum([
  'waiting',
  'ready',
  'running',
  'verifying',
  'passed',
  'failed',
  'blocked',
  'skipped',
])

const GraphLine = z.object({
  kind: z.literal('graph'),
  at: z.number(),
  nodes: z.array(
    z.object({
      id: z.string(),
      state: NodeStateSchema,
      attempts: z.number(),
      sessionId: z.string().nullable(),
    })
  ),
})

const ToolLine = z.object({
  kind: z.literal('tool'),
  at: z.number(),
  sessionId: z.string(),
  activity: z.object({
    kind: z.enum(['tool_started', 'tool_finished']),
    toolName: z.string(),
    callId: z.string(),
    isShell: z.boolean(),
    path: z.string().nullable(),
    at: z.number(),
  }),
})

const Line = z.discriminatedUnion('kind', [GraphLine, ToolLine])

// What each file last recorded, so a graph written twice with the same states
// and a transcript read every thirty seconds do not fill the file with repeats.
// Seeded from the file on first touch, so a restart does not repeat either.
interface Recorded {
  lastFrame: string | null
  tools: Set<string>
}
const recorded = new Map<string, Recorded>()

/** Drop what this process remembers writing. Tests stand in for a restart with it. */
export function forgetTimelines(): void {
  recorded.clear()
}

function fileOf(dir: string): string {
  return path.join(dir, TIMELINE_FILE)
}

function toolKey(sessionId: string, activity: ToolActivity): string {
  return `${sessionId}:${activity.callId}:${activity.kind}`
}

function frameKey(nodes: readonly FrameNode[]): string {
  return JSON.stringify(nodes)
}

/** Every well-formed line, in the order written. */
async function readLines(dir: string): Promise<z.infer<typeof Line>[]> {
  let raw: string
  try {
    raw = await fs.promises.readFile(fileOf(dir), 'utf8')
  } catch {
    return []
  }
  const lines: z.infer<typeof Line>[] = []
  for (const text of raw.split('\n')) {
    if (text.trim() === '') continue
    try {
      const parsed = Line.safeParse(JSON.parse(text))
      if (parsed.success) lines.push(parsed.data)
    } catch {
      // A torn or foreign line says nothing about the run; the rest still does.
    }
  }
  return lines
}

async function memoryOf(dir: string): Promise<Recorded> {
  const known = recorded.get(dir)
  if (known !== undefined) return known
  const memory: Recorded = { lastFrame: null, tools: new Set() }
  for (const line of await readLines(dir)) {
    if (line.kind === 'graph') memory.lastFrame = frameKey(line.nodes)
    else memory.tools.add(toolKey(line.sessionId, line.activity))
  }
  recorded.set(dir, memory)
  return memory
}

async function append(dir: string, lines: readonly unknown[]): Promise<void> {
  if (lines.length === 0) return
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.appendFile(fileOf(dir), lines.map((l) => `${JSON.stringify(l)}\n`).join(''))
}

/** Record each node's standing, when it differs from the last frame recorded. */
export async function recordGraph(dir: string, graph: RunGraph, at: number): Promise<void> {
  const nodes: FrameNode[] = graph.nodes.map((n) => ({
    id: n.id,
    state: n.state,
    attempts: n.attempts,
    sessionId: n.sessionId,
  }))
  const memory = await memoryOf(dir)
  const key = frameKey(nodes)
  if (memory.lastFrame === key) return
  memory.lastFrame = key
  await append(dir, [{ kind: 'graph', at, nodes }])
}

/** Record the tool calls in `activity` this timeline does not already hold. */
export async function recordTools(
  dir: string,
  sessionId: string,
  activity: readonly ToolActivity[]
): Promise<void> {
  const memory = await memoryOf(dir)
  const fresh = activity.filter((a) => !memory.tools.has(toolKey(sessionId, a)))
  for (const a of fresh) memory.tools.add(toolKey(sessionId, a))
  await append(
    dir,
    fresh.map((a) => ({ kind: 'tool', at: a.at, sessionId, activity: a }))
  )
}

/** The whole recording, in time order. */
export async function readTimeline(dir: string): Promise<Timeline> {
  const frames: GraphFrame[] = []
  const tools: ToolEntry[] = []
  const seen = new Set<string>()
  for (const line of await readLines(dir)) {
    if (line.kind === 'graph') {
      frames.push({ at: line.at, nodes: line.nodes })
      continue
    }
    const key = toolKey(line.sessionId, line.activity)
    if (seen.has(key)) continue
    seen.add(key)
    tools.push({ at: line.at, sessionId: line.sessionId, activity: line.activity })
  }
  frames.sort((a, b) => a.at - b.at)
  tools.sort((a, b) => a.at - b.at)
  return { frames, tools }
}
