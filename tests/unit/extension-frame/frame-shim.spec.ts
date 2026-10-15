// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FRAME_PORT_MESSAGE, type FrameReply } from '../../../src/shared/frame-wire'
import type { FrameElectronAPI } from '../../../src/shared/electron-api/api-type'

/** window.electronAPI as the frame shim builds it (a different surface than
 * the app renderer's ElectronAPI global). */
function frameApi(): FrameElectronAPI {
  return (window as unknown as { electronAPI: FrameElectronAPI }).electronAPI
}

interface FakePort {
  posted: unknown[]
  onmessage: ((event: { data: FrameReply }) => void) | null
  start: () => void
  close: () => void
  postMessage: (message: unknown) => void
}

const SHIM_PATH = '../../../src/extension-frame/frame-shim'

function deliverPort(port: MessagePort, source: unknown = window.parent) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: FRAME_PORT_MESSAGE },
      ports: [port],
      source: source as MessageEventSource,
    })
  )
}

async function loadShimInFrame(): Promise<{ port: FakePort }> {
  vi.resetModules()
  const port = fakeFramePort()
  // happy-dom has window.top === window by default; pretend this is a frame.
  Object.defineProperty(window, 'top', { value: {}, configurable: true })
  // happy-dom reports "X11; Darwin arm64"; a real mac reads "MacIntel".
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
  await import(SHIM_PATH)
  return { port }
}

beforeEach(() => {
  Reflect.deleteProperty(window, 'electronAPI')
  document.documentElement.removeAttribute('data-theme')
  document.body.innerHTML = ''
})

afterEach(() => {
  Object.defineProperty(window, 'top', { value: window, configurable: true })
  vi.resetModules()
})

describe('frame-shim outside a frame', () => {
  it('does nothing at the top level of a window', async () => {
    vi.resetModules()
    const hadShimHolder = '__frameShim' in window
    await import(SHIM_PATH)
    expect('electronAPI' in window).toBe(false)
    expect('__frameShim' in window).toBe(hadShimHolder)
  })
})

describe('frame-shim port handshake', () => {
  it('installs window.electronAPI before the port arrives', async () => {
    await loadShimInFrame()
    expect(frameApi()).toBeDefined()
  })

  it('ignores a message from a source other than the parent window', async () => {
    const { port } = await loadShimInFrame()
    deliverPort(port as unknown as MessagePort, {})
    expect(port.start).not.toHaveBeenCalled()
  })

  it('ignores a message from the parent without the port', async () => {
    const { port } = await loadShimInFrame()
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: FRAME_PORT_MESSAGE },
        ports: [],
        source: window.parent,
      })
    )
    expect(port.start).not.toHaveBeenCalled()
  })

  it('adopts the port the parent posts', async () => {
    const { port } = await loadShimInFrame()
    deliverPort(port as unknown as MessagePort)
    expect(port.start).toHaveBeenCalled()
  })
})

async function connectedFrame() {
  const { port } = await loadShimInFrame()
  deliverPort(port as unknown as MessagePort)
  return { port, api: frameApi() }
}

function fakeFramePort(): FakePort {
  return {
    posted: [],
    onmessage: null,
    start: vi.fn(),
    close: vi.fn(),
    postMessage(message: unknown) {
      this.posted.push(message)
    },
  }
}

describe('frame-shim transport queueing', () => {
  it('delivers a request made before the port arrives once the port is adopted', async () => {
    const { port } = await loadShimInFrame()
    void frameApi().workspace.list()
    frameApi().logger.write('info', 'test', 'queued')
    expect(port.posted).toEqual([])
    deliverPort(port as unknown as MessagePort)
    expect(port.posted).toContainEqual({ type: 'invoke', id: 'f1', channel: 'workspace:list' })
    expect(port.posted).toContainEqual({
      type: 'send',
      channel: 'log:write',
      payload: { level: 'info', namespace: 'test', message: 'queued' },
    })
  })
})

describe('frame-shim port replacement', () => {
  it('a later port replaces an earlier one', async () => {
    const { port } = await loadShimInFrame()
    deliverPort(port as unknown as MessagePort)
    const replacement = fakeFramePort()
    deliverPort(replacement as unknown as MessagePort)
    void frameApi().workspace.list()
    expect(port.posted).toEqual([])
    expect(replacement.posted).toContainEqual(
      expect.objectContaining({ type: 'invoke', channel: 'workspace:list' })
    )
  })
})

describe('frame-shim invoke replies', () => {
  it('resolves an invoke with the result message that matches its id', async () => {
    const { port, api } = await connectedFrame()
    const pending = api.workspace.list() as Promise<unknown>
    const request = port.posted[0] as { type: string; id: string; channel: string }
    expect(request.type).toBe('invoke')
    expect(request.channel).toBe('workspace:list')
    port.onmessage?.({ data: { type: 'result', id: request.id, result: ['ws1'] } })
    await expect(pending).resolves.toEqual(['ws1'])
  })

  it('rejects an invoke when the reply is an error', async () => {
    const { port, api } = await connectedFrame()
    const pending = api.workspace.list() as Promise<unknown>
    const request = port.posted[0] as { id: string }
    port.onmessage?.({ data: { type: 'error', id: request.id, error: 'boom' } })
    await expect(pending).rejects.toThrow('boom')
  })
})

describe('frame-shim pushed messages', () => {
  it('delivers an event to the channel subscribers after one subscribe request', async () => {
    const { port, api } = await connectedFrame()
    const handler = vi.fn()
    api.terminal.onProcessExit(handler)
    expect(port.posted).toEqual([{ type: 'subscribe', channel: 'terminal:process-exit' }])
    port.onmessage?.({
      data: {
        type: 'event',
        channel: 'terminal:process-exit',
        args: [{ sessionId: 's1', exitCode: 0 }],
      },
    })
    expect(handler).toHaveBeenCalledWith('s1', 0)
  })

  it('applies a light theme by stamping data-theme and a dark theme by removing it', async () => {
    const { port } = await connectedFrame()
    port.onmessage?.({ data: { type: 'theme', theme: 'light' } })
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    port.onmessage?.({ data: { type: 'theme', theme: 'dark' } })
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

function pressFrameKey(key: string, init: KeyboardEventInit = {}) {
  // happy-dom targets a window-dispatched event at the window itself; the
  // shim's guards read event.target, so dispatch at body like a page would.
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
}

describe('frame-shim keyboard gestures', () => {
  it('posts request-exit on two quick Escape presses', async () => {
    const { port } = await connectedFrame()
    pressFrameKey('Escape')
    pressFrameKey('Escape')
    expect(port.posted).toContainEqual({ type: 'request-exit' })
  })

  it('does not post request-exit while a modal is open', async () => {
    const { port, api } = await connectedFrame()
    api.ui.setModalDepth(1)
    pressFrameKey('Escape')
    pressFrameKey('Escape')
    expect(port.posted).not.toContainEqual({ type: 'request-exit' })
  })

  it('posts quick-actions-open on Cmd+P and swallows the key', async () => {
    const { port } = await connectedFrame()
    const event = new KeyboardEvent('keydown', {
      key: 'p',
      metaKey: true,
      cancelable: true,
      bubbles: true,
    })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(port.posted).toContainEqual({ type: 'quick-actions-open' })
  })
})
