import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FsWatcherService } from '../../../src/main/fs/fs-watcher'

// Mock fs.watch to control behavior in tests
vi.mock('fs', () => {
  let errorCb: ((err: Error) => void) | undefined
  const mockWatcher = {
    on: vi.fn((event: string, cb: (err: Error) => void) => {
      if (event === 'error') errorCb = cb
      return mockWatcher
    }),
    close: vi.fn(),
    _triggerError: (err: Error) => errorCb?.(err),
  }
  return {
    watch: vi.fn(() => mockWatcher),
    _mockWatcher: mockWatcher,
  }
})

import * as fs from 'fs'

describe('FsWatcherService', () => {
  let service: FsWatcherService

  beforeEach(() => {
    vi.useFakeTimers()
    service = new FsWatcherService(1000)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('attaches fs.watch on watchStart', () => {
    service.watchStart('/tmp/repo')
    expect(fs.watch).toHaveBeenCalledWith('/tmp/repo', { recursive: true }, expect.any(Function))
  })

  it('does not re-attach if already watching same root', () => {
    service.watchStart('/tmp/repo')
    service.watchStart('/tmp/repo')
    expect(fs.watch).toHaveBeenCalledTimes(1)
  })

  it('delivers change events to registered handlers', () => {
    const handler = vi.fn()
    service.addHandler(handler)
    service.watchStart('/tmp/repo')

    // Simulate a change event from fs.watch
    const watchCb = (fs.watch as ReturnType<typeof vi.fn>).mock.calls[0][2]
    watchCb('change', 'src/main.ts')

    expect(handler).toHaveBeenCalledWith({
      projectRoot: '/tmp/repo',
      eventType: 'change',
      filename: 'src/main.ts',
    })
  })

  it('falls back to polling when fs.watch throws', () => {
    vi.mocked(fs.watch).mockImplementationOnce(() => {
      throw new Error('ENOSYS')
    })

    const handler = vi.fn()
    service.addHandler(handler)
    service.watchStart('/tmp/repo')

    // No fs.watch events — polling fires after intervalMs
    vi.advanceTimersByTime(1000)

    expect(handler).toHaveBeenCalledWith({
      projectRoot: '/tmp/repo',
      eventType: 'change',
      filename: null,
    })
  })

  it('stops watcher on watchStop', () => {
    service.watchStart('/tmp/repo')
    const mockClose = (fs.watch as ReturnType<typeof vi.fn>).mock.results[0].value.close
    service.watchStop()
    expect(mockClose).toHaveBeenCalled()
  })

  it('stops watching when last handler is removed', () => {
    const handler = vi.fn()
    service.addHandler(handler)
    service.watchStart('/tmp/repo')
    const mockClose = (fs.watch as ReturnType<typeof vi.fn>).mock.results[0].value.close

    service.removeHandler(handler)
    expect(mockClose).toHaveBeenCalled()
  })
})
