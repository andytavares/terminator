import { describe, it, expect, beforeEach } from 'vitest'
import { useLogStore } from '../../../../src/stores/log.store'

function resetStore() {
  useLogStore.setState({ entries: [] })
}

beforeEach(() => {
  resetStore()
})

describe('useLogStore — addEntry', () => {
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
})

describe('useLogStore — addEntry at the cap', () => {
  it('caps log at 1000 entries, dropping oldest', () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      level: 'log' as const,
      message: `msg ${i}`,
      timestamp: '00:00:00',
    }))
    useLogStore.setState({ entries: full })
    useLogStore.getState().addEntry('log', 'msg 1000')
    const { entries } = useLogStore.getState()
    expect(entries).toHaveLength(1000)
    expect(entries[0].message).toBe('msg 1')
    expect(entries[999].message).toBe('msg 1000')
  })
})

describe('useLogStore — clear', () => {
  it('removes all entries', () => {
    useLogStore.getState().addEntry('log', 'a')
    useLogStore.getState().addEntry('warn', 'b')
    useLogStore.getState().clear()
    expect(useLogStore.getState().entries).toHaveLength(0)
  })
})
