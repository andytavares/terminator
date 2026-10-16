import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { z } from 'zod'
import { dispatchChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { handleChannel } from './channel-registrar.js'

// Schema-driven registration for validated invoke channels. Each row declares
// the channel, its payload schema, the response for invalid payloads, and how
// to produce the success (and optionally failure) response. The
// parse → dispatch → error-envelope skeleton is the SDK's dispatchChannel,
// shared with extension channels.

export { noPayload } from '@terminator/extension-sdk'

/** The view that asked: where per-view answers go, and when that view is gone. A frame's
 * caller posts over its MessagePort; a desktop view's wraps its WebContents. */
export interface ViewCaller {
  send(channel: string, data: unknown): void
  onGone(listener: () => void): void
}

/** A row whose answer depends on which view asked. The remote bridge has no view to name, so
 * such a channel must not be one the bridge can reach. */
export interface ViewChannelSpec extends Omit<ChannelSpec, 'run'> {
  fromView: true
  run: (args: never, caller: ViewCaller) => Promise<unknown> | unknown
}

/** Declares a row that is also given the view that asked. */
export function defineViewChannel<S extends z.ZodType>(
  spec: Omit<ChannelSpec<S>, 'run'> & {
    run: (args: z.infer<S>, caller: ViewCaller) => Promise<unknown> | unknown
  }
): ViewChannelSpec {
  return { ...spec, fromView: true, run: (args, caller) => spec.run(args, caller) }
}

type InvokeRow = ChannelSpec | ViewChannelSpec

const callersByWebContents = new WeakMap<WebContents, ViewCaller>()

/** The gone-listeners of one ViewCaller: fireGone tells each of them the view is gone. */
export function makeGoneTracker(): { onGone(listener: () => void): void; fireGone(): void } {
  const goneListeners = new Set<() => void>()
  return {
    onGone: (listener) => void goneListeners.add(listener),
    fireGone: () => {
      for (const listener of goneListeners) listener()
    },
  }
}

/** The ViewCaller of a desktop WebContents: send forwards to it, and gone fires when it is
 * destroyed or leaves the page that asked (a reload). One caller per WebContents. */
function callerOfWebContents(view: WebContents): ViewCaller {
  const existing = callersByWebContents.get(view)
  if (existing) return existing
  const gone = makeGoneTracker()
  const caller: ViewCaller = {
    send: (channel, data) => view.send(channel, data),
    onGone: gone.onGone,
  }
  view.once('destroyed', gone.fireGone)
  view.on('did-start-navigation', (navigation) => {
    if (navigation.isMainFrame && !navigation.isSameDocument) gone.fireGone()
  })
  callersByWebContents.set(view, caller)
  return caller
}

/** The view behind `event`: a frame the bridge put there, else the sender's WebContents. */
function callerOfEvent(event: IpcMainInvokeEvent): ViewCaller {
  const frame = (event as { frame?: ViewCaller }).frame
  return frame ?? callerOfWebContents(event.sender)
}

/** The row as the dispatcher runs it. The bridge's invoke has no event, and no view row. */
function asDispatched(spec: InvokeRow, event: IpcMainInvokeEvent): ChannelSpec {
  if (!('fromView' in spec)) return spec
  return { ...spec, run: (args) => spec.run(args as never, callerOfEvent(event)) }
}

export function registerInvokeTable(specs: ReadonlyArray<InvokeRow>): void {
  for (const spec of specs) {
    handleChannel(spec.channel, (event, payload) =>
      dispatchChannel(asDispatched(spec, event), payload)
    )
  }
}
