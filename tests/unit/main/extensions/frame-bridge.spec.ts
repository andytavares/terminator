import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import type { FrameReply } from '../../../../src/shared/frame-wire.js'
import type { ViewCaller } from '../../../../src/main/ipc/invoke-table.js'
import type { IpcRegistryEntry, IpcSendHandler } from '../../../../src/main/remote/ipc-registry.js'

const { channelListeners } = vi.hoisted(() => ({
  channelListeners: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
}))

vi.mock('electron', async () => {
  const { nodePortAsFramePort: asFramePort } = await import('../../../support/frame-port.js')
  return {
    ipcMain: {
      handle: vi.fn(),
      removeHandler: vi.fn(),
      on: (channel: string, receive: (event: unknown, payload?: unknown) => unknown) =>
        channelListeners.set(channel, receive),
    },
    MessageChannelMain: class {
      port1: unknown
      port2: unknown
      constructor() {
        const channel = new MessageChannel()
        this.port1 = channel.port1
        this.port2 = asFramePort(channel.port2)
      }
    },
  }
})

import {
  FrameBridge,
  registerFramePortChannel,
} from '../../../../src/main/extensions/frame-bridge.js'
import { nodePortAsFramePort } from '../../../support/frame-port.js'
import { eventually } from '../../../support/eventually'

/** Answered by the bridge once it has handled everything the frame posted before asking. */
const BARRIER_CHANNEL = 'frame:barrier'

interface Opened {
  surface: { extensionId: string; viewParam: string }
  received: FrameReply[]
  gone: Promise<void>
  post(message: unknown): void
  /** Resolves once the bridge has handled what was posted so far and the frame has received what
   * the bridge sent first: a port delivers in order, so the barrier's reply arrives last. */
  settled(): Promise<void>
  /** Simulates the port 'close' reaching main (Node delivers it asynchronously). */
  dropForTest(): void
}

/** One frame opened on `bridge`: what it received, and how it goes away. */
function openFrame(bridge: FrameBridge, extensionId: string, viewParam: string): Opened {
  const { port1, port2 } = new MessageChannel()
  const received: FrameReply[] = []
  const barriers = new Map<string, () => void>()
  port1.on('message', (data) => {
    const message = data as FrameReply
    const release = message.type === 'result' ? barriers.get(message.id) : undefined
    if (release) release()
    else received.push(message)
  })
  const port = nodePortAsFramePort(port2)
  bridge.open({ extensionId, viewParam, frameToken: 't' }, port)
  const caller = bridge.viewCallerOf({ extensionId, viewParam })!
  return {
    surface: { extensionId, viewParam },
    received,
    gone: new Promise((resolve) => caller.onGone(resolve)),
    post: (message) => port1.postMessage(message),
    settled: () =>
      new Promise((resolve) => {
        const id = `barrier-${barriers.size}`
        barriers.set(id, resolve)
        port1.postMessage({ type: 'invoke', id, channel: BARRIER_CHANNEL })
      }),
    dropForTest: () => (port as unknown as { dropForTest(): void }).dropForTest(),
  }
}

/** The reply to one invoke over `frame`'s port. */
function invokeFrame(frame: Opened, channel: string, payload?: unknown): Promise<FrameReply> {
  const id = `inv-${Math.random()}`
  frame.post({ type: 'invoke', id, channel, payload })
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      const reply = frame.received.find(
        (m) => (m.type === 'result' || m.type === 'error') && m.id === id
      )
      if (reply) {
        clearInterval(poll)
        resolve(reply)
      }
    }, 1)
  })
}

function makeCallbacks() {
  return {
    invokeRegistry: new Map<string, IpcRegistryEntry>([
      [BARRIER_CHANNEL, { handler: () => null, remoteAccessible: false }],
    ]),
    sendRegistry: new Map<string, IpcSendHandler>(),
    onExitRequest: vi.fn(),
    onQuickActionsOpen: vi.fn(),
    onSettingsOpen: vi.fn(),
    onUsage: vi.fn(),
  }
}

