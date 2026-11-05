import { describe, it, expect } from 'vitest'
import {
  emptyTranscript,
  foldUpdates,
  inputSummary,
  relativeTo,
  splitTurns,
} from '../../../../src/renderer/components/agent/fold-updates'
import type { AgentUpdate } from '@terminator/extension-sdk'

const chunk = (sessionUpdate: string, text: string): AgentUpdate => ({
  sessionUpdate,
  content: { type: 'text', text },
})

const foldAll = (updates: AgentUpdate[]) => updates.reduce(foldUpdates, emptyTranscript)

describe('foldUpdates', () => {
  it('joins consecutive chunks of one kind into one message', () => {
    const { entries } = foldAll([
      chunk('agent_message_chunk', 'Hel'),
      chunk('agent_message_chunk', 'lo'),
    ])
    expect(entries).toEqual([{ kind: 'message', role: 'agent', text: 'Hello' }])
  })

  it('starts a new message when the kind changes', () => {
    const { entries } = foldAll([
      chunk('user_message_chunk', 'hi'),
      chunk('agent_thought_chunk', 'hmm'),
      chunk('agent_message_chunk', 'yes'),
    ])
    expect(entries.map((e) => e.kind === 'message' && e.role)).toEqual(['user', 'thought', 'agent'])
  })
})

describe('foldUpdates — tool calls', () => {
  it('creates a tool call and updates it in place by toolCallId', () => {
    const { entries } = foldAll([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Run tests',
        kind: 'execute',
        status: 'pending',
        rawInput: { command: 'npm test' },
      },
      chunk('agent_message_chunk', 'running'),
      { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' },
    ])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      kind: 'tool',
      toolCallId: 't1',
      title: 'Run tests',
      toolKind: 'execute',
      status: 'completed',
      detail: 'npm test',
    })
  })
})

describe('foldUpdates — tool output', () => {
  it('keeps a diff and text output from a tool call update', () => {
    const { entries } = foldAll([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Edit',
        locations: [{ path: '/a.ts' }],
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        content: [
          { type: 'diff', path: '/a.ts', oldText: 'a', newText: 'b' },
          { type: 'content', content: { type: 'text', text: 'done' } },
        ],
      },
    ])
    expect(entries[0]).toMatchObject({
      detail: '/a.ts',
      output: [
        { kind: 'diff', path: '/a.ts', oldText: 'a', newText: 'b' },
        { kind: 'text', text: 'done' },
      ],
    })
  })

  it('ignores an update for a tool call it never saw', () => {
    expect(foldAll([{ sessionUpdate: 'tool_call_update', toolCallId: 'x' }]).entries).toEqual([])
  })
})

describe('foldUpdates — plan and usage', () => {
  it('replaces the plan on each plan update', () => {
    const plan = (content: string): AgentUpdate => ({
      sessionUpdate: 'plan',
      entries: [{ content, status: 'pending', priority: 'high' }],
    })
    expect(foldAll([plan('one'), plan('two')]).plan).toEqual([
      { content: 'two', status: 'pending', priority: 'high' },
    ])
  })

  it('keeps the latest usage while later entries arrive', () => {
    const state = foldAll([
      {
        sessionUpdate: 'usage_update',
        used: 50,
        size: 200,
        cost: { amount: 0.5, currency: 'USD' },
      },
      chunk('agent_message_chunk', 'x'),
    ])
    expect(state.usage).toEqual({ used: 50, size: 200, cost: { amount: 0.5, currency: 'USD' } })
  })

  it('leaves state alone for an update it does not draw', () => {
    expect(foldAll([{ sessionUpdate: 'current_mode_update' }])).toEqual(emptyTranscript)
  })
})

describe('inputSummary', () => {
  it.each([
    [{ command: 'ls' }, 'ls'],
    [{ file_path: '/a.ts' }, '/a.ts'],
    [{ path: '/b.ts' }, '/b.ts'],
    [{ other: 1 }, null],
    ['text', null],
  ])('reads %j as %j', (input, expected) => {
    expect(inputSummary(input)).toBe(expected)
  })
})

const edit = (id: string, path: string, change: [string | null, string]): AgentUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId: id,
  title: 'Edit',
  content: [{ type: 'diff', path, oldText: change[0], newText: change[1] }],
})

describe('splitTurns', () => {
  it('counts two edits to one file as one changed file, per turn', () => {
    const { entries } = foldAll([
      chunk('user_message_chunk', 'first'),
      edit('t1', '/r/a.ts', ['one', 'two']),
      edit('t2', '/r/a.ts', ['two', 'two\nthree']),
      chunk('user_message_chunk', 'second'),
      edit('t3', '/r/b.ts', ['x', 'y']),
    ])
    const turns = splitTurns(entries)
    expect(turns).toHaveLength(2)
    expect(turns[0].changes).toEqual([{ path: '/r/a.ts', added: 2, removed: 1 }])
    expect(turns[1].changes).toEqual([{ path: '/r/b.ts', added: 1, removed: 1 }])
  })

  it('keeps a null old text as null and has no changes for a text-only turn', () => {
    const { entries } = foldAll([edit('t1', '/r/a.ts', [null, 'snippet'])])
    expect(entries[0]).toMatchObject({ output: [{ kind: 'diff', oldText: null }] })
    expect(splitTurns(foldAll([chunk('agent_message_chunk', 'hi')]).entries)[0].changes).toEqual([])
  })
})

describe('relativeTo', () => {
  it('strips the session directory and leaves other paths alone', () => {
    expect(relativeTo('/r', '/r/src/a.ts')).toBe('src/a.ts')
    expect(relativeTo('/r', '/rx/a.ts')).toBe('/rx/a.ts')
    expect(relativeTo('', '/r/a.ts')).toBe('/r/a.ts')
  })
})
