import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ELECTRON_API_MANIFEST, type ChannelSpec } from '../../../src/shared/electron-api/manifest'
import { methodAt } from '../../../src/shared/electron-api/__tests__/method-at'
import { methodPathsOf } from '../../support/electron-api'
import { eventually } from '../../support/eventually'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {}
}

type API = Window['electronAPI']

const mockFetch = vi.fn()

async function loadShim(): Promise<{ api: API; ws: MockWebSocket }> {
  vi.resetModules()
  MockWebSocket.instances = []
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ ticket: 'test-ticket' }),
  })
  global.fetch = mockFetch
  await import('../../../src/renderer-remote/electron-api-shim')
  // connectBridge is async (fetch, then WebSocket creation)
  await eventually(() => expect(MockWebSocket.instances).toHaveLength(1))
  const ws = MockWebSocket.instances[0]
  ws.onopen?.()
  return { api: window.electronAPI, ws }
}

/** Loads the shim under fake timers, so its retry timer is held and can be counted. */
async function expectRetryScheduledWithoutSocket(): Promise<void> {
  vi.useFakeTimers()
  global.fetch = mockFetch
  await import('../../../src/renderer-remote/electron-api-shim')
  await vi.advanceTimersByTimeAsync(0)
  expect(mockFetch).toHaveBeenCalledTimes(1)
  // Retry is scheduled but not yet fired — no WebSocket yet
  expect(vi.getTimerCount()).toBe(1)
  expect(MockWebSocket.instances).toHaveLength(0)
}

beforeEach(() => {
  MockWebSocket.instances = []
  mockFetch.mockReset()
  vi.stubGlobal('WebSocket', MockWebSocket)
  localStorage.clear()
  Reflect.deleteProperty(window, 'electronAPI')
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
})

function hasMsg(ws: MockWebSocket, substring: string) {
  return ws.sentMessages.some((m) => m.includes(substring))
}

describe('electron-api-shim bootstrap', () => {
  it('creates WebSocket to /api/bridge with ticket from bridge-ticket endpoint', async () => {
    await loadShim()
    expect(MockWebSocket.instances[0].url).toContain('/api/bridge')
    expect(MockWebSocket.instances[0].url).toContain('ticket=test-ticket')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/bridge-ticket',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('queues messages before ws is open and flushes on open', async () => {
    vi.resetModules()
    MockWebSocket.instances = []
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ticket: 'flush-ticket' }),
    })
    global.fetch = mockFetch
    await import('../../../src/renderer-remote/electron-api-shim')
    await eventually(() => expect(MockWebSocket.instances).toHaveLength(1))
    const ws = MockWebSocket.instances[0]
    const api = window.electronAPI
    void api.workspace.list()
    expect(ws.sentMessages.length).toBe(0)
    ws.onopen?.()
    expect(ws.sentMessages.length).toBeGreaterThan(0)
  })
})

describe('electron-api-shim connection edge cases', () => {
  it('asks for the ticket with the session cookie and no Authorization header', async () => {
    localStorage.setItem('remote_token', 'old-password')
    await loadShim()
    const init = mockFetch.mock.calls[0][1] as RequestInit
    expect(init.credentials).toBe('same-origin')
    expect(new Headers(init.headers).has('Authorization')).toBe(false)
  })

  it('removes a password an older version left in localStorage', async () => {
    localStorage.setItem('remote_token', 'old-password')
    await loadShim()
    expect(localStorage.getItem('remote_token')).toBeNull()
  })

  it('does not open WebSocket when bridge-ticket returns 401', async () => {
    vi.resetModules()
    MockWebSocket.instances = []
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 })
    global.fetch = mockFetch
    // Stub out location.replace so jsdom doesn't throw
    const replace = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, replace },
      writable: true,
    })
    await import('../../../src/renderer-remote/electron-api-shim')
    await eventually(() => expect(replace).toHaveBeenCalledWith('/'))
    // No WebSocket should be created — the shim returned early after redirect
    expect(MockWebSocket.instances).toHaveLength(0)
  })
})

describe('electron-api-shim connection edge cases — does not open WebSocket when bridge-ticket returns a non-401 error (retry scheduled)', () => {
  it('does not open WebSocket when bridge-ticket returns a non-401 error (retry scheduled)', async () => {
    vi.resetModules()
    MockWebSocket.instances = []
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 })
    await expectRetryScheduledWithoutSocket()
  })

  it('does not open WebSocket when fetch itself throws (retry scheduled)', async () => {
    vi.resetModules()
    MockWebSocket.instances = []
    mockFetch.mockRejectedValueOnce(new Error('network error'))
    await expectRetryScheduledWithoutSocket()
  })

  it('rejects pending invokes on ws.onclose', async () => {
    const { ws } = await loadShim()
    const api = window.electronAPI
    const p = api.workspace.list() as Promise<unknown>
    ws.onclose?.()
    await expect(p).rejects.toThrow('bridge disconnected')
  })
})

describe('electron-api-shim connection edge cases — closes WebSocket on ws.onerror', () => {
  it('closes WebSocket on ws.onerror', async () => {
    const { ws } = await loadShim()
    const closeSpy = vi.spyOn(ws, 'close')
    ws.onerror?.()
    expect(closeSpy).toHaveBeenCalled()
  })
})

