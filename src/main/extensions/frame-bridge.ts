import { MessageChannelMain } from 'electron'
import type { IpcRegistryEntry, IpcSendHandler } from '../remote/ipc-registry.js'
import { z } from 'zod'
import {
  FRAME_PORT_CHANNEL,
  OPEN_FRAME_PORT_CHANNEL,
  type FramePortRequest,
  type FrameReply,
  type FrameRequest,
} from '../../shared/frame-wire.js'
import { announce } from '../e2e-readiness.js'
import { onChannel } from '../ipc/channel-registrar.js'
import { makeGoneTracker, type ViewCaller } from '../ipc/invoke-table.js'
import type { ExtensionSurface } from './extension-exit.js'

// Main's side of each extension frame's port (ADR 114). One FrameBridge serves every frame:
// it answers invokes through the channel registry, forwards events to the frames that asked,
// and relays exit and quick-actions requests.

/** A MessagePortMain, or a Node MessagePort in tests. */
export interface FramePort {
  postMessage(message: FrameReply): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  on(event: 'close', listener: () => void): void
  once(event: 'close', listener: () => void): void
  start(): void
  close(): void
}

export interface FrameBridgeDeps {
  invokeRegistry: Map<string, IpcRegistryEntry>
  sendRegistry: Map<string, IpcSendHandler>
  onExitRequest(surface: ExtensionSurface): void
  onQuickActionsOpen(): void
  onSettingsOpen(): void
  onUsage(extensionId: string, feature: string, failed: boolean | undefined): void
}

interface Frame {
  surface: ExtensionSurface
  port: FramePort
  caller: ViewCaller
  subscriptions: Set<string>
  fireGone(): void
}

function surfaceKey(surface: ExtensionSurface): string {
  return `${surface.extensionId}${surface.viewParam}`
}

export class FrameBridge {
  private readonly frames = new Map<string, Frame>()
  private theme: 'dark' | 'light' = 'dark'
  private lastWorkspaceChanged: unknown

  constructor(private readonly deps: FrameBridgeDeps) {}

  open(request: FramePortRequest, port: FramePort): void {
    const surface = { extensionId: request.extensionId, viewParam: request.viewParam }
    const replaced = this.frames.get(surfaceKey(surface))
    if (replaced) this.dropFrame(replaced)
    const frame = this.startFrame(surface, port)
    port.on('message', (event) => this.onRequest(frame, event.data as FrameRequest))
    port.once('close', () => this.dropFrame(frame))
    port.start()
    port.postMessage({ type: 'theme', theme: this.theme })
    if (this.lastWorkspaceChanged !== undefined) {
      this.emitFrameEvent(frame, 'workspace:changed', this.lastWorkspaceChanged)
    }
    replaced?.port.close()
    announce('ready', `${surface.extensionId}:${surface.viewParam}`)
  }

  broadcast(channel: string, data: unknown): void {
    if (channel === 'workspace:changed') this.lastWorkspaceChanged = data
    for (const frame of this.frames.values()) {
      if (frame.subscriptions.has(channel)) this.emitFrameEvent(frame, channel, data)
    }
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.theme = theme
    for (const frame of this.frames.values()) frame.port.postMessage({ type: 'theme', theme })
  }

  closeExtension(extensionId: string): void {
    for (const frame of this.frames.values()) {
      if (frame.surface.extensionId === extensionId) frame.port.close()
    }
  }

  /** The ViewCaller of the open frame at `surface`, or undefined when it has none. */
  viewCallerOf(surface: ExtensionSurface): ViewCaller | undefined {
    return this.frames.get(surfaceKey(surface))?.caller
  }

  private startFrame(surface: ExtensionSurface, port: FramePort): Frame {
    const gone = makeGoneTracker()
    const frame: Frame = {
      surface,
      port,
      subscriptions: new Set(),
      fireGone: gone.fireGone,
      caller: {
        send: (channel, data) => this.emitFrameEvent(frame, channel, data),
        onGone: gone.onGone,
      },
    }
    this.frames.set(surfaceKey(surface), frame)
    return frame
  }

  private dropFrame(frame: Frame): void {
    if (this.frames.get(surfaceKey(frame.surface)) !== frame) return
    this.frames.delete(surfaceKey(frame.surface))
    frame.fireGone()
  }

  private emitFrameEvent(frame: Frame, channel: string, data: unknown): void {
    frame.port.postMessage({ type: 'event', channel, args: [data] })
  }

  private onRequest(frame: Frame, message: FrameRequest): void {
    if (message.type === 'invoke') return void this.answerInvoke(frame, message)
    if (message.type === 'send') return this.dispatchSend(frame, message)
    if (message.type === 'subscribe') return void frame.subscriptions.add(message.channel)
    if (message.type === 'request-exit') return this.deps.onExitRequest(frame.surface)
    if (message.type === 'settings-open') return this.deps.onSettingsOpen()
    if (message.type === 'usage')
      return this.deps.onUsage(frame.surface.extensionId, message.feature, message.failed)
    this.deps.onQuickActionsOpen()
  }

  private async answerInvoke(
    frame: Frame,
    message: Extract<FrameRequest, { type: 'invoke' }>
  ): Promise<void> {
    const entry = isCoreOnly(message.channel)
      ? undefined
      : this.deps.invokeRegistry.get(message.channel)
    if (!entry) {
      const error = `No handler for "${message.channel}"`
      frame.port.postMessage({ type: 'error', id: message.id, error })
      return
    }
    try {
      const result = await entry.handler({ frame: frame.caller } as never, message.payload)
      frame.port.postMessage({ type: 'result', id: message.id, result })
    } catch (error) {
      frame.port.postMessage({ type: 'error', id: message.id, error: String(error) })
    }
  }

  private dispatchSend(frame: Frame, message: Extract<FrameRequest, { type: 'send' }>): void {
    if (isCoreOnly(message.channel)) return
    this.deps.sendRegistry.get(message.channel)?.({ frame: frame.caller } as never, message.payload)
  }
}

/** The usage counts belong to core: a view cannot read or write them. */
const isCoreOnly = (channel: string): boolean => channel.startsWith('usage:')

const FramePortRequestSchema = z.object({
  extensionId: z.string().min(1),
  viewParam: z.string(),
  frameToken: z.string().min(1),
})

/** Wires the renderer's open-port requests to `bridge`. A frame gets its port only once its
 * extension's backend has activated, so it never talks to a backend that is not there yet. */
export function registerFramePortChannel(
  bridge: FrameBridge,
  whenActivated: (extensionId: string) => Promise<void>
): void {
  onChannel(OPEN_FRAME_PORT_CHANNEL, async (event, payload: unknown) => {
    const parsed = FramePortRequestSchema.safeParse(payload)
    if (!parsed.success) return
    await whenActivated(parsed.data.extensionId)
    const { port1, port2 } = new MessageChannelMain()
    bridge.open(parsed.data, port2 as unknown as FramePort)
    event.sender.postMessage(FRAME_PORT_CHANNEL, { frameToken: parsed.data.frameToken }, [port1])
  })
}
