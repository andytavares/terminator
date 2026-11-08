import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

import { Composer } from '../../../../src/renderer/components/agent/Composer'
import {
  noAttachedContext,
  promptWithContext,
  type AttachedContext,
  type Citation,
} from '../../../../src/renderer/components/agent/attached-context'
import { SESSION_DRAG_TYPE } from '../../../../src/renderer/components/agent/session-drag'
import {
  attachedOf,
  useAttachedContextStore,
} from '../../../../src/renderer/stores/attached-context.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useSessionRecordsStore } from '../../../../src/renderer/stores/session-records.store'
import { useTabDragStore } from '../../../../src/renderer/terminal/tab-drag'
import type { SessionRecordListing } from '../../../../src/shared/types/index'
import { installElectronApi, pushedEvent } from '../../../support/electron-api'
import { partialFake } from '../../../support/fakes'
import { terminalSessionOf } from '../../../support/renderer-stores'

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

const agents = {
  history: vi.fn(),
  prompt: vi.fn(),
  cancel: vi.fn(),
  steer: vi.fn(),
  queueSet: vi.fn(),
  queueGet: vi.fn(),
}
const queues = pushedEvent<[{ sessionId: string; messages: string[] }]>()
const onShowSource = vi.fn()

const DROP_HINT = 'Drop to attach this session as context'
const LOGIN_TRANSCRIPT = '/t/login.jsonl'

function seedSessions(): void {
  const login = terminalSessionOf({ id: 'login', projectId: 'p1', tabTitle: 'Fix the login test' })
  useSessionStore.setState({
    sessions: new Map([
      ['agent-1', terminalSessionOf({ id: 'agent-1', projectId: 'p1', surface: 'agent' })],
      ['login', login],
    ]),
    terminalInstances: new Map(),
  })
  const agent = partialFake<NonNullable<SessionRecordListing['agent']>>({
    agentId: 'claude',
    transcriptPath: LOGIN_TRANSCRIPT,
  })
  const record = partialFake<SessionRecordListing>({ tabTitle: 'Fix the login test', agent })
  useSessionRecordsStore.setState({ records: new Map([['login', record]]) })
}

beforeEach(() => {
  vi.clearAllMocks()
  agents.history.mockResolvedValue({ data: [] })
  agents.prompt.mockResolvedValue({ data: { stopReason: 'end_turn' } })
  agents.steer.mockResolvedValue({ data: true })
  agents.queueSet.mockResolvedValue({ data: true })
  agents.queueGet.mockResolvedValue({ data: [] })
  installElectronApi({ agents: { ...agents, onQueueChanged: queues.addListener } })
  useAttachedContextStore.setState({ byTab: new Map(), sendRequests: new Map() })
  useTabDragStore.setState({ sessionId: null, overSessionId: null, overContextDrop: null })
  seedSessions()
})

async function mountComposer(running = false): Promise<void> {
  render(
    <Composer sessionId="agent-1" disabled={false} running={running} onShowSource={onShowSource} />
  )
  await act(async () => {})
}

const box = (): HTMLTextAreaElement => screen.getByLabelText('Message the agent')
const composer = (): HTMLElement => document.querySelector('[data-context-drop="agent-1"]')!
const attached = (): AttachedContext => attachedOf('agent-1')(useAttachedContextStore.getState())

const sessionDrag = (ids: string) => ({
  types: [SESSION_DRAG_TYPE],
  getData: (type: string) => (type === SESSION_DRAG_TYPE ? ids : ''),
  files: [],
  dropEffect: 'none',
})

async function dropSession(target: Element = composer()): Promise<void> {
  fireEvent.drop(target, { dataTransfer: sessionDrag('login') })
  await screen.findByText('Fix the login test')
}

function type(text: string): void {
  fireEvent.change(box(), { target: { value: text } })
}

