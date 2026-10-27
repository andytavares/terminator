import { describe, it, expect } from 'vitest'
import type { AgentUpdate, AgentsAPI } from '@terminator/extension-sdk'
import { trackToolActivity } from '../../src/runtime/tool-activity.js'
import { partialFake } from '../../../../tests/support/fakes'

function trackedSession() {
  let send: (update: AgentUpdate) => void = () => undefined
  const agents = partialFake<AgentsAPI>({
    onUpdate: (_sessionId, listener) => {
      send = listener
      return () => undefined
    },
  })
  const tracker = trackToolActivity(agents, 's-1', () => 1000)
  return { tracker, send: (update: AgentUpdate) => send(update) }
}

const started = (id: number): AgentUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId: `call-${id}`,
  rawInput: { file_path: `src/${id}.ts` },
  _meta: { claudeCode: { toolName: 'Read' } },
})

describe('a session making many tool calls', () => {
  it('keeps only its most recent thousand events', () => {
    const { tracker, send } = trackedSession()
    for (let id = 1; id <= 1200; id++) send(started(id))
    const activity = tracker.activity()
    expect(activity).toHaveLength(1000)
    expect(activity.at(-1)).toMatchObject({ callId: 'call-1200', path: 'src/1200.ts' })
  })

  it('records a finish with the name its start carried', () => {
    const { tracker, send } = trackedSession()
    send(started(1))
    send({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed' })
    expect(tracker.activity().map((event) => [event.kind, event.toolName])).toEqual([
      ['tool_started', 'Read'],
      ['tool_finished', 'Read'],
    ])
  })
})
