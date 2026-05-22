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
  vi.mocked(useGitStore).mockReturnValue({
    setStatus: mockSetStatus,
    setLoading: mockSetLoading,
  } as unknown as ReturnType<typeof useGitStore>)
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
})
