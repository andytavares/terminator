// Runs as an IIFE before the renderer bundle. Sets up window.electronAPI over a WebSocket
// bridge so the unmodified Electron renderer can run in any browser.
//
// The electronAPI surface is declared once in src/shared/electron-api/manifest.ts;
// this file only supplies the WebSocket transport and the browser-local stubs for
// methods that cannot work remotely (native dialogs, WebContentsView bounds, …).
import { buildElectronApi, type ApiTransport } from '../shared/electron-api/build-api.js'
;(function () {
  let ws: WebSocket
  let wsReady = false
  const sendQueue: string[] = []
  let reqId = 0
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
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

  async function connectBridge(): Promise<void> {
    const token = localStorage.getItem('remote_token') ?? ''
    let ticket: string
    try {
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch('/api/bridge-ticket', { method: 'POST', headers })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          // Session expired or missing — send back to login
          location.replace('/')
          return
        }
        setTimeout(() => void connectBridge(), 2000)
        return
      }
      ticket = ((await res.json()) as { ticket: string }).ticket
    } catch {
      setTimeout(() => void connectBridge(), 2000)
      return
    }

    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(
      `${wsProto}//${location.host}/api/bridge?ticket=${encodeURIComponent(ticket)}`
    )

    ws.onopen = () => {
      wsReady = true
      // Re-subscribe to all active channels (handles reconnects)
      for (const channel of listeners.keys()) {
        ws.send(JSON.stringify({ type: 'subscribe', channel }))
      }
      for (const msg of sendQueue) ws.send(msg)
      sendQueue.length = 0
    }

    ws.onmessage = (event) => {
      let msg: {
        type: string
        id?: string
        result?: unknown
        error?: string
        channel?: string
        args?: unknown[]
      }
      try {
        msg = JSON.parse(event.data as string)
      } catch {
        return
      }

      if (msg.type === 'result' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve(msg.result)
        }
      } else if (msg.type === 'error' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.reject(new Error(msg.error ?? 'bridge error'))
        }
      } else if (msg.type === 'event' && msg.channel) {
        const cbs = listeners.get(msg.channel)
        if (cbs) {
          const args = msg.args ?? []
          cbs.forEach((cb) => cb(...args))
        }
      }
    }

    ws.onclose = () => {
      wsReady = false
      for (const { reject } of pending.values()) {
        reject(new Error('bridge disconnected'))
      }
      pending.clear()
      setTimeout(() => void connectBridge(), 2000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }

  void connectBridge()

  const transport: ApiTransport = {
    invoke,
    send: fire,
    subscribe: (channel, listener) => on(channel, (...args) => listener(args)),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).electronAPI = buildElectronApi(transport, {
    mode: 'remote',
    locals: {
      // No Electron accelerators in a browser — nothing is reserved.
      'keyboard.isReserved': () => false,
      // A browser client cannot open a native directory picker.
      'dialog.openDirectory': () => Promise.resolve({ cancelled: true }),
      // Open in a new browser tab instead of the host OS.
      'shell.openExternal': (url: string) => {
        window.open(url, '_blank')
        return Promise.resolve()
      },
      // No-op in remote mode: WebContentsView positioning is an Electron-only concept.
      'extension.updatePanelBounds': () => {},
      // Dynamic passthrough for extension-owned channels.
      'extensionBridge.invoke': (channel: string, payload?: unknown) => invoke(channel, payload),
      'extensionBridge.on': (channel: string, handler: (data: unknown) => void) =>
        on(channel, (data) => handler(data)),
    },
  })
})()
