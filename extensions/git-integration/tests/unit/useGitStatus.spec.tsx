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

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  ;(globalThis as any).electronAPI = {
    git: { status: mockGitStatus },
    fs: { onChanged: mockOnChanged },
  }
  vi.mocked(useGitStore).mockReturnValue({
    setStatus: mockSetStatus,
    setLoading: mockSetLoading,
  } as any)
  mockGitStatus.mockResolvedValue({ branch: 'main', staged: [], unstaged: [], untracked: [] })
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as any).electronAPI
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
    expect(mockGitStatus).toHaveBeenCalledWith('/repo')
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
