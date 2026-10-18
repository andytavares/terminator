// Runs inside an extension iframe (ext://<id>/index.html) and stands in for the
// preload's contextBridge: window.electronAPI over the MessagePort main hands
// the frame, in the wire shapes of src/shared/frame-wire.ts. Shaped after the
// remote client's src/renderer-remote/electron-api-shim.ts.
//
// The same ext:// index.html also loads in auxiliary top-level windows, where
// the main preload already provides electronAPI — at the top level this shim
// does nothing.
import { buildElectronApi, type ApiTransport } from '../shared/electron-api/build-api.js'
import type { FrameElectronAPI } from '../shared/electron-api/api-type.js'
import { FRAME_PORT_MESSAGE, type FrameReply, type FrameRequest } from '../shared/frame-wire.js'
import {
  createDoubleEscapeDetector,
  escapeContextFromTarget,
  shouldSuppressExitGesture,
} from '../shared/double-escape.js'
import { isQuickActionsLeader } from '../shared/quick-actions-leader.js'

interface FrameShim {
  receiveWindowMessage(event: MessageEvent): void
  receiveKeydown(event: KeyboardEvent): void
}

// The window listeners are installed once and delegate to the latest shim, so
// a reload of this module replaces the shim instead of stacking a second set
// of listeners (happy-dom keeps window listeners across vi.resetModules()).
interface FrameShimWindow extends Window {
  __frameShim?: { current: FrameShim }
}

if (window.top !== window) {
  const frameWindow = window as FrameShimWindow
  if (!frameWindow.__frameShim) {
    const holder = { current: null as unknown as FrameShim }
    frameWindow.addEventListener('message', (event) => holder.current?.receiveWindowMessage(event))
    frameWindow.addEventListener('keydown', (event) => holder.current?.receiveKeydown(event))
    frameWindow.__frameShim = holder
  }
  frameWindow.__frameShim.current = createFrameShim()
}

type FrameLink = ReturnType<typeof createFrameLink>

/** Pending invokes by request id; a reply with that id settles one. */
function createInvokeTable(post: (message: FrameRequest) => void) {
  let requestId = 0
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  return {
    invoke(channel: string, payload?: unknown): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const id = `f${++requestId}`
        pending.set(id, { resolve, reject })
        post({ type: 'invoke', id, channel, payload })
      })
    },
    settle(
      reply: { id: string } & (
        | { type: 'result'; result: unknown }
        | { type: 'error'; error: string }
      )
    ): void {
      const waiter = pending.get(reply.id)
      if (!waiter) return
      pending.delete(reply.id)
      if (reply.type === 'result') {
        waiter.resolve(reply.result)
      } else {
        waiter.reject(new Error(reply.error))
      }
    },
  }
}

/** Subscriptions by channel; the first listener puts a subscribe on the wire
 * and pushed events reach every listener of their channel. */
function createFrameSubscriptions(post: (message: FrameRequest) => void) {
  const listeners = new Map<string, Set<(args: unknown[]) => void>>()
  return {
    subscribe(channel: string, listener: (args: unknown[]) => void): () => void {
      if (!listeners.has(channel)) {
        listeners.set(channel, new Set())
        post({ type: 'subscribe', channel })
      }
      listeners.get(channel)!.add(listener)
      return () => {
        listeners.get(channel)?.delete(listener)
      }
    },
    notify(channel: string, args: unknown[]): void {
      listeners.get(channel)?.forEach((listener) => listener(args))
    },
  }
}

/** The port end of the wire: queues until main's port arrives, then speaks
 * FrameRequest/FrameReply. A later port replaces an earlier one and takes the
 * still-queued requests with it. */
function createFrameLink() {
  let port: MessagePort | null = null
  const queue: FrameRequest[] = []

  function post(message: FrameRequest): void {
    if (port) {
      port.postMessage(message)
    } else {
      queue.push(message)
    }
  }

  const replies = createFrameReplies(post)
  return {
    post,
    subscribe: replies.subscribe,
    invoke: replies.invoke,
    adopt(next: MessagePort): void {
      port = next
      port.onmessage = (event) => replies.receiveReply(event.data as FrameReply)
      port.start()
      while (queue.length > 0) port.postMessage(queue.shift()!)
    },
  }
}

