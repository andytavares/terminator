import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import type { AgentPermissionAsk, AgentUpdate } from '@terminator/extension-sdk'

import { AgentView } from '../../../../src/renderer/components/agent/AgentView'
import { AgentMarkdown } from '../../../../src/renderer/components/agent/AgentMarkdown'
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
  steer: vi.fn(),
  queueSet: vi.fn(),
  queueGet: vi.fn(),
}
const queues = pushedEvent<[{ sessionId: string; messages: string[] }]>()
const shell = { openExternal: vi.fn(async (_url: string) => ({ ok: true as const })) }

async function mountView(): Promise<void> {
  render(<AgentView sessionId="agent-1" />)
  await act(async () => {})
}

const agentsApi = {
  ...agents,
  onUpdate: updates.addListener,
  onPermission: permissions.addListener,
  onPermissionSettled: settled.addListener,
  onEnd: ends.addListener,
  onQueueChanged: queues.addListener,
}

const box = (): HTMLTextAreaElement => screen.getByLabelText('Message the agent')

beforeEach(() => {
  vi.clearAllMocks()
  agents.history.mockResolvedValue({ data: [text('agent_message_chunk', 'Earlier reply')] })
  agents.openAsks.mockResolvedValue({ data: [] })
  agents.answer.mockResolvedValue({ data: true })
  agents.prompt.mockResolvedValue({ data: { stopReason: 'end_turn' } })
  agents.cancel.mockResolvedValue({ data: true })
  agents.steer.mockResolvedValue({ data: true })
  agents.queueSet.mockResolvedValue({ data: true })
  agents.queueGet.mockResolvedValue({ data: [] })
  installElectronApi({ shell, agents: agentsApi })
  useSessionStore.setState(useSessionStore.getInitialState())
  useSessionStore.setState({
    sessions: new Map([
      [
        'agent-1',
        terminalSessionOf({ id: 'agent-1', projectId: 'p1', surface: 'agent', cwd: '/r' }),
      ],
    ]),
  })
})

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))
vi.mock('mermaid', () => ({ default: mermaid }))

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
  it('draws a tool call with its command and an open diff with a relative path', async () => {
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
          locations: [{ path: '/r/src/a.ts' }],
          content: [
            { type: 'diff', path: '/r/src/a.ts', oldText: 'old line', newText: 'new line' },
          ],
        },
      })
    })
    expect(screen.getByText('Edit file')).toBeTruthy()
    expect(screen.getByText('src/a.ts', { selector: '.agent-tool__summary' })).toBeTruthy()
    const added = document.querySelector('.diff-line--add')
    expect(added?.textContent).toContain('new line')
    expect(added?.closest('details')?.open).toBe(true)
  })
})

