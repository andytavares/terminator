import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WsTicketStore } from '../ws-ticket-store'

describe('WsTicketStore', () => {
  let store: WsTicketStore

  beforeEach(() => {
    store = new WsTicketStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    store.stopCleanup()
    vi.useRealTimers()
  })

  describe('createTicket', () => {
    it('returns a 64-char hex string', () => {
      const ticket = store.createTicket('session-1')
      expect(ticket).toMatch(/^[0-9a-f]{64}$/)
    })

    it('returns a unique ticket each call', () => {
      const t1 = store.createTicket('session-1')
      const t2 = store.createTicket('session-1')
      expect(t1).not.toBe(t2)
    })
  })

  describe('consumeTicket', () => {
    it('returns sessionId on first consumption', () => {
      const ticket = store.createTicket('session-abc')
      expect(store.consumeTicket(ticket)).toBe('session-abc')
    })

    it('returns null on second consumption (single-use)', () => {
      const ticket = store.createTicket('session-abc')
      store.consumeTicket(ticket)
      expect(store.consumeTicket(ticket)).toBeNull()
    })

    it('returns null for unknown ticket', () => {
      expect(store.consumeTicket('deadbeef'.repeat(8))).toBeNull()
    })

    it('returns null for expired ticket (after 30s)', () => {
      const ticket = store.createTicket('session-expired')
      vi.advanceTimersByTime(30_001)
      expect(store.consumeTicket(ticket)).toBeNull()
    })

    it('returns sessionId for ticket just before expiry (29.9s)', () => {
      const ticket = store.createTicket('session-fresh')
      vi.advanceTimersByTime(29_900)
      expect(store.consumeTicket(ticket)).toBe('session-fresh')
    })
  })

  describe('startCleanup / stopCleanup', () => {
    it('startCleanup removes expired tickets on interval', () => {
      store.startCleanup()
      const ticket = store.createTicket('session-cleanup')
      vi.advanceTimersByTime(30_001)
      vi.advanceTimersByTime(60_001)
      expect(store.consumeTicket(ticket)).toBeNull()
    })

    it('stopCleanup prevents further pruning', () => {
      store.startCleanup()
      store.stopCleanup()
      const ticket = store.createTicket('session-stop')
      vi.advanceTimersByTime(30_001)
      vi.advanceTimersByTime(60_001)
      expect(store.consumeTicket(ticket)).toBeNull()
    })
  })
})