function makeBridge(callbacks: ReturnType<typeof makeCallbacks>): FrameBridge {
  return new FrameBridge({
    invokeRegistry: callbacks.invokeRegistry,
    sendRegistry: callbacks.sendRegistry,
    onExitRequest: callbacks.onExitRequest,
    onQuickActionsOpen: callbacks.onQuickActionsOpen,
    onSettingsOpen: callbacks.onSettingsOpen,
    onUsage: callbacks.onUsage,
  })
}

function useBridge() {
  let spies: ReturnType<typeof makeCallbacks>
  let frameBridge: FrameBridge
  beforeEach(() => {
    spies = makeCallbacks()
    frameBridge = makeBridge(spies)
  })
  return {
    spies: () => spies,
    frameBridge: () => frameBridge,
    open: (extensionId: string, viewParam: string) =>
      openFrame(frameBridge, extensionId, viewParam),
  }
}

describe('FrameBridge — what a new frame is sent', () => {
  const rig = useBridge()

  it('sends a new frame the current theme', async () => {
    rig.frameBridge().setTheme('dark')
    const frame = rig.open('ext.a', 'main')
    await frame.settled()
    expect(frame.received).toContainEqual({ type: 'theme', theme: 'dark' })
  })

  it('sends a new frame the last broadcast workspace:changed', async () => {
    rig.frameBridge().broadcast('workspace:changed', { workspaceId: 'w1' })
    const frame = rig.open('ext.a', 'main')
    await frame.settled()
    expect(frame.received).toContainEqual({
      type: 'event',
      channel: 'workspace:changed',
      args: [{ workspaceId: 'w1' }],
    })
  })

  it('does not send a workspace:changed when none was broadcast', async () => {
    const frame = rig.open('ext.a', 'main')
    await frame.settled()
    expect(
      frame.received.filter((m) => m.type === 'event' && m.channel === 'workspace:changed')
    ).toEqual([])
  })
})

describe('FrameBridge — reopening', () => {
  const rig = useBridge()

  it('reopening the same surface fires the old frame onGone', async () => {
    const first = rig.open('ext.a', 'main')
    rig.open('ext.a', 'main')
    await expect(first.gone).resolves.toBeUndefined()
  })
})

describe('FrameBridge — invoke answers', () => {
  const rig = useBridge()

  function stubInvoke(channel: string, handler: IpcRegistryEntry['handler']): void {
    rig.spies().invokeRegistry.set(channel, { handler, remoteAccessible: false })
  }

  it('resolves an invoke through a registered handler and replies result', async () => {
    stubInvoke('fs:read-file', () => ({ content: 'hello' }))
    const frame = rig.open('ext.a', 'main')
    await expect(invokeFrame(frame, 'fs:read-file', { filePath: '/x' })).resolves.toEqual({
      type: 'result',
      id: expect.any(String),
      result: { content: 'hello' },
    })
  })

  it('hands the invoke handler an event carrying this frame ViewCaller', async () => {
    let seen: { frame?: ViewCaller } | undefined
    stubInvoke('fs:watch-start', ((event: unknown) => {
      seen = event as { frame?: ViewCaller }
      return { ok: true }
    }) as never)
    const frame = rig.open('ext.a', 'main')
    await invokeFrame(frame, 'fs:watch-start', { projectRoot: '/r' })
    expect(seen?.frame).toBe(
      rig.frameBridge().viewCallerOf({ extensionId: 'ext.a', viewParam: 'main' })
    )
  })
})

describe('FrameBridge — invoke failures', () => {
  const rig = useBridge()

  function stubInvoke(channel: string, handler: IpcRegistryEntry['handler']): void {
    rig.spies().invokeRegistry.set(channel, { handler, remoteAccessible: false })
  }

  it('replies error for a channel nobody handles', async () => {
    const frame = rig.open('ext.a', 'main')
    const reply = await invokeFrame(frame, 'no:such-channel')
    expect(reply.type).toBe('error')
  })

  it('replies error for a usage: channel even when a handler is registered', async () => {
    const handler = vi.fn()
    stubInvoke('usage:report', handler as never)
    const frame = rig.open('ext.a', 'main')
    const reply = await invokeFrame(frame, 'usage:report', { from: null })
    expect(reply.type).toBe('error')
    expect(handler).not.toHaveBeenCalled()
  })

  it('replies error when the handler throws', async () => {
    stubInvoke('boom', (() => {
      throw new Error('kaput')
    }) as never)
    const frame = rig.open('ext.a', 'main')
    const reply = await invokeFrame(frame, 'boom')
    expect(reply.type).toBe('error')
    expect((reply as { error: string }).error).toContain('kaput')
  })
})

