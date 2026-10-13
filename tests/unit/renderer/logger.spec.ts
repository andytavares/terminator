import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { makeRendererLogger, installLogInterceptor } from '../../../src/renderer/logger.js'
import { useLogStore } from '../../../src/renderer/stores/log.store'
import type { ElectronAPI } from '../../../src/shared/electron-api/api-type'
import { electronApiOf } from '../../support/electron-api'

/** What the log window would list, as [level, message]. */
const logged = () => useLogStore.getState().entries.map((entry) => [entry.level, entry.message])

beforeEach(() => {
  useLogStore.setState({ entries: [] })
})

const mockLoggerWrite = vi.fn<ElectronAPI['logger']['write']>()

function setupWindow() {
  vi.stubGlobal('window', { electronAPI: electronApiOf({ logger: { write: mockLoggerWrite } }) })
}

/** The hooks every "makeRendererLogger()" describe registers. */
function setUpMakeRendererLogger(): void {
  beforeEach(() => {
    vi.clearAllMocks()
    setupWindow()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })
}

describe('makeRendererLogger()', () => {
  setUpMakeRendererLogger()

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
})

describe('makeRendererLogger() — calls window.electronAPI.logger.write', () => {
  setUpMakeRendererLogger()

  it('calls window.electronAPI.logger.write', () => {
    const log = makeRendererLogger('ns')
    log.info('test ipc')
    expect(mockLoggerWrite).toHaveBeenCalledWith('info', 'ns', 'test ipc')
  })

  it('does not throw when window.electronAPI is unavailable', () => {
    vi.stubGlobal('window', undefined)
    const log = makeRendererLogger('ns')
    expect(() => log.info('no window')).not.toThrow()
    expect(logged()).toContainEqual(['info', '[ns] no window'])
  })
})

let originalLog: typeof console.log

let originalInfo: typeof console.info

let originalWarn: typeof console.warn

let originalError: typeof console.error

/** The hooks every "installLogInterceptor()" describe registers. */
function setUpInstallLogInterceptor(): void {
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
    vi.unstubAllGlobals()
  })
}

describe('installLogInterceptor()', () => {
  setUpInstallLogInterceptor()

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

  it('joins several arguments with spaces', () => {
    installLogInterceptor()
    console.log('hello', 'world')
    expect(logged()).toContainEqual(['log', '[renderer] hello world'])
  })
})

describe('installLogInterceptor() — serialises object arguments', () => {
  setUpInstallLogInterceptor()

  it('serialises object arguments', () => {
    installLogInterceptor()
    console.log({ key: 'val' })
    expect(logged()).toContainEqual(['log', '[renderer] {"key":"val"}'])
  })
})
