import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { AgentUpdate } from '@terminator/extension-sdk'

import { AgentView } from '../../../../src/renderer/components/agent/AgentView'
import { SESSION_DRAG_TYPE } from '../../../../src/renderer/components/agent/session-drag'
import { useAttachedContextStore } from '../../../../src/renderer/stores/attached-context.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useSessionRecordsStore } from '../../../../src/renderer/stores/session-records.store'
import type { SessionRecordListing } from '../../../../src/shared/types/index'
import { installElectronApi } from '../../../support/electron-api'
import { partialFake } from '../../../support/fakes'
import { terminalSessionOf } from '../../../support/renderer-stores'

// The whole agent tab with its real stores: only the main process behind window.electronAPI is fake.

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

const REPLY = 'I am acp-stub, and I retry on network errors.'
const DRAGGED_TITLE = 'Rename parseInvoice to readInvoice'

const text = (sessionUpdate: string, value: string): AgentUpdate => ({
  sessionUpdate,
  content: { type: 'text', text: value },
})

const agents = {
  history: vi.fn(),
  openAsks: vi.fn(),
  prompt: vi.fn(),
  cancel: vi.fn(),
  steer: vi.fn(),
  queueSet: vi.fn(),
  queueGet: vi.fn(),
}
const noEvents = () => () => {}

// jsdom lays nothing out, so a range has no box of its own.
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect(40, 100, 200, 16)
}

function seedTabs(): void {
  useSessionStore.setState({
    sessions: new Map([
      ['agent-1', terminalSessionOf({ id: 'agent-1', projectId: 'p1', surface: 'agent' })],
      ['rename', terminalSessionOf({ id: 'rename', projectId: 'p1', tabTitle: DRAGGED_TITLE })],
    ]),
    terminalInstances: new Map(),
  })
  const agent = partialFake<NonNullable<SessionRecordListing['agent']>>({
    agentId: 'claude',
    transcriptPath: '/t/rename.jsonl',
  })
  const record = partialFake<SessionRecordListing>({ tabTitle: DRAGGED_TITLE, agent })
  useSessionRecordsStore.setState({ records: new Map([['rename', record]]) })
}

beforeEach(() => {
  vi.clearAllMocks()
  agents.history.mockResolvedValue({
    data: [
      text('user_message_chunk', 'Document the invoice reader'),
      text('agent_message_chunk', REPLY),
    ],
  })
  agents.openAsks.mockResolvedValue({ data: [] })
  agents.prompt.mockResolvedValue({ data: { stopReason: 'end_turn' } })
  agents.queueSet.mockResolvedValue({ data: true })
  agents.queueGet.mockResolvedValue({ data: [] })
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
  useAttachedContextStore.setState({ byTab: new Map(), sendRequests: new Map() })
  seedTabs()
})

async function dropSessionOnComposer(sessionId: string): Promise<void> {
  const composer = document.querySelector('[data-context-drop="agent-1"]')!
  fireEvent.drop(composer, {
    dataTransfer: {
      types: [SESSION_DRAG_TYPE],
      getData: (type: string) => (type === SESSION_DRAG_TYPE ? sessionId : ''),
      files: [],
    },
  })
  await screen.findByText(DRAGGED_TITLE)
}

function citeInReply(quote: string, comment: string): void {
  const node = screen.getByText(REPLY).firstChild!
  const start = REPLY.indexOf(quote)
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, start + quote.length)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  act(() => void document.dispatchEvent(new Event('selectionchange')))
  fireEvent.click(screen.getByRole('button', { name: 'Cite' }))
  const commentBox = screen.getByLabelText('Comment on this quote')
  fireEvent.change(commentBox, { target: { value: comment } })
  fireEvent.keyDown(commentBox, { key: 'Enter' })
}

describe('An agent tab with a dropped session and a citation', () => {
  it('sends the typed text first, then the session and the citation', async () => {
    render(<AgentView sessionId="agent-1" />)
    await screen.findByText(REPLY)
    await dropSessionOnComposer('rename')
    citeInReply('acp-stub', 'Say this more plainly')
    const box = screen.getByLabelText('Message the agent')
    fireEvent.change(box, { target: { value: 'Use the attached context' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(agents.prompt).toHaveBeenCalledTimes(1)
    const [{ sessionId, text: sent }] = agents.prompt.mock.calls[0]
    expect(sessionId).toBe('agent-1')
    expect(sent.startsWith('Use the attached context\n\n<terminator_context>\n')).toBe(true)
    expect(sent).toContain(
      `<session id="rename" title="${DRAGGED_TITLE}" agent="claude" transcript="/t/rename.jsonl" />`
    )
    expect(sent).toContain(
      '<citation id="1" entry="1">\n<quote>acp-stub</quote>\n<comment>Say this more plainly</comment>\n</citation>'
    )
  })
})
