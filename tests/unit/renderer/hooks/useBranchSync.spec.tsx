import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useBranchSync, type BranchSyncTarget } from '../../../../src/renderer/hooks/useBranchSync'
import { seedStore } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'

const mockUpdateProjectBranch = vi.fn()
const mockCurrentBranch = vi.fn<ElectronAPI['git']['currentBranch']>()

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
  installElectronApi({ git: { currentBranch: mockCurrentBranch } })
  seedStore(useWorkspaceStore, {
    updateProjectBranch: mockUpdateProjectBranch,
  })
  mockCurrentBranch.mockResolvedValue({ branch: 'main' })
  mockUpdateProjectBranch.mockResolvedValue({})
})

afterEach(() => {
  vi.useRealTimers()
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
})

describe('useBranchSync — the name on the card is the branch in the tree — moves every card that shares the folder, without one telling the other', () => {
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
})

describe('useBranchSync — the name on the card is the branch in the tree — does not ask while the window is hidden', () => {
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
})

describe('useBranchSync — the name on the card is the branch in the tree — ignores a folder that is not a repository', () => {
  it('ignores a folder that is not a repository', async () => {
    mockCurrentBranch.mockRejectedValue(new Error('not a git repo'))
    renderHook(() => useBranchSync([target()]))
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
