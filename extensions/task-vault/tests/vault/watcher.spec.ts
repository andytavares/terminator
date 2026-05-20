import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockWatcher } = vi.hoisted(() => {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  const watcher = {
    _handlers: handlers,
    on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event)!.push(handler)
      return watcher
    }),
    close: vi.fn().mockResolvedValue(undefined),
    emit(event: string, ...args: unknown[]) {
      const hs = handlers.get(event) ?? []
      hs.forEach((h) => h(...args))
      return true
    },
  }
  return { mockWatcher: watcher }
})

vi.mock('chokidar', () => ({
  default: { watch: vi.fn().mockReturnValue(mockWatcher) },
  watch: vi.fn().mockReturnValue(mockWatcher),
}))

const mockBuildIndex = vi.fn().mockResolvedValue({ tasks: [], projects: [], inboxCount: 0 })
vi.mock('../../src/vault/indexer', () => ({
  buildIndex: (...args: unknown[]) => mockBuildIndex(...args),
}))

import { startWatcher, stopWatcher } from '../../src/vault/watcher'

const VAULT = '/vault'

beforeEach(() => {
  vi.clearAllMocks()
  mockWatcher._handlers.clear()
  mockBuildIndex.mockResolvedValue({ tasks: [], projects: [], inboxCount: 0 })
  vi.mocked(mockWatcher.on).mockImplementation(
    (event: string, handler: (...args: unknown[]) => void) => {
      if (!mockWatcher._handlers.has(event)) mockWatcher._handlers.set(event, [])
      mockWatcher._handlers.get(event)!.push(handler)
      return mockWatcher
    }
  )
})

afterEach(async () => {
  await stopWatcher()
})

describe('startWatcher', () => {
  it('starts watching the vault path', async () => {
    const chokidar = await import('chokidar')
    await startWatcher(VAULT, vi.fn())
    expect(chokidar.default.watch).toHaveBeenCalledWith(
      expect.stringContaining(VAULT),
      expect.objectContaining({ ignored: expect.anything() })
    )
  })

  it('calls onIndexUpdated callback when a file changes', async () => {
    vi.useFakeTimers()
    const onUpdated = vi.fn()
    await startWatcher(VAULT, onUpdated)

    mockWatcher.emit('change', `${VAULT}/daily/2026-05-19.md`)
    await vi.runAllTimersAsync()

    expect(mockBuildIndex).toHaveBeenCalled()
    expect(onUpdated).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('calls onIndexUpdated when a new file is added', async () => {
    vi.useFakeTimers()
    const onUpdated = vi.fn()
    await startWatcher(VAULT, onUpdated)

    mockWatcher.emit('add', `${VAULT}/daily/2026-05-20.md`)
    await vi.runAllTimersAsync()

    expect(onUpdated).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('debounces rapid file changes', async () => {
    vi.useFakeTimers()
    const onUpdated = vi.fn()
    await startWatcher(VAULT, onUpdated)

    for (let i = 0; i < 5; i++) {
      mockWatcher.emit('change', `${VAULT}/daily/2026-05-19.md`)
    }
    await vi.runAllTimersAsync()

    expect(onUpdated.mock.calls.length).toBeLessThan(5)
    vi.useRealTimers()
  })
})

describe('stopWatcher', () => {
  it('closes the chokidar watcher', async () => {
    await startWatcher(VAULT, vi.fn())
    await stopWatcher()
    expect(mockWatcher.close).toHaveBeenCalled()
  })
})
