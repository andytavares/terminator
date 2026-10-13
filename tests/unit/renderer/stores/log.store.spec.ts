import { describe, it, expect, beforeEach } from 'vitest'
import { useLogStore } from '../../../../src/renderer/stores/log.store'

function resetStore() {
  useLogStore.setState({ entries: [] })
}

beforeEach(() => {
  resetStore()
})

describe('useLogStore', () => {
  describe('addEntry', () => {
    it('adds an entry with sequential id, level, and message', () => {
      useLogStore.getState().addEntry('info', 'test message')
      const { entries } = useLogStore.getState()
      expect(entries).toHaveLength(1)
      expect(entries[0].level).toBe('info')
      expect(entries[0].message).toBe('test message')
      expect(typeof entries[0].id).toBe('number')
    })

    it('assigns incrementing ids across multiple entries', () => {
      useLogStore.getState().addEntry('log', 'first')
      useLogStore.getState().addEntry('warn', 'second')
      const { entries } = useLogStore.getState()
      expect(entries[1].id).toBeGreaterThan(entries[0].id)
    })

    it('includes a timestamp string', () => {
      useLogStore.getState().addEntry('error', 'oops')
      const { entries } = useLogStore.getState()
      // A 24-hour wall-clock time, as the log window prints it.
      expect(entries[0].timestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    })

    it('caps log at 1000 entries, dropping oldest', () => {
      for (let i = 0; i < 1005; i++) {
        useLogStore.getState().addEntry('log', `msg ${i}`)
      }
      const { entries } = useLogStore.getState()
      expect(entries).toHaveLength(1000)
      // The oldest entries should be gone
      expect(entries[0].message).toBe('msg 5')
    })
  })
})

describe('useLogStore — clear', () => {
  describe('clear', () => {
    it('removes all entries', () => {
      useLogStore.getState().addEntry('log', 'a')
      useLogStore.getState().addEntry('warn', 'b')
      useLogStore.getState().clear()
      expect(useLogStore.getState().entries).toHaveLength(0)
    })
  })
})
