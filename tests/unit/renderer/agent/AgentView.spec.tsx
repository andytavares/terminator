import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import type { AgentPermissionAsk, AgentUpdate } from '@terminator/extension-sdk'

import { AgentView } from '../../../../src/renderer/components/agent/AgentView'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { installElectronApi, pushedEvent } from '../../../support/electron-api'
import { terminalSessionOf } from '../../../support/renderer-stores'

const ask: AgentPermissionAsk = {
  sessionId: 'agent-1',
  requestId: 'req-1',
  toolCallId: 'tool-1',
  toolCallMeta: null,
  title: 'Run tests',
  kind: 'execute',
  rawInput: { command: 'npm test' },
  options: [
    { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
  ],
}

const text = (sessionUpdate: string, value: string): AgentUpdate => ({
  sessionUpdate,
  content: { type: 'text', text: value },
})

const updates = pushedEvent<[{ sessionId: string; update: AgentUpdate }]>()
const permissions = pushedEvent<[{ sessionId: string; ask: AgentPermissionAsk }]>()
const settled = pushedEvent<[{ sessionId: string; requestId: string }]>()
const ends = pushedEvent<[{ sessionId: string; exitCode: number | null }]>()

const agents = {
  history: vi.fn(),
  openAsks: vi.fn(),
  answer: vi.fn(),
  prompt: vi.fn(),
  cancel: vi.fn(),
}

async function mountView(): Promise<void> {
  render(<AgentView sessionId="agent-1" />)
  await act(async () => {})
}

const box = (): HTMLTextAreaElement => screen.getByLabelText('Message the agent')

beforeEach(() => {
  vi.clearAllMocks()
  agents.history.mockResolvedValue({ data: [text('agent_message_chunk', 'Earlier reply')] })
  agents.openAsks.mockResolvedValue({ data: [] })
  agents.answer.mockResolvedValue({ data: true })
  agents.prompt.mockResolvedValue({ data: { stopReason: 'end_turn' } })
  agents.cancel.mockResolvedValue({ data: true })
  installElectronApi({
    agents: {
      ...agents,
      onUpdate: updates.addListener,
      onPermission: permissions.addListener,
      onPermissionSettled: settled.addListener,
      onEnd: ends.addListener,
    },
  })
  useSessionStore.setState(useSessionStore.getInitialState())
  useSessionStore.setState({
    sessions: new Map([
      ['agent-1', terminalSessionOf({ id: 'agent-1', projectId: 'p1', surface: 'agent' })],
    ]),
  })
})

describe('AgentView transcript', () => {
  it('shows the history, then a live update, in a polite log', async () => {
    await mountView()
    const log = screen.getByRole('log')
    expect(log.getAttribute('aria-live')).toBe('polite')
    expect(within(log).getByText('Earlier reply')).toBeTruthy()
    act(() =>
      updates.deliver({ sessionId: 'agent-1', update: text('agent_message_chunk', ' More') })
    )
    expect(within(log).getByText('Earlier reply More')).toBeTruthy()
  })

  it('draws an update that arrives before the history once', async () => {
    let answer: (reply: { data: AgentUpdate[] }) => void = () => undefined
    agents.history.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    render(<AgentView sessionId="agent-1" />)
    const early = text('agent_message_chunk', 'Hello')
    act(() => updates.deliver({ sessionId: 'agent-1', update: early }))
    // Main logs an update before it broadcasts it, so the history read after it holds it.
    await act(async () => answer({ data: [early] }))
    expect(within(screen.getByRole('log')).getByText('Hello')).toBeTruthy()
  })

  it('ignores another session’s update', async () => {
    await mountView()
    act(() => updates.deliver({ sessionId: 'other', update: text('agent_message_chunk', 'Stray') }))
    expect(screen.queryByText(/Stray/)).toBeNull()
  })
})

describe('AgentView tool calls', () => {
  it('draws a tool call with its command and a collapsed diff', async () => {
    await mountView()
    act(() => {
      updates.deliver({
        sessionId: 'agent-1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 't1',
          title: 'Edit file',
          kind: 'edit',
          status: 'in_progress',
          locations: [{ path: '/src/a.ts' }],
          content: [{ type: 'diff', path: '/src/a.ts', oldText: 'old line', newText: 'new line' }],
        },
      })
    })
    expect(screen.getByText('Edit file')).toBeTruthy()
    expect(screen.getByText('/src/a.ts', { selector: '.agent-tool__detail' })).toBeTruthy()
    expect(screen.getByText(/new line/).closest('details')?.open).toBe(false)
  })
})

describe('AgentView usage', () => {
  it('shows usage as a percentage with the cost', async () => {
    await mountView()
    act(() =>
      updates.deliver({
        sessionId: 'agent-1',
        update: {
          sessionUpdate: 'usage_update',
          used: 50,
          size: 200,
          cost: { amount: 0.5, currency: 'USD' },
        },
      })
    )
    expect(screen.getByText(/25%/)).toBeTruthy()
    expect(screen.getByText(/\$0\.50/)).toBeTruthy()
  })
})

describe('AgentView permission asks', () => {
  it('shows an open ask with its command, answers it, and drops it when settled', async () => {
    agents.openAsks.mockResolvedValue({ data: [ask] })
    await mountView()
    expect(screen.getByText('Run tests')).toBeTruthy()
    expect(screen.getByText('npm test')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    expect(agents.answer).toHaveBeenCalledWith({
      sessionId: 'agent-1',
      requestId: 'req-1',
      optionId: 'allow',
    })
    act(() => settled.deliver({ sessionId: 'agent-1', requestId: 'req-1' }))
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull()
  })

  it('adds an ask that arrives live and ignores one for another session', async () => {
    await mountView()
    act(() => permissions.deliver({ sessionId: 'other', ask: { ...ask, sessionId: 'other' } }))
    expect(screen.queryByText('Run tests')).toBeNull()
    act(() => permissions.deliver({ sessionId: 'agent-1', ask }))
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy()
  })
})

describe('AgentView prompt box', () => {
  it('sends on Enter and clears the box', async () => {
    await mountView()
    fireEvent.change(box(), { target: { value: 'Fix it' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(agents.prompt).toHaveBeenCalledWith({ sessionId: 'agent-1', text: 'Fix it' })
    expect(box().value).toBe('')
  })

  it('keeps Shift+Enter as a newline and sends nothing', async () => {
    await mountView()
    fireEvent.change(box(), { target: { value: 'Fix it' } })
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })
    expect(agents.prompt).not.toHaveBeenCalled()
    expect(box().value).toBe('Fix it')
  })

  it('sends nothing for an empty box', async () => {
    await mountView()
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(agents.prompt).not.toHaveBeenCalled()
  })
})

describe('AgentView turn and exit', () => {
  it('disables the box while a turn runs and Stop cancels it', async () => {
    useSessionStore.getState().setAgentTurn('agent-1', true)
    await mountView()
    expect(box().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(agents.cancel).toHaveBeenCalledWith({ sessionId: 'agent-1' })
  })

  it('says the agent exited and disables the box when it ends', async () => {
    await mountView()
    act(() => ends.deliver({ sessionId: 'agent-1', exitCode: 1 }))
    expect(screen.getByText(/agent exited/i)).toBeTruthy()
    expect(box().disabled).toBe(true)
  })
})
