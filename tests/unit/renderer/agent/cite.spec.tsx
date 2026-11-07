import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { AgentUpdate } from '@terminator/extension-sdk'

import { AgentView } from '../../../../src/renderer/components/agent/AgentView'
import {
  MAX_QUOTE_CHARS,
  noAttachedContext,
  promptWithContext,
} from '../../../../src/renderer/components/agent/attached-context'
import {
  attachedOf,
  useAttachedContextStore,
} from '../../../../src/renderer/stores/attached-context.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { installElectronApi } from '../../../support/electron-api'
import { terminalSessionOf } from '../../../support/renderer-stores'

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

const REPLY = 'It retries only on network errors and 5xx responses.'
const QUOTE = 'only on network errors'

const text = (sessionUpdate: string, value: string): AgentUpdate => ({
  sessionUpdate,
  content: { type: 'text', text: value },
})

const agents = {
  history: vi.fn(),
  openAsks: vi.fn(),
  prompt: vi.fn(),
  queueSet: vi.fn(),
  queueGet: vi.fn(),
}
const unsubscribe = (): void => {}
const noEvents = () => unsubscribe

// jsdom lays nothing out, so a range has no box of its own.
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect(40, 100, 200, 16)
}

function installAgents(): void {
  installElectronApi({
    agents: {
      ...agents,
      onUpdate: noEvents,
      onPermission: noEvents,
      onPermissionSettled: noEvents,
      onEnd: noEvents,
      onQueueChanged: noEvents,
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  agents.history.mockResolvedValue({
    data: [
      text('user_message_chunk', 'Add a retry'),
      text('agent_message_chunk', REPLY),
      text('user_message_chunk', 'Thanks'),
      text('agent_message_chunk', 'Second reply'),
    ],
  })
  agents.openAsks.mockResolvedValue({ data: [] })
  agents.prompt.mockResolvedValue({ data: { stopReason: 'end_turn' } })
  agents.queueSet.mockResolvedValue({ data: true })
  agents.queueGet.mockResolvedValue({ data: [] })
  installAgents()
  useAttachedContextStore.setState({ byTab: new Map(), sendRequests: new Map() })
  useSessionStore.setState({
    sessions: new Map([
      ['agent-1', terminalSessionOf({ id: 'agent-1', projectId: 'p1', surface: 'agent' })],
    ]),
  })
})

async function mountView(): Promise<void> {
  render(<AgentView sessionId="agent-1" />)
  await act(async () => {})
}

const textOf = (message: string): Node => screen.getByText(message).firstChild!

/** Selects from `start` in one text node to `end` in another, as a drag would. */
function select(from: [Node, number], to: [Node, number]): void {
  const range = document.createRange()
  range.setStart(...from)
  range.setEnd(...to)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  act(() => void document.dispatchEvent(new Event('selectionchange')))
}

function selectQuote(): void {
  const start = REPLY.indexOf(QUOTE)
  select([textOf(REPLY), start], [textOf(REPLY), start + QUOTE.length])
}

const citeButton = () => screen.queryByRole('button', { name: 'Cite' })
const commentBox = (): HTMLTextAreaElement => screen.getByLabelText('Comment on this quote')
const attached = () => attachedOf('agent-1')(useAttachedContextStore.getState())

describe('Cite — which selections can be cited', () => {
  it('shows Cite for a selection inside an agent reply', async () => {
    await mountView()
    selectQuote()
    expect(citeButton()).not.toBeNull()
  })

  it('shows nothing for a selection inside the operator’s message', async () => {
    await mountView()
    select([textOf('Add a retry'), 0], [textOf('Add a retry'), 5])
    expect(citeButton()).toBeNull()
  })

  it('shows nothing for a selection across two messages', async () => {
    await mountView()
    select([textOf(REPLY), 3], [textOf('Second reply'), 3])
    expect(citeButton()).toBeNull()
  })

  it('hides Cite when the selection becomes empty', async () => {
    await mountView()
    selectQuote()
    act(() => {
      document.getSelection()!.removeAllRanges()
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(citeButton()).toBeNull()
  })
})

describe('Cite — a selection over the limit', () => {
  it('disables the button and asks to shorten the selection', async () => {
    const long = 'x'.repeat(MAX_QUOTE_CHARS + 1)
    agents.history.mockResolvedValue({ data: [text('agent_message_chunk', long)] })
    await mountView()
    select([textOf(long), 0], [textOf(long), long.length])
    const button = screen.getByRole('button', { name: 'Shorten the selection' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})

async function openComment(): Promise<void> {
  await mountView()
  selectQuote()
  fireEvent.click(citeButton()!)
}

describe('Cite — saving a comment', () => {
  it('saves the citation with its entry, quote and comment on Enter', async () => {
    await openComment()
    fireEvent.change(commentBox(), { target: { value: 'Also retry on 429' } })
    fireEvent.keyDown(commentBox(), { key: 'Enter' })
    expect(attached().citations).toEqual([
      { entryIndex: 1, quote: QUOTE, comment: 'Also retry on 429' },
    ])
    expect(document.activeElement).toBe(screen.getByLabelText('Message the agent'))
    expect(recordUse).toHaveBeenCalledWith('core.agent.cite', 'click')
    expect(agents.prompt).not.toHaveBeenCalled()
  })

  it('keeps Shift+Enter as a newline and saves from the Save button', async () => {
    await openComment()
    fireEvent.keyDown(commentBox(), { key: 'Enter', shiftKey: true })
    expect(attached()).toEqual(noAttachedContext)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(attached().citations).toEqual([{ entryIndex: 1, quote: QUOTE, comment: '' }])
  })
})

describe('Cite — cancelling a comment', () => {
  it('adds nothing on Escape or Cancel', async () => {
    await openComment()
    fireEvent.keyDown(commentBox(), { key: 'Escape' })
    expect(screen.queryByLabelText('Comment on this quote')).toBeNull()
    selectQuote()
    fireEvent.click(citeButton()!)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Comment on this quote')).toBeNull()
    expect(attached()).toEqual(noAttachedContext)
  })
})

describe('Cite — save and send', () => {
  it('adds the citation and sends it on Cmd+Enter', async () => {
    await mountView()
    selectQuote()
    fireEvent.click(citeButton()!)
    fireEvent.change(commentBox(), { target: { value: 'Also retry on 429' } })
    fireEvent.keyDown(commentBox(), { key: 'Enter', metaKey: true })
    const citation = { entryIndex: 1, quote: QUOTE, comment: 'Also retry on 429' }
    const sent = promptWithContext('', { sessions: [], citations: [citation] })
    expect(agents.prompt).toHaveBeenCalledWith({ sessionId: 'agent-1', text: sent })
    expect(attached()).toEqual(noAttachedContext)
  })
})