describe('FrameBridge — send', () => {
  const rig = useBridge()

  it('dispatches send to the registered send handler', async () => {
    const send = vi.fn()
    rig.spies().sendRegistry.set('terminal:input', send)
    const frame = rig.open('ext.a', 'main')
    frame.post({ type: 'send', channel: 'terminal:input', payload: 'ls' })
    await eventually(() => expect(send).toHaveBeenCalledWith(expect.anything(), 'ls'))
  })

  it('drops a send to a usage: channel', async () => {
    const send = vi.fn()
    rig.spies().sendRegistry.set('usage:record', send)
    const frame = rig.open('ext.a', 'main')
    frame.post({ type: 'send', channel: 'usage:record', payload: {} })
    await frame.settled()
    expect(send).not.toHaveBeenCalled()
  })

  it('a frame ViewCaller.send reaches only that frame', async () => {
    const a = rig.open('ext.a', 'main')
    const b = rig.open('ext.b', 'main')
    rig.frameBridge().viewCallerOf(a.surface)!.send('fs:changed', { filename: 'a.ts' })
    await Promise.all([a.settled(), b.settled()])
    expect(a.received).toContainEqual({
      type: 'event',
      channel: 'fs:changed',
      args: [{ filename: 'a.ts' }],
    })
    expect(b.received.some((m) => m.type === 'event' && m.channel === 'fs:changed')).toBe(false)
  })
})

describe('FrameBridge — broadcast and theme', () => {
  const rig = useBridge()

  it('broadcast reaches only frames subscribed to the channel', async () => {
    const a = rig.open('ext.a', 'main')
    const b = rig.open('ext.b', 'main')
    a.post({ type: 'subscribe', channel: 'workspace:changed' })
    await a.settled()
    rig.frameBridge().broadcast('workspace:changed', { workspaceId: 'w9' })
    await Promise.all([a.settled(), b.settled()])
    expect(
      a.received.filter(
        (m) => m.type === 'event' && (m.args[0] as { workspaceId: string }).workspaceId === 'w9'
      )
    ).toHaveLength(1)
    expect(
      b.received.some(
        (m) => m.type === 'event' && (m.args[0] as { workspaceId: string })?.workspaceId === 'w9'
      )
    ).toBe(false)
  })

  it('setTheme posts the theme to every open frame', async () => {
    const a = rig.open('ext.a', 'main')
    const b = rig.open('ext.b', 'main')
    rig.frameBridge().setTheme('light')
    await Promise.all([a.settled(), b.settled()])
    expect(a.received.at(-1)).toEqual({ type: 'theme', theme: 'light' })
    expect(b.received.at(-1)).toEqual({ type: 'theme', theme: 'light' })
  })
})

describe('FrameBridge — exit and quick actions', () => {
  const rig = useBridge()

  it('request-exit calls onExitRequest with the frame surface', async () => {
    const frame = rig.open('ext.a', 'sidebar')
    frame.post({ type: 'request-exit' })
    await frame.settled()
    expect(rig.spies().onExitRequest).toHaveBeenCalledWith({
      extensionId: 'ext.a',
      viewParam: 'sidebar',
    })
  })

  it('quick-actions-open calls onQuickActionsOpen', async () => {
    const frame = rig.open('ext.a', 'main')
    frame.post({ type: 'quick-actions-open' })
    await frame.settled()
    expect(rig.spies().onQuickActionsOpen).toHaveBeenCalled()
  })

  it('settings-open calls onSettingsOpen, not onQuickActionsOpen', async () => {
    const frame = rig.open('ext.a', 'main')
    frame.post({ type: 'settings-open' })
    await frame.settled()
    expect(rig.spies().onSettingsOpen).toHaveBeenCalled()
    expect(rig.spies().onQuickActionsOpen).not.toHaveBeenCalled()
  })
})

