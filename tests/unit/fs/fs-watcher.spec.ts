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

  it('does NOT stop when a handler is removed but others remain', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    service.addHandler(h1)
    service.addHandler(h2)
    service.watchStart('/tmp/repo')
    const mockClose = (fs.watch as ReturnType<typeof vi.fn>).mock.results[0].value.close

    service.removeHandler(h1) // h2 still registered → should not stop
    expect(mockClose).not.toHaveBeenCalled()
  })

  it('falls back to polling when watcher emits an error event', () => {
    // Reset so the first watchStart succeeds and we can trigger the error event
    const handler = vi.fn()
    service.addHandler(handler)
    service.watchStart('/tmp/repo')

    // Trigger the 'error' event on the watcher
    const mockWatcherInst = (fs.watch as ReturnType<typeof vi.fn>).mock.results[0].value
    mockWatcherInst._triggerError(new Error('ENOENT'))

    // Advance time so the poll fires
    vi.advanceTimersByTime(1000)

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'change', filename: null })
    )
  })

  it('maps rename eventType correctly', () => {
    const handler = vi.fn()
    service.addHandler(handler)
    service.watchStart('/tmp/repo')

    const watchCb = (fs.watch as ReturnType<typeof vi.fn>).mock.calls[0][2]
    watchCb('rename', 'oldfile.ts')

    expect(handler).toHaveBeenCalledWith({
      projectRoot: '/tmp/repo',
      eventType: 'rename',
      filename: 'oldfile.ts',
    })
  })

  it('handles null filename from fs.watch', () => {
    const handler = vi.fn()
    service.addHandler(handler)
    service.watchStart('/tmp/repo')

    const watchCb = (fs.watch as ReturnType<typeof vi.fn>).mock.calls[0][2]
    watchCb('change', null)

    expect(handler).toHaveBeenCalledWith({
      projectRoot: '/tmp/repo',
      eventType: 'change',
      filename: null,
    })
  })

  it('watchStop clears pollInterval when running in polling mode', () => {
    vi.mocked(fs.watch).mockImplementationOnce(() => {
      throw new Error('ENOSYS')
    })

    service.watchStart('/tmp/repo')
    // poll interval is now active
    service.watchStop() // should clear it without error

    // After stop, no more poll events
    const handler = vi.fn()
    service.addHandler(handler)
    vi.advanceTimersByTime(2000)
    expect(handler).not.toHaveBeenCalled()
  })

  it('swallows errors thrown by handlers without stopping delivery', () => {
    const badHandler = vi.fn(() => {
      throw new Error('handler boom')
    })
    const goodHandler = vi.fn()
    service.addHandler(badHandler)
    service.addHandler(goodHandler)
    service.watchStart('/tmp/repo')

    const watchCb = (fs.watch as ReturnType<typeof vi.fn>).mock.calls[0][2]
    watchCb('change', 'x.ts')

    expect(goodHandler).toHaveBeenCalled()
  })

  it('switches root correctly when watchStart is called with a new path', () => {
    service.watchStart('/tmp/repo-a')
    const closeA = (fs.watch as ReturnType<typeof vi.fn>).mock.results[0].value.close

    service.watchStart('/tmp/repo-b')
    // old watcher should have been closed
    expect(closeA).toHaveBeenCalled()
    // new watcher opened for repo-b
    expect(fs.watch).toHaveBeenLastCalledWith(
      '/tmp/repo-b',
      { recursive: true },
      expect.any(Function)
    )
  })
})
