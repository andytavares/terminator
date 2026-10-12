import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { makeRendererLogger, installLogInterceptor } from '../../../src/renderer/logger.js'
import { useLogStore } from '../../../src/renderer/stores/log.store'

/** What the log window would list, as [level, message]. */
const logged = () => useLogStore.getState().entries.map((entry) => [entry.level, entry.message])

beforeEach(() => {
  useLogStore.setState({ entries: [] })
})

const mockLoggerWrite = vi.fn()

function setupWindow() {
  ;(globalThis as unknown as Record<string, unknown>).window = {
    electronAPI: { logger: { write: mockLoggerWrite } },
  }
}

describe('makeRendererLogger()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupWindow()
  })

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).window
  })

  it('ships debug messages to the log store', () => {
    const log = makeRendererLogger('test')
    log.debug('a debug message')
    expect(logged()).toContainEqual(['log', '[test] a debug message'])
  })

  it('ships info messages to the log store', () => {
    const log = makeRendererLogger('test')
    log.info('an info message')
    expect(logged()).toContainEqual(['info', '[test] an info message'])
  })

  it('ships warn messages to the log store', () => {
    const log = makeRendererLogger('test')
    log.warn('a warn message')
    expect(logged()).toContainEqual(['warn', '[test] a warn message'])
  })

  it('ships error messages to the log store', () => {
    const log = makeRendererLogger('test')
    log.error('an error message')
    expect(logged()).toContainEqual(['error', '[test] an error message'])
  })

  it('includes meta arguments in the message', () => {
    const log = makeRendererLogger('ns')
    log.info('status', 200, { detail: 'ok' })
    expect(logged()).toContainEqual(['info', '[ns] status 200 {"detail":"ok"}'])
  })

  it('calls window.electronAPI.logger.write', () => {
    const log = makeRendererLogger('ns')
    log.info('test ipc')
    expect(mockLoggerWrite).toHaveBeenCalledWith('info', 'ns', 'test ipc')
  })

  it('does not throw when window.electronAPI is unavailable', () => {
    delete (globalThis as unknown as Record<string, unknown>).window
    const log = makeRendererLogger('ns')
    expect(() => log.info('no window')).not.toThrow()
    expect(logged()).toContainEqual(['info', '[ns] no window'])
  })
})

describe('installLogInterceptor()', () => {
  let originalLog: typeof console.log
  let originalInfo: typeof console.info
  let originalWarn: typeof console.warn
  let originalError: typeof console.error

  beforeEach(() => {
    vi.clearAllMocks()
    setupWindow()
    originalLog = console.log
    originalInfo = console.info
    originalWarn = console.warn
    originalError = console.error
  })

  afterEach(() => {
    console.log = originalLog
    console.info = originalInfo
    console.warn = originalWarn
    console.error = originalError
    delete (globalThis as unknown as Record<string, unknown>).window
  })

  it('wraps console.log to ship to the log store', () => {
    installLogInterceptor()
    console.log('intercepted log')
    expect(logged()).toContainEqual(['log', '[renderer] intercepted log'])
  })

  it('wraps console.info to ship to the log store', () => {
    installLogInterceptor()
    console.info('intercepted info')
    expect(logged()).toContainEqual(['info', '[renderer] intercepted info'])
  })

  it('wraps console.warn to ship to the log store', () => {
    installLogInterceptor()
    console.warn('intercepted warn')
    expect(logged()).toContainEqual(['warn', '[renderer] intercepted warn'])
  })

  it('wraps console.error to ship to the log store', () => {
    installLogInterceptor()
    console.error('intercepted error')
    expect(logged()).toContainEqual(['error', '[renderer] intercepted error'])
  })

  it('serialises object arguments', () => {
    installLogInterceptor()
    console.log({ key: 'val' })
    expect(logged()).toContainEqual(['log', '[renderer] {"key":"val"}'])
  })
})