describe('AgentView changed in this turn', () => {
  const edit = (id: string, newText: string): AgentUpdate => ({
    sessionUpdate: 'tool_call',
    toolCallId: id,
    title: 'Edit file',
    content: [{ type: 'diff', path: '/r/src/a.ts', oldText: null, newText }],
  })

  it('lists one file once for two edits, with the counts', async () => {
    await mountView()
    act(() => updates.deliver({ sessionId: 'agent-1', update: edit('t1', 'a') }))
    act(() => updates.deliver({ sessionId: 'agent-1', update: edit('t2', 'b\nc') }))
    const card = screen.getByRole('group', { name: 'Changed in this turn' })
    expect(within(card).getAllByText('src/a.ts')).toHaveLength(1)
    expect(within(card).getByText('+3')).toBeTruthy()
    expect(within(card).queryByText(/new file/i)).toBeNull()
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

describe('AgentView follow-up queue and steer', () => {
  beforeEach(() => useSessionStore.getState().setAgentTurn('agent-1', true))

  it('keeps the box enabled and queues on Enter during a turn', async () => {
    await mountView()
    expect(box().disabled).toBe(false)
    fireEvent.change(box(), { target: { value: 'Then lint' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(agents.queueSet).toHaveBeenCalledWith({ sessionId: 'agent-1', messages: ['Then lint'] })
    expect(agents.prompt).not.toHaveBeenCalled()
    expect(box().value).toBe('')
    expect(recordUse).toHaveBeenCalledWith('core.agent.queue', 'shortcut')
  })

  it('steers on Cmd+Enter during a turn', async () => {
    await mountView()
    fireEvent.change(box(), { target: { value: 'Use vitest' } })
    fireEvent.keyDown(box(), { key: 'Enter', metaKey: true })
    expect(agents.steer).toHaveBeenCalledWith({ sessionId: 'agent-1', text: 'Use vitest' })
    expect(agents.prompt).not.toHaveBeenCalled()
    expect(recordUse).toHaveBeenCalledWith('core.agent.steer', 'shortcut')
  })

  it('steers from the Steer button', async () => {
    await mountView()
    fireEvent.change(box(), { target: { value: 'Use vitest' } })
    fireEvent.click(screen.getByRole('button', { name: 'Steer' }))
    expect(agents.steer).toHaveBeenCalledWith({ sessionId: 'agent-1', text: 'Use vitest' })
  })
})

describe('AgentView queue list', () => {
  beforeEach(() => useSessionStore.getState().setAgentTurn('agent-1', true))

  it('shows a queue set before the tab opened', async () => {
    agents.queueGet.mockResolvedValue({ data: ['set earlier'] })
    await mountView()
    expect(screen.getByText('1 message sends when this turn ends')).toBeTruthy()
  })

  it('shows the queue from the main process, edits and removes items', async () => {
    await mountView()
    act(() => queues.deliver({ sessionId: 'agent-1', messages: ['one', 'two'] }))
    expect(screen.getByText('2 messages send when this turn ends')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit one' }))
    expect(box().value).toBe('one')
    expect(agents.queueSet).toHaveBeenLastCalledWith({ sessionId: 'agent-1', messages: ['two'] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove two' }))
    expect(agents.queueSet).toHaveBeenLastCalledWith({ sessionId: 'agent-1', messages: [] })
    expect(screen.queryByText(/send when this turn ends/)).toBeNull()
  })

  it('ignores another session’s queue', async () => {
    await mountView()
    act(() => queues.deliver({ sessionId: 'other', messages: ['x'] }))
    expect(screen.queryByText(/send when this turn ends/)).toBeNull()
  })

  it('Stop cancels the turn', async () => {
    await mountView()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(agents.cancel).toHaveBeenCalledWith({ sessionId: 'agent-1' })
  })
})

async function reply(body: string): Promise<HTMLElement> {
  agents.history.mockResolvedValue({
    data: [text('user_message_chunk', '# not a heading'), text('agent_message_chunk', body)],
  })
  await mountView()
  return screen.getByRole('log')
}

describe('AgentView rich replies', () => {
  it('renders an agent reply as Markdown and keeps the user message plain', async () => {
    const log = await reply('## Plan\n\n- one\n- two\n\n| Name | Value |\n| --- | --- |\n| a | 1 |')
    expect(log.querySelector('h2')?.textContent).toBe('Plan')
    expect(log.querySelectorAll('li')).toHaveLength(2)
    expect(log.querySelectorAll('tbody td')).toHaveLength(2)
    expect(within(log).getByText('# not a heading')).toBeTruthy()
    expect(log.querySelector('h1')).toBeNull()
  })

  it('opens a link through the shell, not the view', async () => {
    const log = await reply('[docs](https://example.com/docs)')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    log.querySelector('a')!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })
})

describe('AgentView raw HTML in replies', () => {
  it('renders raw HTML, sanitised, and loads no remote image', async () => {
    const log = await reply(
      [
        '<details><summary>Logs</summary>body</details>',
        '<table><tr><td>cell</td></tr></table>',
        '<script>window.__pwned = 1</script>',
        '<img src="https://x.example/p.png" onerror="window.__pwned = 2">',
        '<a href="javascript:alert(3)">bad</a>',
        '<iframe src="https://x.example"></iframe>',
      ].join('\n\n')
    )
    expect((await within(log).findByText('Logs')).closest('details')).not.toBeNull()
    expect(log.querySelector('table td')?.textContent).toBe('cell')
    expect(log.querySelector('script, iframe, img')).toBeNull()
    expect(log.innerHTML).not.toContain('javascript:')
    expect(log.innerHTML).not.toContain('onerror')
    expect(log.textContent).not.toContain('__pwned')
  })
})

describe('AgentView mermaid diagrams', () => {
  it('draws a mermaid fence as a diagram, strictly', async () => {
    mermaid.render.mockResolvedValue({ svg: '<svg><text>Pie drawn</text></svg>' })
    const log = await reply('```mermaid\npie\n  "A": 1\n```')
    expect(await within(log).findByText('Pie drawn')).toBeTruthy()
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), 'pie\n  "A": 1')
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', startOnLoad: false })
    )
  })

  it('shows a mermaid fence that does not parse as code with the error', async () => {
    mermaid.render.mockRejectedValue(new Error('Parse error on line 1'))
    const log = await reply('```mermaid\nnot a diagram\n```')
    expect(await within(log).findByText(/diagram could not be drawn/i)).toBeTruthy()
    expect(within(log).getByText(/Parse error on line 1/)).toBeTruthy()
    expect(log.querySelector('pre code')?.textContent).toBe('not a diagram')
  })
})

describe('AgentView mermaid diagrams fetch nothing', () => {
  it('drops init directives and every remote url() from a drawn diagram', async () => {
    const evil = 'url(https://evil.example/t.png)'
    mermaid.render.mockResolvedValue({
      svg: `<svg><style>@import url(https://evil.example/a.css); div{background:${evil}}</style><g style="fill:${evil}"><text>Drawn</text></g><path fill="url(#grad)"/></svg>`,
    })
    const log = await reply('```mermaid\n%%{init: {"themeCSS": "x"}}%%\npie\n  "A": 1\n```')
    expect(await within(log).findByText('Drawn')).toBeTruthy()
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), 'pie\n  "A": 1')
    expect(log.innerHTML).not.toContain('evil.example')
    expect(log.innerHTML).toContain('url(#grad)')
  })
})

describe('AgentView mermaid diagrams while a reply streams', () => {
  it('draws once the fence stops changing, not on every chunk', async () => {
    vi.useFakeTimers()
    try {
      mermaid.render.mockResolvedValue({ svg: '<svg><text>Done</text></svg>' })
      const view = render(<AgentMarkdown text={'```mermaid\npie\n'} />)
      view.rerender(<AgentMarkdown text={'```mermaid\npie\n  "A"'} />)
      view.rerender(<AgentMarkdown text={'```mermaid\npie\n  "A": 1\n```'} />)
      await act(async () => vi.advanceTimersByTimeAsync(300))
      expect(mermaid.render.mock.calls.map(([, code]) => code)).toEqual(['pie\n  "A": 1'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('AgentView find', () => {
  const find = (): HTMLInputElement => screen.getByLabelText('Find in the transcript')
  const open = async (): Promise<void> => {
    agents.history.mockResolvedValue({
      data: [text('agent_message_chunk', 'Alpha beta alpha'), text('user_message_chunk', 'ALPHA')],
    })
    await mountView()
    fireEvent.keyDown(screen.getByRole('region'), { key: 'f', metaKey: true })
  }

  it('counts matches, moves between them and closes on Escape', async () => {
    await open()
    fireEvent.change(find(), { target: { value: 'alpha' } })
    expect(screen.getByText('1 of 3')).toBeTruthy()
    expect(document.querySelectorAll('mark.agent-find__match')).toHaveLength(3)
    fireEvent.keyDown(find(), { key: 'Enter' })
    expect(screen.getByText('2 of 3')).toBeTruthy()
    fireEvent.keyDown(find(), { key: 'Enter', shiftKey: true })
    expect(screen.getByText('1 of 3')).toBeTruthy()
    fireEvent.keyDown(find(), { key: 'Escape' })
    expect(screen.queryByLabelText('Find in the transcript')).toBeNull()
    expect(document.querySelector('mark')).toBeNull()
    expect(recordUse).toHaveBeenCalledWith('core.agent.find', 'shortcut')
  })

  it('says 0 of 0 when nothing matches', async () => {
    await open()
    fireEvent.change(find(), { target: { value: 'zzz' } })
    expect(screen.getByText('0 of 0')).toBeTruthy()
  })
})

describe('AgentView images', () => {
  const png = (name: string, size = 10): File => {
    const file = new File(['x'], name, { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: size })
    return file
  }
  const attach = (file: File): void => {
    fireEvent.change(screen.getByLabelText('Attach an image'), { target: { files: [file] } })
  }

  it('sends an attached image with the next prompt', async () => {
    await mountView()
    attach(png('shot.png'))
    expect(await screen.findByText('shot.png')).toBeTruthy()
    fireEvent.change(box(), { target: { value: 'Look' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(agents.prompt).toHaveBeenCalledWith({
      sessionId: 'agent-1',
      text: 'Look',
      images: [{ mimeType: 'image/png', data: btoa('x') }],
    })
    expect(screen.queryByText('shot.png')).toBeNull()
  })
})

describe('AgentView image limits', () => {
  const png = (name: string, size = 10): File => {
    const file = new File(['x'], name, { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: size })
    return file
  }
  const attach = (file: File): void => {
    fireEvent.change(screen.getByLabelText('Attach an image'), { target: { files: [file] } })
  }

  it('removes a thumbnail', async () => {
    await mountView()
    attach(png('shot.png'))
    await screen.findByText('shot.png')
    fireEvent.click(screen.getByRole('button', { name: 'Remove shot.png' }))
    expect(screen.queryByText('shot.png')).toBeNull()
  })

  it('rejects an image over 5 MB in plain words', async () => {
    await mountView()
    attach(png('big.png', 6 * 1024 * 1024))
    expect(screen.getByRole('alert').textContent).toMatch(/big\.png is larger than 5 MB/)
    expect(screen.queryByText('big.png', { selector: '.agent-attachment__name' })).toBeNull()
  })

  it('rejects a file that is not a supported image', async () => {
    await mountView()
    attach(new File(['x'], 'a.bmp', { type: 'image/bmp' }))
    expect(screen.getByRole('alert').textContent).toMatch(/PNG, JPEG, GIF or WebP/)
  })
})

describe('AgentView turn and exit', () => {
  it('says the agent exited and disables the box when it ends', async () => {
    await mountView()
    act(() => ends.deliver({ sessionId: 'agent-1', exitCode: 1 }))
    expect(screen.getByText(/agent exited/i)).toBeTruthy()
    expect(box().disabled).toBe(true)
  })
})