describe('FrameBridge — usage', () => {
  const rig = useBridge()

  it('reports a usage message under the frame extension id', async () => {
    const frame = rig.open('ext.a', 'main')
    frame.post({ type: 'usage', feature: 'export', failed: true })
    await frame.settled()
    expect(rig.spies().onUsage).toHaveBeenCalledWith('ext.a', 'export', true)
  })

  it('ignores an extension id forged in the payload', async () => {
    const frame = rig.open('ext.a', 'main')
    frame.post({ type: 'usage', feature: 'export', extensionId: 'ext.b' })
    await frame.settled()
    expect(rig.spies().onUsage).toHaveBeenCalledWith('ext.a', 'export', undefined)
  })
})

describe('FrameBridge — closing', () => {
  const rig = useBridge()

  it('the port closing fires onGone', async () => {
    const frame = rig.open('ext.a', 'main')
    frame.dropForTest()
    await expect(frame.gone).resolves.toBeUndefined()
  })

  it('closeExtension closes that extension ports and leaves others open', async () => {
    const a = rig.open('ext.a', 'main')
    const b = rig.open('ext.b', 'main')
    rig.frameBridge().closeExtension('ext.a')
    a.dropForTest()
    await expect(a.gone).resolves.toBeUndefined()
    rig.frameBridge().viewCallerOf(b.surface)!.send('fs:changed', null)
    await b.settled()
    expect(b.received.some((m) => m.type === 'event' && m.channel === 'fs:changed')).toBe(true)
  })
})

function openPortRequest(payload: unknown) {
  const sender = { postMessage: vi.fn() }
  const settled = channelListeners.get('extension:open-frame-port')!({ sender }, payload)
  return { sender, settled: Promise.resolve(settled) }
}

describe('registerFramePortChannel — a validated request', () => {
  beforeEach(() => channelListeners.clear())

  it('is handed a port and replied to with its frameToken', async () => {
    const bridge = makeBridge(makeCallbacks())
    const open = vi.spyOn(bridge, 'open')
    registerFramePortChannel(bridge, () => Promise.resolve())
    const request = { extensionId: 'ext.a', viewParam: 'main', frameToken: 'tok-1' }
    const { sender, settled } = openPortRequest(request)
    await settled
    expect(open).toHaveBeenCalledWith(request, expect.anything())
    expect(sender.postMessage).toHaveBeenCalledWith(
      'extension:frame-port',
      { frameToken: 'tok-1' },
      [expect.anything()]
    )
  })
})

describe('registerFramePortChannel — waiting for the backend', () => {
  beforeEach(() => channelListeners.clear())

  it("gives the frame its port only after the extension's backend has activated", async () => {
    let activate = () => {}
    const whenActivated = vi.fn(() => new Promise<void>((resolve) => (activate = resolve)))
    registerFramePortChannel(makeBridge(makeCallbacks()), whenActivated)
    const request = { extensionId: 'ext.slow', viewParam: 'main', frameToken: 'tok-2' }
    const { sender, settled } = openPortRequest(request)
    await eventually(() => expect(whenActivated).toHaveBeenCalledWith('ext.slow'))
    expect(sender.postMessage).not.toHaveBeenCalled()
    activate()
    await settled
    expect(sender.postMessage).toHaveBeenCalledTimes(1)
  })
})

describe('registerFramePortChannel — invalid requests', () => {
  beforeEach(() => channelListeners.clear())

  it.each([
    { extensionId: '', viewParam: 'main', frameToken: 'tok' },
    { extensionId: 'ext.a', viewParam: 'main', frameToken: '' },
    { extensionId: 'ext.a' },
    'not-an-object',
  ])('drops the invalid request %j', async (payload) => {
    const bridge = makeBridge(makeCallbacks())
    const open = vi.spyOn(bridge, 'open')
    const whenActivated = vi.fn(() => Promise.resolve())
    registerFramePortChannel(bridge, whenActivated)
    const { sender, settled } = openPortRequest(payload)
    await settled
    expect(whenActivated).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    expect(sender.postMessage).not.toHaveBeenCalled()
  })
})
