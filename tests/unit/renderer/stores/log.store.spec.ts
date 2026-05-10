import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useLogStore, installLogInterceptor } from '../../../../src/renderer/stores/log.store'

function resetStore() {
  useLogStore.setState({ entries: [] })
}

describe('useLogStore', () => {
  beforeEach(() => {
    resetStore()
  })

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
      expect(typeof entries[0].timestamp).toBe('string')
      expect(entries[0].timestamp.length).toBeGreaterThan(0)
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

  describe('clear', () => {
    it('removes all entries', () => {
      useLogStore.getState().addEntry('log', 'a')
      useLogStore.getState().addEntry('warn', 'b')
      useLogStore.getState().clear()
      expect(useLogStore.getState().entries).toHaveLength(0)
    })
  })
})

describe('installLogInterceptor', () => {
  const originalLog = console.log
  const originalInfo = console.info
  const originalWarn = console.warn
  const originalError = console.error

  beforeEach(() => {
    resetStore()
  })

  afterEach(() => {
    // Restore original console methods after each test
    console.log = originalLog
    console.info = originalInfo
    console.warn = originalWarn
    console.error = originalError
  })

  it('intercepts console.log calls and stores them as log entries', () => {
    installLogInterceptor()
    console.log('intercepted log')
    const { entries } = useLogStore.getState()
    const entry = entries.find((e) => e.message === 'intercepted log')
    expect(entry).toBeDefined()
    expect(entry!.level).toBe('log')
  })

  it('intercepts console.warn and stores as warn level', () => {
    installLogInterceptor()
    console.warn('intercepted warn')
    const { entries } = useLogStore.getState()
    const entry = entries.find((e) => e.message === 'intercepted warn')
    expect(entry!.level).toBe('warn')
  })

  it('intercepts console.error and stores as error level', () => {
    installLogInterceptor()
    console.error('intercepted error')
    const { entries } = useLogStore.getState()
    const entry = entries.find((e) => e.message === 'intercepted error')
    expect(entry!.level).toBe('error')
  })

  it('serializes object arguments to JSON', () => {
    installLogInterceptor()
    console.info({ key: 'value' })
    const { entries } = useLogStore.getState()
    const entry = entries.find((e) => e.message.includes('"key"'))
    expect(entry).toBeDefined()
  })

  it('joins multiple arguments with spaces', () => {
    installLogInterceptor()
    console.log('hello', 'world')
    const { entries } = useLogStore.getState()
    const entry = entries.find((e) => e.message === 'hello world')
    expect(entry).toBeDefined()
  })
})