describe('Composer — dragging a session over it', () => {
  it('shows the drop state and asks for a copy while a session is over it', async () => {
    await mountComposer()
    const dataTransfer = sessionDrag('login')
    fireEvent.dragOver(composer(), { dataTransfer })
    expect(screen.getByText(DROP_HINT)).toBeTruthy()
    expect(dataTransfer.dropEffect).toBe('copy')
    fireEvent.dragLeave(composer(), { relatedTarget: document.body })
    expect(screen.queryByText(DROP_HINT)).toBeNull()
  })

  it('shows no drop state for a file drag', async () => {
    await mountComposer()
    fireEvent.dragOver(composer(), { dataTransfer: { types: ['Files'], files: [] } })
    expect(screen.queryByText(DROP_HINT)).toBeNull()
  })

  it('shows the drop state while another tab is dragged over it, not its own tab', async () => {
    await mountComposer()
    act(() => useTabDragStore.setState({ sessionId: 'login', overContextDrop: 'agent-1' }))
    expect(screen.getByText(DROP_HINT)).toBeTruthy()
    act(() => useTabDragStore.setState({ sessionId: 'agent-1', overContextDrop: 'agent-1' }))
    expect(screen.queryByText(DROP_HINT)).toBeNull()
  })
})

describe('Composer — session chips', () => {
  it('drops a session as a chip with its kind, and the drop state goes away', async () => {
    await mountComposer()
    fireEvent.dragOver(composer(), { dataTransfer: sessionDrag('login') })
    await dropSession()
    expect(screen.getByText('session')).toBeTruthy()
    expect(screen.queryByText(DROP_HINT)).toBeNull()
  })

  it('takes a session dropped on the text box, and adds no image problem', async () => {
    await mountComposer()
    await dropSession(box())
    expect(attached().sessions.map((s) => s.sessionId)).toEqual(['login'])
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('Composer — removing and naming session chips', () => {
  it('removes a chip', async () => {
    await mountComposer()
    await dropSession()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Fix the login test' }))
    expect(screen.queryByText('Fix the login test')).toBeNull()
    expect(attached()).toEqual(noAttachedContext)
  })

  it('names a session that brings its text by where the text came from', async () => {
    await mountComposer()
    const source = { kind: 'text', origin: 'terminal', text: 'npm test' } as const
    act(() =>
      useAttachedContextStore
        .getState()
        .addSessions('agent-1', [{ sessionId: 'zsh', title: 'zsh', branch: null, source }])
    )
    expect(screen.getByText('terminal output')).toBeTruthy()
  })
})

const citation: Citation = {
  entryIndex: 4,
  quote: 'and only on network errors and 5xx responses, never on a 4xx',
  comment: 'Also retry on 429',
}

describe('Composer — citation chips', () => {
  beforeEach(() => useAttachedContextStore.getState().addCitation('agent-1', citation))

  it('shows the quote cut short and the comment, and shows the source on click', async () => {
    await mountComposer()
    const chip = screen.getByRole('button', { name: /and only on network errors/ })
    expect(chip.textContent).toBe('and only on network errors and 5xx respo…Also retry on 429')
    fireEvent.click(chip)
    expect(onShowSource).toHaveBeenCalledWith(citation.quote)
  })

  it('edits the comment from the pencil and shows it on the chip', async () => {
    await mountComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Edit comment' }))
    const comment = screen.getByLabelText<HTMLTextAreaElement>('Comment on this quote')
    expect(comment.value).toBe('Also retry on 429')
    fireEvent.change(comment, { target: { value: 'Wait for Retry-After' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(attached().citations).toEqual([{ ...citation, comment: 'Wait for Retry-After' }])
    expect(screen.getByRole('button', { name: /Wait for Retry-After/ })).toBeTruthy()
    expect(agents.prompt).not.toHaveBeenCalled()
  })

  it('removes a citation', async () => {
    await mountComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Remove citation' }))
    expect(attached()).toEqual(noAttachedContext)
  })
})

describe('Composer — sending with attached context', () => {
  it('sends the typed text with the context after it, then empties the store', async () => {
    await mountComposer()
    await dropSession()
    const sent = promptWithContext('Use the same backoff', attached())
    type('Use the same backoff')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(agents.prompt).toHaveBeenCalledWith({ sessionId: 'agent-1', text: sent })
    expect(sent).toContain(LOGIN_TRANSCRIPT)
    expect(attached()).toBe(noAttachedContext)
    expect(screen.queryByText('Fix the login test')).toBeNull()
  })

  it('sends with an empty text box when a chip is attached', async () => {
    await mountComposer()
    await dropSession()
    const sent = promptWithContext('', attached())
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(agents.prompt).toHaveBeenCalledWith({ sessionId: 'agent-1', text: sent })
    expect(sent.startsWith('<terminator_context>')).toBe(true)
  })

  it('still sends nothing for an empty box with nothing attached', async () => {
    await mountComposer()
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(agents.prompt).not.toHaveBeenCalled()
  })
})

describe('Composer — steering and queueing with attached context', () => {
  it('steers with the context, then empties the store', async () => {
    await mountComposer(true)
    await dropSession()
    const sent = promptWithContext('Use vitest', attached())
    type('Use vitest')
    fireEvent.keyDown(box(), { key: 'Enter', metaKey: true })
    expect(agents.steer).toHaveBeenCalledWith({ sessionId: 'agent-1', text: sent })
    expect(attached()).toBe(noAttachedContext)
  })

  it('queues with the context, then empties the store', async () => {
    await mountComposer(true)
    await dropSession()
    const sent = promptWithContext('Then lint', attached())
    type('Then lint')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(agents.queueSet).toHaveBeenCalledWith({ sessionId: 'agent-1', messages: [sent] })
    expect(attached()).toBe(noAttachedContext)
  })
})

describe('Composer — the queue list', () => {
  it('shows a queued message as its typed text and how many items it carries', async () => {
    await mountComposer(true)
    await dropSession()
    type('Then lint')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(screen.getByText('Then lint · 1 attached')).toBeTruthy()
  })

  it('shows a queue set before the tab opened, a message with nothing attached as it is', async () => {
    agents.queueGet.mockResolvedValue({ data: ['Plain follow-up'] })
    await mountComposer(true)
    expect(screen.getByText('1 message sends when this turn ends')).toBeTruthy()
    expect(screen.getByText('Plain follow-up')).toBeTruthy()
  })

  it('puts the text back in the box and the chip back above it on Edit', async () => {
    await mountComposer(true)
    await dropSession()
    type('Then lint')
    fireEvent.keyDown(box(), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Then lint' }))
    expect(box().value).toBe('Then lint')
    expect(attached().sessions.map((s) => s.sessionId)).toEqual(['login'])
    expect(screen.getByText('Fix the login test')).toBeTruthy()
    expect(agents.queueSet).toHaveBeenLastCalledWith({ sessionId: 'agent-1', messages: [] })
  })
})

describe('Composer — editing a queued message beside attached chips', () => {
  it('keeps the chips already above the box and adds the queued ones', async () => {
    const quote: Citation = { entryIndex: 2, quote: 'only on 5xx', comment: 'and 429' }
    const queued = promptWithContext('Then lint', { sessions: [], citations: [quote] })
    agents.queueGet.mockResolvedValue({ data: [queued] })
    await mountComposer(true)
    await dropSession()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Then lint' }))
    expect(attached().sessions.map((s) => s.sessionId)).toEqual(['login'])
    expect(attached().citations).toEqual([quote])
  })
})

describe('Composer — a send asked for from outside', () => {
  it('sends nothing once the agent has exited', async () => {
    render(<Composer sessionId="agent-1" disabled running={false} onShowSource={onShowSource} />)
    await act(async () => {})
    await dropSession()
    act(() => useAttachedContextStore.getState().requestSend('agent-1'))
    expect(agents.prompt).not.toHaveBeenCalled()
    expect(attached().sessions).toHaveLength(1)
  })
})

describe('Composer — images', () => {
  it('still takes an image dropped on the text box', async () => {
    await mountComposer()
    const png = new File(['x'], 'shot.png', { type: 'image/png' })
    fireEvent.drop(box(), { dataTransfer: { types: ['Files'], files: [png] } })
    expect(await screen.findByText('shot.png')).toBeTruthy()
    expect(attached()).toBe(noAttachedContext)
  })
})
