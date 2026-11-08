import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { McpCall } from '../../../../core-shared/src/mcp/renderer-tools'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))

type Module = typeof import('../../../src/mcp/renderer-tools')
let mod: Module

const caller = { sessionId: 's1', claudePid: 1, projectDir: '/repo' }

/** A main window whose renderer reports each `mcp:call` it is sent. */
function fakeWindow(options: { loading?: boolean } = {}) {
  const sent: Array<{ channel: string; call: McpCall }> = []
  let reportSend: (call: McpCall) => void = () => {}
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isLoading: () => options.loading ?? false,
    send: (channel: string, call: McpCall) => {
      sent.push({ channel, call })
      reportSend(call)
    },
  })
  const window = { isDestroyed: () => false, webContents } as unknown as BrowserWindow
  const nextSend = () => new Promise<McpCall>((resolve) => (reportSend = resolve))
  return { window, webContents, sent, nextSend }
}

const answer = (payload: unknown) => handlers.get('mcp:answer')!({}, payload)

function toolNamed(name: string) {
  return mod.rendererTools.tools().find((tool) => tool.name === name)!
}

let win: ReturnType<typeof fakeWindow>
let showWindow: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  handlers.clear()
  mod = await import('../../../src/mcp/renderer-tools')
  win = fakeWindow()
  showWindow = vi.fn(() => win.window)
  mod.registerRendererTools({ showWindow: showWindow as () => BrowserWindow })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('rendererTools — tools/list', () => {
  it('lists every renderer tool with an object schema and its marks', () => {
    const names = mod.rendererTools.tools().map((tool) => tool.name)
    expect(names).toContain('open_terminal')
    expect(names).toContain('run_destructive_quick_action')
    expect(toolNamed('open_terminal').inputSchema).toMatchObject({
      type: 'object',
      properties: { cwd: { type: 'string' } },
      required: ['cwd'],
    })
    expect(toolNamed('list_quick_actions').annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
    })
    expect(toolNamed('run_destructive_quick_action')._meta).toEqual({
      'anthropic/requiresUserInteraction': true,
    })
    expect(toolNamed('open_session').annotations).toEqual({ destructiveHint: false })
  })
})

describe('rendererTools — a call', () => {
  it('sends mcp:call with a fresh id and resolves with the matching answer', async () => {
    const firstSend = win.nextSend()
    const first = toolNamed('open_terminal').call({ cwd: '/repo' }, caller)
    const firstCall = await firstSend
    const secondSend = win.nextSend()
    const second = toolNamed('open_session').call({ sessionId: 'a1' }, caller)
    const secondCall = await secondSend

    expect(showWindow).toHaveBeenCalled()
    expect(win.sent[0]).toEqual({
      channel: 'mcp:call',
      call: { id: firstCall.id, tool: 'open_terminal', args: { cwd: '/repo' } },
    })
    expect(secondCall.id).not.toBe(firstCall.id)
    await answer({ id: secondCall.id, result: { opened: 'a1' } })
    await answer({ id: firstCall.id, result: { tab: 't1' } })
    expect(await first).toEqual({ tab: 't1' })
    expect(await second).toEqual({ opened: 'a1' })
  })
})

describe('rendererTools — a window still loading', () => {
  it('waits for a loading window to finish before it sends', async () => {
    win = fakeWindow({ loading: true })
    const sending = win.nextSend()
    const waitsForLoad = new Promise<void>((resolve) =>
      win.webContents.on('newListener', (name) => name === 'did-finish-load' && resolve())
    )
    const result = mod.callRendererTool('list_quick_actions', {})
    await waitsForLoad
    expect(win.sent).toEqual([])
    win.webContents.emit('did-finish-load')
    const call = await sending
    await answer({ id: call.id, result: [] })
    expect(await result).toEqual([])
  })
})

describe('rendererTools — answers and refusals', () => {
  it('rejects with the text of an error answer', async () => {
    const sending = win.nextSend()
    const result = toolNamed('run_quick_action').call({ id: 'close-tab' }, caller)
    const call = await sending
    await answer({ id: call.id, error: 'close-tab closes something; use the destructive tool' })
    await expect(result).rejects.toThrow('close-tab closes something; use the destructive tool')
  })

  it('ignores an answer for an unknown id', async () => {
    const sending = win.nextSend()
    const result = toolNamed('open_session').call({ sessionId: 'a1' }, caller)
    const call = await sending
    await answer({ id: 'someone-else', result: 'wrong' })
    await answer({ id: call.id, result: 'right' })
    expect(await result).toBe('right')
  })

  it('rejects bad arguments in plain words without sending', async () => {
    await expect(toolNamed('open_terminal').call({ cwd: '' }, caller)).rejects.toThrow(
      /open_terminal cannot use these arguments/
    )
    expect(win.sent).toEqual([])
    expect(showWindow).not.toHaveBeenCalled()
  })
})

describe('rendererTools — no answer', () => {
  it('rejects after 60 seconds and drops the pending call', async () => {
    vi.useFakeTimers()
    const sending = win.nextSend()
    const result = toolNamed('open_session').call({ sessionId: 'a1' }, caller)
    const call = await sending
    const failure = result.catch((error: Error) => error)
    vi.advanceTimersByTime(60_000)
    expect(await failure).toEqual(new Error('Terminator did not answer in time'))
    // A late answer finds nothing to settle and does not throw.
    expect(await answer({ id: call.id, result: 'late' })).toBeUndefined()
  })
})
