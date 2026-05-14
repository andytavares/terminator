import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useBranchSync } from '../../../../src/renderer/hooks/useBranchSync'
import type { Project } from '../../../../src/shared/types/index'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))

const mockUpdateProjectBranch = vi.fn()
const mockCurrentBranch = vi.fn()
const mockUnsubFs = vi.fn()
const mockOnChanged = vi.fn().mockReturnValue(mockUnsubFs)

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    workspaceId: 'ws-1',
    name: 'My Project',
    gitBranch: 'main',
    isWorktree: false,
    worktreePath: undefined,
    ...overrides,
  } as Project
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    git: { currentBranch: mockCurrentBranch },
    fs: { onChanged: mockOnChanged },
  }
  vi.mocked(useWorkspaceStore).mockReturnValue({
    updateProjectBranch: mockUpdateProjectBranch,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  mockCurrentBranch.mockResolvedValue({ branch: 'main' })
  mockUpdateProjectBranch.mockResolvedValue({ project: makeProject() })
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('useBranchSync', () => {
  it('does nothing for worktree projects', async () => {
    const project = makeProject({ isWorktree: true, gitBranch: 'feature/x' })
    renderHook(() => useBranchSync(project, '/repo'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockCurrentBranch).not.toHaveBeenCalled()
    expect(mockUpdateProjectBranch).not.toHaveBeenCalled()
  })

  it('calls currentBranch with the provided cwd', async () => {
    const project = makeProject()
    renderHook(() => useBranchSync(project, '/workspace'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockCurrentBranch).toHaveBeenCalledWith('/workspace')
  })

  it('does not update when branch matches project.gitBranch', async () => {
    mockCurrentBranch.mockResolvedValue({ branch: 'main' })
    renderHook(() => useBranchSync(makeProject({ gitBranch: 'main' }), '/workspace'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockUpdateProjectBranch).not.toHaveBeenCalled()
  })

  it('calls updateProjectBranch when branch differs', async () => {
    mockCurrentBranch.mockResolvedValue({ branch: 'feature/new' })
    renderHook(() => useBranchSync(makeProject({ gitBranch: 'main' }), '/workspace'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockUpdateProjectBranch).toHaveBeenCalledWith('proj-1', 'feature/new')
  })

  it('subscribes to fs.onChanged', () => {
    renderHook(() => useBranchSync(makeProject(), '/workspace'))
    expect(mockOnChanged).toHaveBeenCalled()
  })

  it('calls currentBranch again when fs changes', async () => {
    let fsCallback: (() => void) | null = null
    mockOnChanged.mockImplementation((cb: () => void) => {
      fsCallback = cb
      return mockUnsubFs
    })
    renderHook(() => useBranchSync(makeProject(), '/workspace'))
    await act(async () => {
      await Promise.resolve()
    })
    mockCurrentBranch.mockClear()
    mockCurrentBranch.mockResolvedValue({ branch: 'develop' })
    await act(async () => {
      fsCallback?.()
      await Promise.resolve()
    })
    expect(mockCurrentBranch).toHaveBeenCalledWith('/workspace')
  })

  it('unsubscribes fs listener on unmount', () => {
    const { unmount } = renderHook(() => useBranchSync(makeProject(), '/workspace'))
    unmount()
    expect(mockUnsubFs).toHaveBeenCalled()
  })

  it('ignores errors from currentBranch silently', async () => {
    mockCurrentBranch.mockRejectedValue(new Error('not a git repo'))
    const project = makeProject()
    expect(() => renderHook(() => useBranchSync(project, '/workspace'))).not.toThrow()
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockUpdateProjectBranch).not.toHaveBeenCalled()
  })

  it('ignores error responses from currentBranch', async () => {
    mockCurrentBranch.mockResolvedValue({ error: 'INVALID_PATH' })
    renderHook(() => useBranchSync(makeProject(), '/workspace'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockUpdateProjectBranch).not.toHaveBeenCalled()
  })
})
