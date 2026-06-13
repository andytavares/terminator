import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WsSubscriberManager } from '../../src/server/ws-subscriber-manager'

function mockWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  }
}

describe('WsSubscriberManager', () => {
  let mgr: WsSubscriberManager

  beforeEach(() => {
    mgr = new WsSubscriberManager()
  })

  describe('addSubscriber', () => {
    it('first subscriber becomes primary', () => {
      const ws = mockWs()
      mgr.addSubscriber('s1', ws as never, 5)
      expect(mgr.isPrimary('s1', ws as never)).toBe(true)
    })

    it('second subscriber is added but not primary', () => {
      const ws1 = mockWs()
      const ws2 = mockWs()
      mgr.addSubscriber('s1', ws1 as never, 5)
      mgr.addSubscriber('s1', ws2 as never, 5)
      expect(mgr.isPrimary('s1', ws2 as never)).toBe(false)
    })

    it('rejects subscriber with close code 4003 when maxSubscribers limit is reached', () => {
      const ws1 = mockWs()
      const ws2 = mockWs()
      const ws3 = mockWs()
      mgr.addSubscriber('s1', ws1 as never, 2)
      mgr.addSubscriber('s1', ws2 as never, 2)
      const accepted = mgr.addSubscriber('s1', ws3 as never, 2)
      expect(accepted).toBe(false)
      expect(ws3.close).toHaveBeenCalledWith(4003, 'subscriber limit reached')
    })

    it('accepts subscriber when count equals maxSubscribers - 1', () => {
      const ws1 = mockWs()
      const ws2 = mockWs()
      mgr.addSubscriber('s1', ws1 as never, 2)
      const accepted = mgr.addSubscriber('s1', ws2 as never, 2)
      expect(accepted).toBe(true)
      expect(ws2.close).not.toHaveBeenCalled()
    })

    it('returns true for accepted subscriber', () => {
      const ws = mockWs()
      const result = mgr.addSubscriber('s1', ws as never, 5)
      expect(result).toBe(true)
    })

    it('getPrimary returns first subscriber', () => {
      const ws1 = mockWs()
      const ws2 = mockWs()
      mgr.addSubscriber('s1', ws1 as never, 5)
      mgr.addSubscriber('s1', ws2 as never, 5)
      expect(mgr.getPrimary('s1')).toBe(ws1)
    })
  })

  describe('broadcast', () => {
    it('sends data to all subscribers', () => {
      const ws1 = mockWs()
      const ws2 = mockWs()
      mgr.addSubscriber('s1', ws1 as never, 5)
      mgr.addSubscriber('s1', ws2 as never, 5)
      mgr.broadcast('s1', 'hello')
      expect(ws1.send).toHaveBeenCalledWith('hello')
      expect(ws2.send).toHaveBeenCalledWith('hello')
    })

    it('does nothing for unknown session', () => {
      expect(() => mgr.broadcast('unknown', 'data')).not.toThrow()
    })

    it('skips subscribers where readyState is not OPEN', () => {
      const ws = mockWs()
      ws.readyState = 3
      mgr.addSubscriber('s1', ws as never, 5)
      mgr.broadcast('s1', 'data')
      expect(ws.send).not.toHaveBeenCalled()
    })
  })

  describe('removeSubscriber', () => {
    it('removes the subscriber from the set', () => {
      const ws = mockWs()
      mgr.addSubscriber('s1', ws as never, 5)
      mgr.removeSubscriber('s1', ws as never)
      expect(mgr.isPrimary('s1', ws as never)).toBe(false)
    })

    it('clears primary when primary subscriber is removed', () => {
      const ws1 = mockWs()
      const ws2 = mockWs()
      mgr.addSubscriber('s1', ws1 as never, 5)
      mgr.addSubscriber('s1', ws2 as never, 5)
      mgr.removeSubscriber('s1', ws1 as never)
      expect(mgr.getPrimary('s1')).toBeNull()
    })

    it('non-primary removal does not affect primary', () => {
      const ws1 = mockWs()
      const ws2 = mockWs()
      mgr.addSubscriber('s1', ws1 as never, 5)
      mgr.addSubscriber('s1', ws2 as never, 5)
      mgr.removeSubscriber('s1', ws2 as never)
      expect(mgr.getPrimary('s1')).toBe(ws1)
    })
  })

  describe('destroySession', () => {
    it('closes all subscribers and removes the session', () => {
      const ws1 = mockWs()
      const ws2 = mockWs()
      mgr.addSubscriber('s1', ws1 as never, 5)
      mgr.addSubscriber('s1', ws2 as never, 5)
      mgr.destroySession('s1')
      expect(ws1.close).toHaveBeenCalledWith(1000, 'session destroyed')
      expect(ws2.close).toHaveBeenCalledWith(1000, 'session destroyed')
      expect(mgr.getPrimary('s1')).toBeNull()
    })

    it('does nothing for unknown session', () => {
      expect(() => mgr.destroySession('unknown')).not.toThrow()
    })
  })

  describe('getCount', () => {
    it('returns 0 for unknown session', () => {
      expect(mgr.getCount('unknown')).toBe(0)
    })

    it('returns the number of active subscribers', () => {
      mgr.addSubscriber('s1', mockWs() as never, 5)
      mgr.addSubscriber('s1', mockWs() as never, 5)
      expect(mgr.getCount('s1')).toBe(2)
    })
  })

  describe('destroyAll', () => {
    it('closes all subscribers across all sessions', () => {
      const ws1 = mockWs()
      const ws2 = mockWs()
      const ws3 = mockWs()
      mgr.addSubscriber('s1', ws1 as never, 5)
      mgr.addSubscriber('s2', ws2 as never, 5)
      mgr.addSubscriber('s2', ws3 as never, 5)
      mgr.destroyAll()
      expect(ws1.close).toHaveBeenCalled()
      expect(ws2.close).toHaveBeenCalled()
      expect(ws3.close).toHaveBeenCalled()
    })
  })
})
