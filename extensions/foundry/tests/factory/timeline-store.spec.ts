import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  recordGraph,
  recordTools,
  readTimeline,
  forgetTimelines,
  TIMELINE_FILE,
} from '../../src/factory/timeline-store.js'
import type { RunGraph, RunNode } from '../../src/line/run-graph.js'
import type { ToolActivity } from '../../src/runtime/transcript-tailer.js'

function node(id: string, over: Partial<RunNode> = {}): RunNode {
  return {
    id,
    stepId: id,
    kind: 'agent',
    state: 'waiting',
    unitIds: [],
    lane: null,
    role: 'builder',
    dependsOn: [],
    attempts: 0,
    sessionId: null,
    worktreePath: null,
    startedAt: null,
    endedAt: null,
    ...over,
  }
}

const graph = (states: Record<string, RunNode['state']>): RunGraph => ({
  orderId: 'WO-1',
  recipe: 'standard',
  nodes: Object.entries(states).map(([id, state]) => node(id, { state })),
})

function call(
  callId: string,
  at: number,
  kind: ToolActivity['kind'] = 'tool_started'
): ToolActivity {
  return { kind, toolName: 'Read', callId, isShell: false, path: 'a.ts', at }
}

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-timeline-'))
  forgetTimelines()
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('the run timeline', () => {
  it('records a frame each time the graph is written with different states, and only then', async () => {
    await recordGraph(dir, graph({ a: 'running', b: 'waiting' }), 1000)
    await recordGraph(dir, graph({ a: 'running', b: 'waiting' }), 2000)
    await recordGraph(dir, graph({ a: 'passed', b: 'running' }), 3000)
    const timeline = await readTimeline(dir)
    expect(timeline.frames.map((f) => f.at)).toEqual([1000, 3000])
    expect(timeline.frames[1].nodes).toEqual([
      { id: 'a', state: 'passed', attempts: 0, sessionId: null },
      { id: 'b', state: 'running', attempts: 0, sessionId: null },
    ])
  })

  it('does not repeat a frame after a restart forgets what it last wrote', async () => {
    await recordGraph(dir, graph({ a: 'running' }), 1000)
    forgetTimelines()
    await recordGraph(dir, graph({ a: 'running' }), 2000)
    expect((await readTimeline(dir)).frames).toHaveLength(1)
  })

  it('records each tool call once, however many times the transcript is read', async () => {
    await recordTools(dir, 's-1', [call('c1', 10)])
    await recordTools(dir, 's-1', [call('c1', 10), call('c1', 20, 'tool_finished'), call('c2', 30)])
    forgetTimelines()
    await recordTools(dir, 's-1', [call('c1', 10), call('c2', 30)])
    const tools = (await readTimeline(dir)).tools
    expect(tools.map((t) => `${t.activity.callId}:${t.activity.kind}`)).toEqual([
      'c1:tool_started',
      'c1:tool_finished',
      'c2:tool_started',
    ])
    expect(tools[0]).toMatchObject({ at: 10, sessionId: 's-1' })
  })

  it('reads an absent timeline as empty, and skips a line it cannot parse', async () => {
    expect(await readTimeline(dir)).toEqual({ frames: [], tools: [] })
    await recordGraph(dir, graph({ a: 'running' }), 1000)
    fs.appendFileSync(path.join(dir, TIMELINE_FILE), '{not json\n{"kind":"mystery"}\n')
    await recordGraph(dir, graph({ a: 'passed' }), 2000)
    expect((await readTimeline(dir)).frames.map((f) => f.at)).toEqual([1000, 2000])
  })

  it('returns frames and tools in time order whatever order they were written in', async () => {
    await recordTools(dir, 's-1', [call('late', 900)])
    await recordTools(dir, 's-1', [call('early', 100)])
    expect((await readTimeline(dir)).tools.map((t) => t.activity.callId)).toEqual(['early', 'late'])
  })
})
