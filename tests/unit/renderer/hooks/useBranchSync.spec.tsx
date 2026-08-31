import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useBranchSync, type BranchSyncTarget } from '../../../../src/renderer/hooks/useBranchSync'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))

const mockUpdateProjectBranch = vi.fn()
const mockCurrentBranch = vi.fn()

const target = (over: Partial<BranchSyncTarget> = {}): BranchSyncTarget => ({
  id: 'proj-1',
  cwd: '/workspace',
  gitBranch: 'main',
  ...over,
})

/** The effect chains awaits per target; let them all settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    git: { currentBranch: mockCurrentBranch },
  }
  vi.mocked(useWorkspaceStore).mockReturnValue({
    updateProjectBranch: mockUpdateProjectBranch,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  mockCurrentBranch.mockResolvedValue({ branch: 'main' })
  mockUpdateProjectBranch.mockResolvedValue({})
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('useBranchSync — the name on the card is the branch in the tree', () => {
  it('reads HEAD from each tracked working tree', async () => {
    renderHook(() => useBranchSync([target(), target({ id: 'proj-2', cwd: '/other' })]))
    await settle()
    expect(mockCurrentBranch).toHaveBeenCalledWith('/workspace')
    expect(mockCurrentBranch).toHaveBeenCalledWith('/other')
  })

  it('does nothing at all when there is nothing to track', () => {
    renderHook(() => useBranchSync([]))
    expect(mockCurrentBranch).not.toHaveBeenCalled()
  })

  it('leaves a card alone when it already names the branch it is on', async () => {
    mockCurrentBranch.mockResolvedValue({ branch: 'main' })
    renderHook(() => useBranchSync([target({ gitBranch: 'main' })]))
    await settle()
    expect(mockUpdateProjectBranch).not.toHaveBeenCalled()
  })

  it('renames a card whose tree has moved to another branch', async () => {
    mockCurrentBranch.mockResolvedValue({ branch: 'feature/new' })
    renderHook(() => useBranchSync([target({ gitBranch: 'main' })]))
    await settle()
    expect(mockUpdateProjectBranch).toHaveBeenCalledWith('proj-1', 'feature/new')
  })

  it('moves every card that shares the folder, without one telling the other', async () => {
    // Two plain cards on one repo: each is checked against its own tree, so
    // both land on the branch that tree is on.
    mockCurrentBranch.mockResolvedValue({ branch: 'feature/new' })
    renderHook(() =>
      useBranchSync([target(), target({ id: 'proj-2', cwd: '/workspace', gitBranch: 'main' })])
    )
    await settle()
    expect(mockUpdateProjectBranch).toHaveBeenCalledWith('proj-1', 'feature/new')
    expect(mockUpdateProjectBranch).toHaveBeenCalledWith('proj-2', 'feature/new')
  })

  it('keeps asking, because a checkout in the terminal announces nothing', async () => {
    renderHook(() => useBranchSync([target()]))
    await settle()
    mockCurrentBranch.mockClear()
    mockCurrentBranch.mockResolvedValue({ branch: 'develop' })
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    await settle()
    expect(mockCurrentBranch).toHaveBeenCalledWith('/workspace')
    expect(mockUpdateProjectBranch).toHaveBeenCalledWith('proj-1', 'develop')
  })

  it('does not ask while the window is hidden', async () => {
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    renderHook(() => useBranchSync([target()]))
    await settle()
    expect(mockCurrentBranch).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('stops asking on unmount', async () => {
    const { unmount } = renderHook(() => useBranchSync([target()]))
    await settle()
    unmount()
    mockCurrentBranch.mockClear()
    await act(async () => {
      vi.advanceTimersByTime(15000)
    })
    expect(mockCurrentBranch).not.toHaveBeenCalled()
  })

  it('does not resync when the targets are rebuilt with the same contents', async () => {
    const { rerender } = renderHook(() => useBranchSync([target()]))
    await settle()
    const callsAfterMount = mockCurrentBranch.mock.calls.length
    rerender()
    await settle()
    expect(mockCurrentBranch.mock.calls.length).toBe(callsAfterMount)
  })

  it('ignores a folder that is not a repository', async () => {
    mockCurrentBranch.mockRejectedValue(new Error('not a git repo'))
    expect(() => renderHook(() => useBranchSync([target()]))).not.toThrow()
    await settle()
    expect(mockUpdateProjectBranch).not.toHaveBeenCalled()
  })

  it('ignores an error response from currentBranch', async () => {
    mockCurrentBranch.mockResolvedValue({ error: 'INVALID_PATH' })
    renderHook(() => useBranchSync([target()]))
    await settle()
    expect(mockUpdateProjectBranch).not.toHaveBeenCalled()
  })
})
