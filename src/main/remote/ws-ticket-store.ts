import { randomBytes } from 'crypto'

interface Ticket {
  sessionId: string
  purpose: string
  expiresAt: number
}

const TICKET_TTL_MS = 30_000
const CLEANUP_INTERVAL_MS = 60_000

export class WsTicketStore {
  private tickets = new Map<string, Ticket>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  createTicket(sessionId: string, purpose: string): string {
    const ticket = randomBytes(32).toString('hex')
    this.tickets.set(ticket, { sessionId, purpose, expiresAt: Date.now() + TICKET_TTL_MS })
    return ticket
  }

  consumeTicket(ticket: string, purpose: string): string | null {
    const entry = this.tickets.get(ticket)
    if (!entry) return null
    this.tickets.delete(ticket)
    if (Date.now() > entry.expiresAt) return null
    if (entry.purpose !== purpose) return null
    return entry.sessionId
  }

  startCleanup(): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => {
      const now = Date.now()
      for (const [ticket, entry] of this.tickets) {
        if (now > entry.expiresAt) this.tickets.delete(ticket)
      }
    }, CLEANUP_INTERVAL_MS)
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }
}