describe('electron-api-shim message dispatch', () => {
  it('resolves pending invoke on result message', async () => {
    const { api, ws } = await loadShim()
    const p = api.workspace.list() as Promise<unknown>
    const id = (JSON.parse(ws.sentMessages[0]) as { id: string }).id
    ws.onmessage?.({ data: JSON.stringify({ type: 'result', id, result: ['ws1'] }) })
    await expect(p).resolves.toEqual(['ws1'])
  })

  it('rejects pending invoke on error message', async () => {
    const { api, ws } = await loadShim()
    const p = api.workspace.list() as Promise<unknown>
    const id = (JSON.parse(ws.sentMessages[0]) as { id: string }).id
    ws.onmessage?.({ data: JSON.stringify({ type: 'error', id, error: 'not found' }) })
    await expect(p).rejects.toThrow('not found')
  })

  it('uses default "bridge error" message when error field is missing', async () => {
    const { api, ws } = await loadShim()
    const p = api.workspace.list() as Promise<unknown>
    const id = (JSON.parse(ws.sentMessages[0]) as { id: string }).id
    ws.onmessage?.({ data: JSON.stringify({ type: 'error', id }) })
    await expect(p).rejects.toThrow('bridge error')
  })
})

describe('electron-api-shim message dispatch — fires event channel listeners on event messages', () => {
  it('fires event channel listeners on event messages', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    api.terminal.onOutput(handler)
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        channel: 'terminal:output',
        args: [{ sessionId: 's1', data: 'hello' }],
      }),
    })
    expect(handler).toHaveBeenCalledWith('s1', 'hello')
  })

  it('ignores event messages with unknown channel', async () => {
    const { ws } = await loadShim()
    expect(() =>
      ws.onmessage?.({
        data: JSON.stringify({ type: 'event', channel: 'unknown:channel', args: [] }),
      })
    ).not.toThrow()
  })

  it('ignores invalid JSON in onmessage', async () => {
    const { ws } = await loadShim()
    expect(() => ws.onmessage?.({ data: '{invalid json' })).not.toThrow()
  })
})

describe('electron-api-shim message dispatch — re-subscribes active channels on reconnect (onopen)', () => {
  it('re-subscribes active channels on reconnect (onopen)', async () => {
    const { api, ws } = await loadShim()
    api.terminal.onOutput(vi.fn())
    ws.sentMessages.length = 0
    ws.onopen?.()
    expect(ws.sentMessages.some((m) => m.includes('terminal:output'))).toBe(true)
  })
})

/** A remote client gets every spec but those for extension views only and those it omits. */
const onRemote = (spec: ChannelSpec) =>
  spec.extensionView !== 'only' && (spec.remote ?? 'same') !== 'omit'
/** Of those, these cross the bridge; the rest are the shim's own local stand-ins. */
const overBridge = (spec: ChannelSpec) =>
  onRemote(spec) && spec.kind !== 'local' && spec.remote !== 'stub'

/** What a value looks like after a trip through the bridge's JSON. */
const overTheWire = (value: unknown) => JSON.parse(JSON.stringify(value))

describe('electron-api-shim surface, as the manifest declares it', () => {
  it('exposes exactly the methods the manifest gives a remote client', async () => {
    const { api } = await loadShim()
    const declared = ELECTRON_API_MANIFEST.filter(onRemote).map((spec) => spec.path)
    expect(methodPathsOf(api).sort()).toEqual(declared.sort())
  })

  it.each(
    ELECTRON_API_MANIFEST.filter(
      (spec) => overBridge(spec) && (spec.kind === 'invoke' || spec.kind === 'send')
    ).map((spec) => [spec.path, spec] as const)
  )('%s puts on the bridge what the manifest declares', async (path, spec) => {
    const { api, ws } = await loadShim()
    const method = methodAt(api, path)
    const args = ['first', 'second', 'third'].slice(0, method.length)
    void method(...args)

    const toPayload = spec.toPayload as ((...a: unknown[]) => unknown) | undefined
    const payload = toPayload ? toPayload(...args) : args[0]
    const sent = JSON.parse(ws.sentMessages[0])
    // An invoke carries a request id the answer is matched on; a send carries none.
    const envelope = spec.kind === 'invoke' ? { type: 'invoke', id: sent.id } : { type: 'send' }
    expect(sent).toEqual(overTheWire({ ...envelope, channel: spec.channel, args: [payload] }))
  })
})

describe('electron-api-shim surface, as the manifest declares it — every event subscribes and hands its handler what the manifest declares', () => {
  it.each(
    ELECTRON_API_MANIFEST.filter((spec) => overBridge(spec) && spec.kind === 'event').map(
      (spec) => [spec.path, spec] as const
    )
  )('%s subscribes and hands its handler what the manifest declares', async (path, spec) => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    methodAt(api, path)(handler)
    expect(JSON.parse(ws.sentMessages[0])).toEqual({ type: 'subscribe', channel: spec.channel })

    const pushed = { sessionId: 's1', data: 'd', exitCode: 0, id: 'x' }
    ws.onmessage?.({
      data: JSON.stringify({ type: 'event', channel: spec.channel, args: [pushed] }),
    })
    expect(handler).toHaveBeenCalledWith(
      ...(spec.toHandlerArgs ? spec.toHandlerArgs([pushed]) : [pushed])
    )
  })
})

