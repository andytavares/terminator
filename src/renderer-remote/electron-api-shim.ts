// Runs as an IIFE before the renderer bundle. Sets up window.electronAPI over a WebSocket
// bridge so the unmodified Electron renderer can run in any browser.
//
// The electronAPI surface is declared once in src/shared/electron-api/manifest.ts;
// this file only supplies the WebSocket transport and the browser-local stubs for
// methods that cannot work remotely (native dialogs, WebContentsView bounds, …).
import { buildElectronApi, type ApiTransport } from '../shared/electron-api/build-api.js'
import { forgetLegacyToken } from './api/remote-client.js'

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

interface BridgeMessage {
  type: string
  id?: string
  result?: unknown
  error?: string
  channel?: string
  args?: unknown[]
}

function parseBridgeMessage(data: string): BridgeMessage | null {
  try {
    return JSON.parse(data) as BridgeMessage
  } catch {
    return null
  }
}

forgetLegacyToken()
;(function () {
  let ws: WebSocket
  let wsReady = false
  const sendQueue: string[] = []
  let reqId = 0
  const pending = new Map<string, Pending>()
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  function sendRaw(msg: unknown) {
    const s = JSON.stringify(msg)
    if (wsReady) {
      ws.send(s)
    } else {
      sendQueue.push(s)
    }
  }

  function invoke(channel: string, payload?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = `r${++reqId}`
      pending.set(id, { resolve, reject })
      sendRaw({ type: 'invoke', id, channel, args: [payload] })
    })
  }

  function fire(channel: string, payload?: unknown) {
    sendRaw({ type: 'send', channel, args: [payload] })
  }

  function on(channel: string, handler: (...args: unknown[]) => void): () => void {
    if (!listeners.has(channel)) {
      listeners.set(channel, new Set())
      sendRaw({ type: 'subscribe', channel })
    }
    listeners.get(channel)!.add(handler)
    return () => {
      listeners.get(channel)?.delete(handler)
    }
  }

  function retryLater() {
    setTimeout(() => void connectBridge(), 2000)
  }

  /** A one-time ticket for the bridge socket, or null when it went back to login or will retry. */
  async function fetchBridgeTicket(): Promise<string | null> {
    try {
      const res = await fetch('/api/bridge-ticket', { method: 'POST', credentials: 'same-origin' })
      if (res.ok) return ((await res.json()) as { ticket: string }).ticket
      if (res.status === 401 || res.status === 403) {
        // Session expired or missing — send back to login
        location.replace('/')
      } else {
        retryLater()
      }
    } catch {
      retryLater()
    }
    return null
  }

  async function connectBridge(): Promise<void> {
    const ticket = await fetchBridgeTicket()
    if (ticket === null) return

    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(
      `${wsProto}//${location.host}/api/bridge?ticket=${encodeURIComponent(ticket)}`
    )
    ws.onopen = onBridgeOpen
    ws.onmessage = (event) => {
      const msg = parseBridgeMessage(event.data as string)
      if (msg) onBridgeMessage(msg)
    }
    ws.onclose = onBridgeClose
    ws.onerror = () => {
      ws.close()
    }
  }

  function onBridgeOpen() {
    wsReady = true
    // Re-subscribe to all active channels (handles reconnects)
    for (const channel of listeners.keys()) {
      ws.send(JSON.stringify({ type: 'subscribe', channel }))
    }
    for (const msg of sendQueue) ws.send(msg)
    sendQueue.length = 0
  }

  function onBridgeMessage(msg: BridgeMessage) {
    if (msg.type === 'result' && msg.id) {
      settlePending(msg.id, (p) => p.resolve(msg.result))
    } else if (msg.type === 'error' && msg.id) {
      settlePending(msg.id, (p) => p.reject(new Error(msg.error ?? 'bridge error')))
    } else if (msg.type === 'event' && msg.channel) {
      const args = msg.args ?? []
      listeners.get(msg.channel)?.forEach((cb) => cb(...args))
    }
  }

  /** Answers the invoke waiting on `id`, if one still is. */
  function settlePending(id: string, answer: (p: Pending) => void) {
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    answer(p)
  }

  function onBridgeClose() {
    wsReady = false
    for (const { reject } of pending.values()) {
      reject(new Error('bridge disconnected'))
    }
    pending.clear()
    retryLater()
  }

  void connectBridge()

  const transport: ApiTransport = {
    invoke,
    send: fire,
    subscribe: (channel, listener) => on(channel, (...args) => listener(args)),
  }

  Object.assign(window, {
    electronAPI: buildElectronApi(transport, {
      mode: 'remote',
      locals: {
        // A browser client cannot open a native directory picker.
        'dialog.openDirectory': () => Promise.resolve({ cancelled: true }),
        // Open in a new browser tab instead of the host OS.
        'shell.openExternal': (url: string) => {
          window.open(url, '_blank')
          return Promise.resolve()
        },
        // Flow control is between the desktop renderer and its own main process.
        'terminal.acknowledge': () => {},
        // No-op in remote mode: WebContentsView positioning is an Electron-only concept.
        'extension.updatePanelBounds': () => {},
        // Dynamic passthrough for extension-owned channels.
        'extensionBridge.invoke': (channel: string, payload?: unknown) => invoke(channel, payload),
        'extensionBridge.on': (channel: string, handler: (data: unknown) => void) =>
          on(channel, (data) => handler(data)),
      },
    }),
  })
})()
