import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── fs mock ────────────────────────────────────────────────────────────────
const mockWrite = vi.fn((data: string, cb?: (err: Error | null) => void) => {
  cb?.(null)
  return true
})

const mockStream = {
  write: mockWrite,
  on: vi.fn(),
}

let mockExistsSync = vi.fn(() => false)
let mockStatSyncSize = 0
const mockStatSync = vi.fn(() => ({ size: mockStatSyncSize }))
const mockRenameSync = vi.fn()
const mockCreateWriteStream = vi.fn(() => mockStream)

vi.mock('fs', () => ({
  createWriteStream: (...args: unknown[]) => mockCreateWriteStream(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args),
}))

// ── electron mock ─────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/testlogs'),
    getVersion: vi.fn(() => '0.1.0'),
  },
}))

describe('logger (src/main/logger.ts)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockExistsSync = vi.fn(() => false)
    mockStatSyncSize = 0
  })

  afterEach(() => {
    // restore NODE_ENV
    delete process.env.NODE_ENV
  })

  // ── makeLogger ─────────────────────────────────────────────────────────

  it('makeLogger returns an object with debug/info/warn/error methods', async () => {
    const { makeLogger } = await import('../../src/main/logger')
    const log = makeLogger('test-ns')
    expect(typeof log.debug).toBe('function')
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
  })

  it('debug writes a DEBUG line to the stream', async () => {
    const { makeLogger } = await import('../../src/main/logger')
    const log = makeLogger('myns')
    log.debug('hello debug')
    expect(mockStream.write).toHaveBeenCalledOnce()
    const written = mockStream.write.mock.calls[0][0] as string
    expect(written).toMatch(/DEBUG/)
    expect(written).toMatch(/\[myns\]/)
    expect(written).toMatch(/hello debug/)
  })

  it('info writes an INFO line to the stream', async () => {
    const { makeLogger } = await import('../../src/main/logger')
    const log = makeLogger('myns')
    log.info('hello info')
    const written = mockStream.write.mock.calls[0][0] as string
    expect(written).toMatch(/INFO/)
    expect(written).toMatch(/hello info/)
  })

  it('warn writes a WARN line to the stream', async () => {
    const { makeLogger } = await import('../../src/main/logger')
    const log = makeLogger('myns')
    log.warn('hello warn')
    const written = mockStream.write.mock.calls[0][0] as string
    expect(written).toMatch(/WARN/)
    expect(written).toMatch(/hello warn/)
  })

  it('error writes an ERROR line to the stream', async () => {
    const { makeLogger } = await import('../../src/main/logger')
    const log = makeLogger('myns')
    log.error('hello error')
    const written = mockStream.write.mock.calls[0][0] as string
    expect(written).toMatch(/ERROR/)
    expect(written).toMatch(/hello error/)
  })

  it('formats extra meta arguments as space-separated string', async () => {
    const { makeLogger } = await import('../../src/main/logger')
    const log = makeLogger('meta-ns')
    log.info('prefix', { key: 'val' }, 42)
    const written = mockStream.write.mock.calls[0][0] as string
    expect(written).toMatch(/\{"key":"val"\}/)
    expect(written).toMatch(/42/)
  })

  it('formats non-object meta as String()', async () => {
    const { makeLogger } = await import('../../src/main/logger')
    const log = makeLogger('meta-ns2')
    log.warn('msg', 'extra-string')
    const written = mockStream.write.mock.calls[0][0] as string
    expect(written).toMatch(/extra-string/)
  })

  // ── writeFromRenderer ──────────────────────────────────────────────────

  it('writeFromRenderer writes the correct level to stream', async () => {
    const { writeFromRenderer } = await import('../../src/main/logger')
    writeFromRenderer('error', 'renderer', 'Something broke')
    const written = mockStream.write.mock.calls[0][0] as string
    expect(written).toMatch(/ERROR/)
    expect(written).toMatch(/\[renderer\]/)
    expect(written).toMatch(/Something broke/)
  })

  // ── getLogPath ─────────────────────────────────────────────────────────

  it('getLogPath returns the path to the log file', async () => {
    const { getLogPath } = await import('../../src/main/logger')
    const p = getLogPath()
    expect(p).toContain('terminator.log')
  })

  // ── getStream / rotatIfNeeded ──────────────────────────────────────────

  it('getStream opens a write-stream at the correct path', async () => {
    const { makeLogger } = await import('../../src/main/logger')
    makeLogger('stream-test').info('ping')
    expect(mockCreateWriteStream).toHaveBeenCalledWith(expect.stringContaining('terminator.log'), {
      flags: 'a',
    })
  })

  it('rotates log file when it exceeds 5 MB', async () => {
    mockExistsSync = vi.fn(() => true)
    mockStatSyncSize = 6 * 1024 * 1024 // 6 MB > 5 MB threshold

    const { makeLogger } = await import('../../src/main/logger')
    makeLogger('rotate-test').info('trigger rotation')

    expect(mockRenameSync).toHaveBeenCalledOnce()
    const [from, to] = mockRenameSync.mock.calls[0] as [string, string]
    expect(from).toContain('terminator.log')
    expect(to).toContain('terminator.old.log')
  })

  it('does not rotate when log file does not exist', async () => {
    mockExistsSync = vi.fn(() => false)

    const { makeLogger } = await import('../../src/main/logger')
    makeLogger('no-rotate').info('ping')

    expect(mockRenameSync).not.toHaveBeenCalled()
  })

  it('does not rotate when log file is under 5 MB', async () => {
    mockExistsSync = vi.fn(() => true)
    mockStatSyncSize = 1024 // tiny

    const { makeLogger } = await import('../../src/main/logger')
    makeLogger('small-log').info('ping')

    expect(mockRenameSync).not.toHaveBeenCalled()
  })

  it('swallows statSync errors without crashing', async () => {
    mockExistsSync = vi.fn(() => true)
    mockStatSync.mockImplementationOnce(() => {
      throw new Error('EACCES')
    })

    const { makeLogger } = await import('../../src/main/logger')
    expect(() => makeLogger('stat-err').info('ping')).not.toThrow()
  })

  it('swallows stream.write errors without crashing', async () => {
    mockStream.write.mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    const { makeLogger } = await import('../../src/main/logger')
    expect(() => makeLogger('write-err').info('ping')).not.toThrow()
  })

  // ── dev mode stdout / stderr mirroring ────────────────────────────────

  it('mirrors non-error logs to stdout in development mode', async () => {
    process.env.NODE_ENV = 'development'
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const { makeLogger } = await import('../../src/main/logger')
    makeLogger('dev-ns').info('dev message')

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('dev message'))
    writeSpy.mockRestore()
  })

  it('mirrors error logs to stderr in development mode', async () => {
    process.env.NODE_ENV = 'development'
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const { makeLogger } = await import('../../src/main/logger')
    makeLogger('dev-err').error('dev error')

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('dev error'))
    writeSpy.mockRestore()
  })

  it('does NOT mirror to stdout/stderr outside development mode', async () => {
    process.env.NODE_ENV = 'production'
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const { makeLogger } = await import('../../src/main/logger')
    makeLogger('prod-ns').info('prod message')

    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(stderrSpy).not.toHaveBeenCalled()
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  // ── top-level logger export ────────────────────────────────────────────

  it('top-level logger.debug writes with "main" namespace', async () => {
    const { logger } = await import('../../src/main/logger')
    logger.debug('main debug')
    const written = mockStream.write.mock.calls[0][0] as string
    expect(written).toMatch(/\[main\]/)
    expect(written).toMatch(/main debug/)
  })

  it('top-level logger.info writes with "main" namespace', async () => {
    const { logger } = await import('../../src/main/logger')
    logger.info('main info')
    const written = mockStream.write.mock.calls[0][0] as string
    expect(written).toMatch(/\[main\]/)
  })

  it('top-level logger.warn writes with "main" namespace', async () => {
    const { logger } = await import('../../src/main/logger')
    logger.warn('main warn')
    const written = mockStream.write.mock.calls[0][0] as string
    expect(written).toMatch(/WARN/)
    expect(written).toMatch(/\[main\]/)
  })

  it('top-level logger.error writes with "main" namespace', async () => {
    const { logger } = await import('../../src/main/logger')
    logger.error('main error')
    const written = mockStream.write.mock.calls[0][0] as string
    expect(written).toMatch(/ERROR/)
    expect(written).toMatch(/\[main\]/)
  })
})
