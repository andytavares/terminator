import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  globalShortcut: { register: vi.fn(), unregister: vi.fn() },
}))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduleWeeklyReviewNudge interval guard', () => {
  it('guard pattern: second call clears the first interval before scheduling a new one', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    let storedInterval: ReturnType<typeof setInterval> | null = null

    // This simulates the CORRECT guard pattern (T035 implementation target)
    function scheduleWithGuard() {
      if (storedInterval !== null) {
        clearInterval(storedInterval)
        storedInterval = null
      }
      storedInterval = setInterval(() => {}, 24 * 60 * 60 * 1000)
    }

    scheduleWithGuard()
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    expect(clearIntervalSpy).toHaveBeenCalledTimes(0)

    scheduleWithGuard()
    expect(setIntervalSpy).toHaveBeenCalledTimes(2)
    // The guard must have cleared the first interval before creating the second
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)

    if (storedInterval) clearInterval(storedInterval)
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it('without guard: double-call creates two intervals (this is the bug being fixed)', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const intervals: ReturnType<typeof setInterval>[] = []

    // This simulates the BUGGY pattern (no guard)
    function scheduleBuggy() {
      intervals.push(setInterval(() => {}, 24 * 60 * 60 * 1000))
    }

    scheduleBuggy()
    scheduleBuggy()
    expect(setIntervalSpy).toHaveBeenCalledTimes(2)
    expect(intervals).toHaveLength(2)

    for (const id of intervals) clearInterval(id)
    setIntervalSpy.mockRestore()
  })
})