/** The invokes and subscriptions a reply can answer, both fed by `post`. */
function createFrameReplies(post: (message: FrameRequest) => void) {
  const invokes = createInvokeTable(post)
  const subscriptions = createFrameSubscriptions(post)
  return {
    invoke: invokes.invoke,
    subscribe: subscriptions.subscribe,
    receiveReply(reply: FrameReply): void {
      if (reply.type === 'result' || reply.type === 'error') {
        invokes.settle(reply)
      } else if (reply.type === 'event') {
        subscriptions.notify(reply.channel, reply.args)
      } else if (reply.type === 'theme') {
        applyFrameTheme(reply.theme)
      }
    },
  }
}

// The dark palette is the :root default, exactly as applyTheme in
// src/main/extensions/extension-view-host.ts expresses it.
function applyFrameTheme(theme: 'dark' | 'light'): void {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

function createFrameShim(): FrameShim {
  const link = createFrameLink()
  const keydown = createFrameKeydown(link.post)
  installFrameApi(link, keydown.noteModalDepth)
  reportContentHeight()
  return {
    receiveWindowMessage(event: MessageEvent): void {
      if (event.source !== window.parent) return
      if ((event.data as { type?: string } | null)?.type !== FRAME_PORT_MESSAGE) return
      const offered = event.ports[0]
      if (offered) link.adopt(offered)
    },
    receiveKeydown: keydown.handle,
  }
}

/** window.electronAPI in the frame: the frame-mode manifest surface over the
 * link's transport, with the frame's own locals. */
function installFrameApi(link: FrameLink, noteModalDepth: (depth: number) => void): void {
  const transport: ApiTransport = {
    invoke: link.invoke,
    send: (channel, payload) => link.post({ type: 'send', channel, payload }),
    subscribe: link.subscribe,
  }
  const locals = {
    'ui.setModalDepth': noteModalDepth,
    'extensionBridge.invoke': (channel: string, payload?: unknown) => link.invoke(channel, payload),
    'extensionBridge.on': (channel: string, handler: (data: unknown) => void) =>
      link.subscribe(channel, (args) => handler(args[0])),
  }
  const api = buildElectronApi(transport, { mode: 'frame', locals })
  // buildElectronApi returns the manifest's untyped record; the frame surface
  // is typed separately from the app renderer's ElectronAPI.
  Object.assign(window, { electronAPI: api as unknown as FrameElectronAPI })
}

// Escape twice exits the extension; ⌘P/Ctrl+P opens quick actions and ⌘,/Ctrl+, opens
// Settings. In a frame all are keydowns on this document, which main cannot see.
function createFrameKeydown(post: (message: FrameRequest) => void) {
  const escapeDetector = createDoubleEscapeDetector()
  const mac = navigator.platform.startsWith('Mac')
  // Reported through ui.setModalDepth whenever a dialog opens or closes, so the
  // Escape gesture knows something else has claimed the key.
  let modalDepth = 0
  return {
    noteModalDepth(depth: number): void {
      modalDepth = Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : 0
    },
    handle(event: KeyboardEvent): void {
      if (isQuickActionsLeader(keyPressOf(event), mac)) {
        event.preventDefault()
        post({ type: 'quick-actions-open' })
        return
      }
      // The app's own ⌘, (useKeyboardShortcuts), which the host page cannot hear from here.
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        post({ type: 'settings-open' })
        return
      }
      if (event.key !== 'Escape') return
      if (shouldSuppressExitGesture(escapeContextFromTarget(event.target, modalDepth))) {
        escapeDetector.reset()
        return
      }
      if (escapeDetector.register(performance.now())) post({ type: 'request-exit' })
    },
  }
}

// fit=content (ExtensionPanelPortal's fitContent prop) asks the frame to size its host wrapper:
// the shim posts each content height to the embedding window. A packaged app's page is file://,
// which has no referrer and no origin to name, so '*' is the only target there; the portal
// accepts the message by its source window, so the target only keeps the number from other pages.
function parentOrigin(): string {
  return document.referrer ? new URL(document.referrer).origin : '*'
}

function reportContentHeight(): void {
  if (new URLSearchParams(window.location.search).get('fit') !== 'content') return
  // The base CSS makes html and body 100% of the frame, which starts 0px tall: the page would
  // never be taller than the frame, so no height would ever change and none would be reported.
  document.documentElement.style.height = 'auto'
  document.body.style.height = 'auto'
  const targetOrigin = parentOrigin()
  const observer = new ResizeObserver(() => {
    // The element's own height: scrollHeight never reports less than the frame, so it never shrinks.
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height)
    window.parent.postMessage({ type: 'terminator:frame-height', height }, targetOrigin)
  })
  observer.observe(document.documentElement)
}

function keyPressOf(event: KeyboardEvent) {
  return {
    key: event.key,
    meta: event.metaKey,
    control: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  }
}