describe('electron-api-shim: what reaches a handler, and the local stand-ins', () => {
  it('terminal.onProcessExit subscribes and dispatches', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    api.terminal.onProcessExit(handler)
    expect(hasMsg(ws, 'terminal:process-exit')).toBe(true)
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        channel: 'terminal:process-exit',
        args: [{ sessionId: 's1', exitCode: 0 }],
      }),
    })
    expect(handler).toHaveBeenCalledWith('s1', 0)
  })
  it('dialog.openDirectory resolves with cancelled:true', async () => {
    const { api } = await loadShim()
    await expect(api.dialog.openDirectory()).resolves.toEqual({ cancelled: true })
  })
  it('shell.openExternal opens a browser tab instead of the host OS', async () => {
    const { api } = await loadShim()
    const spy = vi.spyOn(window, 'open').mockReturnValueOnce(null)
    await expect(api.shell.openExternal('https://example.com')).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith('https://example.com', '_blank')
    spy.mockRestore()
  })
})

describe('electron-api-shim: what reaches a handler, and the local stand-ins — a browser client has no file watch', () => {
  it('fs.watchStart says so, so the caller can poll, and asks the desktop for nothing', async () => {
    const { api, ws } = await loadShim()
    await expect(api.fs.watchStart('/repo')).resolves.toEqual({ error: 'WATCH_UNAVAILABLE' })
    await expect(api.fs.watchStop()).resolves.toEqual({ ok: true })
    expect(ws.sentMessages).toEqual([])
  })
  it('fs.onChanged subscribes to nothing, and a pushed fs:changed reaches no handler', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    const unsubscribe = api.fs.onChanged(handler)
    ws.onmessage?.({
      data: JSON.stringify({ type: 'event', channel: 'fs:changed', args: [{ path: '/foo' }] }),
    })
    unsubscribe()
    expect(ws.sentMessages).toEqual([])
    expect(handler).not.toHaveBeenCalled()
  })
  it('extensionBridge.invoke calls invoke with channel', async () => {
    const { api, ws } = await loadShim()
    void api.extensionBridge.invoke('custom:channel', { data: 1 })
    expect(JSON.parse(ws.sentMessages[0])).toEqual({
      type: 'invoke',
      id: expect.any(String),
      channel: 'custom:channel',
      args: [{ data: 1 }],
    })
  })
})

describe('electron-api-shim: what reaches a handler, and the local stand-ins — extensionBridge.on subscribes to channel', () => {
  it('extensionBridge.on subscribes to channel', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    api.extensionBridge.on('custom:event', handler)
    expect(hasMsg(ws, 'custom:event')).toBe(true)
    ws.onmessage?.({
      data: JSON.stringify({ type: 'event', channel: 'custom:event', args: [{ payload: 'x' }] }),
    })
    expect(handler).toHaveBeenCalledWith({ payload: 'x' })
  })
  it('extensionEvents.onTogglePanel dispatches panelId from args', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    api.extensionEvents.onTogglePanel(handler)
    // The wire payload is the bare panelId string — see api.window.broadcast call sites.
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        channel: 'extension:toggle-panel',
        args: ['sidebar'],
      }),
    })
    expect(handler).toHaveBeenCalledWith('sidebar')
  })
})

describe('electron-api-shim: what reaches a handler, and the local stand-ins — extensionEvents.onSelectProjectTab dispatches tabId from args', () => {
  it('extensionEvents.onSelectProjectTab dispatches tabId from args', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    api.extensionEvents.onSelectProjectTab(handler)
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        channel: 'extension:select-project-tab',
        args: [{ tabId: 'tab1' }],
      }),
    })
    expect(handler).toHaveBeenCalledWith('tab1')
  })
  it('unsubscribe function removes handler from channel listeners', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    const unsub = api.terminal.onOutput(handler) as () => void
    unsub()
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        channel: 'terminal:output',
        args: [{ sessionId: 's1', data: 'data' }],
      }),
    })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('electron-api-shim: what reaches a handler, and the local stand-ins — extensionEvents.onMenuOpenSettings dispatches void when event fires', () => {
  it('extensionEvents.onMenuOpenSettings dispatches void when event fires', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    api.extensionEvents.onMenuOpenSettings(handler)
    ws.onmessage?.({
      data: JSON.stringify({ type: 'event', channel: 'menu:open-settings', args: [] }),
    })
    expect(handler).toHaveBeenCalledWith()
  })
  it('notifications.onPush dispatches first arg when event fires', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    api.notifications.onPush(handler)
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        channel: 'notifications:push',
        args: [{ id: 'n1', title: 'pushed' }],
      }),
    })
    expect(handler).toHaveBeenCalledWith({ id: 'n1', title: 'pushed' })
  })
})
