import type WebSocket from 'ws'

const WS_OPEN = 1

interface SessionEntry {
  subscribers: Set<WebSocket>
  primary: WebSocket | null
}

export class WsSubscriberManager {
  private sessions = new Map<string, SessionEntry>()

  addSubscriber(sessionId: string, ws: WebSocket, maxSubscribers: number): boolean {
    let entry = this.sessions.get(sessionId)
    if (!entry) {
      entry = { subscribers: new Set(), primary: null }
      this.sessions.set(sessionId, entry)
    }
    if (entry.subscribers.size >= maxSubscribers) {
      ws.close(4003, 'subscriber limit reached')
      return false
    }
    entry.subscribers.add(ws)
    if (!entry.primary) entry.primary = ws
    return true
  }

  removeSubscriber(sessionId: string, ws: WebSocket): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    entry.subscribers.delete(ws)
    if (entry.primary === ws) {
      entry.primary = entry.subscribers.size > 0 ? entry.subscribers.values().next().value! : null
    }
  }

  isPrimary(sessionId: string, ws: WebSocket): boolean {
    return this.sessions.get(sessionId)?.primary === ws
  }

  getPrimary(sessionId: string): WebSocket | null {
    return this.sessions.get(sessionId)?.primary ?? null
  }

  broadcast(sessionId: string, data: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    for (const ws of entry.subscribers) {
      if (ws.readyState === WS_OPEN) ws.send(data)
    }
  }

  destroySession(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    for (const ws of entry.subscribers) {
      ws.close(1000, 'session destroyed')
    }
    this.sessions.delete(sessionId)
  }

  getCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.subscribers.size ?? 0
  }

  destroyAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.destroySession(sessionId)
    }
  }
}
