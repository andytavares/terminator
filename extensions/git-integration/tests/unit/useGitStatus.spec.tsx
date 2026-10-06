import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGitStore } from '../../src/stores/git.store'
import { useGitStatus } from '../../src/hooks/useGitStatus'

vi.mock('../../src/stores/git.store', () => ({
  useGitStore: vi.fn(),
}))

const mockSetStatus = vi.fn()
const mockSetLoading = vi.fn()
const mockUnsubFs = vi.fn()
const mockGitStatus = vi.fn()
const mockOnChanged = vi.fn().mockReturnValue(mockUnsubFs)
const mockInvoke = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mockGitStatus.mockResolvedValue({ branch: 'main', staged: [], unstaged: [], untracked: [] })
  mockInvoke.mockImplementation((channel: string, payload: unknown) => {
    if (channel === 'git:status') return mockGitStatus(payload)
    return Promise.resolve({})
  })
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke: mockInvoke },
    fs: { onChanged: mockOnChanged },
  }
  const state = { setStatus: mockSetStatus, setLoading: mockSetLoading }
  vi.mocked(useGitStore).mockImplementation(((sel?: (s: unknown) => unknown) =>
    sel ? sel(state) : state) as unknown as typeof useGitStore)
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('useGitStatus', () => {
  it('sets status to null when repoRoot is null', () => {
    renderHook(() => useGitStatus(null))
    expect(mockSetStatus).toHaveBeenCalledWith(null)
  })

  it('calls setLoading(true) when repoRoot is provided', () => {
    renderHook(() => useGitStatus('/repo'))
    expect(mockSetLoading).toHaveBeenCalledWith(true)
  })

  it('calls git.status with the repoRoot', async () => {
    renderHook(() => useGitStatus('/repo'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockGitStatus).toHaveBeenCalledWith({ path: '/repo', maxFiles: undefined })
  })

  it('sets status from successful response', async () => {
    const status = { branch: 'main', staged: [], unstaged: [], untracked: [] }
    mockGitStatus.mockResolvedValue(status)
    renderHook(() => useGitStatus('/repo'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockSetStatus).toHaveBeenCalledWith(status)
  })

  it('sets status to null on error response', async () => {
    mockGitStatus.mockResolvedValue({ error: 'Not a git repo' })
    renderHook(() => useGitStatus('/repo'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockSetStatus).toHaveBeenCalledWith(null)
  })

  it('sets status to null on exception', async () => {
    mockGitStatus.mockRejectedValue(new Error('network error'))
    renderHook(() => useGitStatus('/repo'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockSetStatus).toHaveBeenCalledWith(null)
  })

  it('subscribes to fs.onChanged', () => {
    renderHook(() => useGitStatus('/repo'))
    expect(mockOnChanged).toHaveBeenCalled()
  })

  it('unsubscribes from fs.onChanged on unmount', async () => {
    const { unmount } = renderHook(() => useGitStatus('/repo'))
    await act(async () => {
      await Promise.resolve()
    })
    unmount()
    expect(mockUnsubFs).toHaveBeenCalled()
  })

  describe('polling', () => {
    const setVisibility = (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    }
    afterEach(() => setVisibility('visible'))

    it('polls on the interval while visible', async () => {
      renderHook(() => useGitStatus('/repo', 3000))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(mockGitStatus).toHaveBeenCalledTimes(2)
    })

    it('skips poll ticks while the document is hidden', async () => {
      renderHook(() => useGitStatus('/repo', 3000))
      await act(async () => {
        await Promise.resolve()
      })
      mockGitStatus.mockClear()
      setVisibility('hidden')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000)
      })
      expect(mockGitStatus).not.toHaveBeenCalled()
    })

    it('refreshes once when the document becomes visible again', async () => {
      renderHook(() => useGitStatus('/repo', 3000))
      await act(async () => {
        await Promise.resolve()
      })
      mockGitStatus.mockClear()
      setVisibility('visible')
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        await Promise.resolve()
      })
      expect(mockGitStatus).toHaveBeenCalledTimes(1)
    })

    it('does not start a second refresh while one is in flight', async () => {
      let resolve!: (v: unknown) => void
      mockGitStatus.mockReturnValue(new Promise((r) => (resolve = r)))
      renderHook(() => useGitStatus('/repo', 3000))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000)
      })
      expect(mockGitStatus).toHaveBeenCalledTimes(1)
      resolve({ branch: 'main', files: [] })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(mockGitStatus).toHaveBeenCalledTimes(2)
    })
  })

  it('drops a status that lands after the view unmounted', async () => {
    let resolve!: (v: unknown) => void
    mockGitStatus.mockReturnValue(new Promise((r) => (resolve = r)))
    const { unmount } = renderHook(() => useGitStatus('/repo'))
    unmount()
    await act(async () => {
      resolve({ branch: 'main', staged: [], unstaged: [], untracked: [] })
      await Promise.resolve()
    })
    expect(mockSetStatus).not.toHaveBeenCalled()
    expect(mockSetLoading).not.toHaveBeenCalledWith(false)
  })

  it('drops a failure that lands after the view unmounted', async () => {
    let reject!: (e: unknown) => void
    mockGitStatus.mockReturnValue(new Promise((_, r) => (reject = r)))
    const { unmount } = renderHook(() => useGitStatus('/repo'))
    unmount()
    await act(async () => {
      reject(new Error('gone'))
      await Promise.resolve()
    })
    expect(mockSetStatus).not.toHaveBeenCalled()
  })

  it('does not refresh when the view becomes hidden', async () => {
    renderHook(() => useGitStatus('/repo'))
    await act(async () => {
      await Promise.resolve()
    })
    const calls = mockGitStatus.mock.calls.length
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(mockGitStatus.mock.calls.length).toBe(calls)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })
})
