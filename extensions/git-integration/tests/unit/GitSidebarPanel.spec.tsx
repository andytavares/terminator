import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'

vi.mock('../../src/stores/git.store', () => ({
  useGitStore: vi.fn(),
}))
vi.mock('../../src/hooks/useGitStatus', () => ({
  useGitStatus: vi.fn(),
}))
vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: vi.fn(() => ({ setActiveProjectTab: vi.fn() })),
}))

import { useGitStore } from '../../src/stores/git.store'
import { GitSidebarPanel } from '../../src/components/GitSidebarPanel'

const mockUseGitStore = vi.mocked(useGitStore)
const mockBridgeInvoke = vi.fn().mockResolvedValue({ ok: true })

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke: mockBridgeInvoke },
  }
})

describe('GitSidebarPanel — loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGitStore.mockReturnValue({
      status: null,
      setSelectedFile: vi.fn(),
      setDiff: vi.fn(),
    } as ReturnType<typeof useGitStore>)
  })

  it('renders skeleton rows when status is null', () => {
    render(<GitSidebarPanel repoRoot="/repo" onClose={vi.fn()} />)
    const skeletons = document.querySelectorAll('.skeleton--row')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('does not render loading text when using skeleton', () => {
    render(<GitSidebarPanel repoRoot="/repo" onClose={vi.fn()} />)
    const loadingDiv = document.querySelector('.git-sidebar__loading')
    expect(loadingDiv).toBeNull()
  })
})

describe('GitSidebarPanel — resolve conflicts button', () => {
  it('shows Resolve conflicts button when hasConflicts is true', () => {
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files: [], hasConflicts: true, truncated: false },
      setSelectedFile: vi.fn(),
      setDiff: vi.fn(),
    } as ReturnType<typeof useGitStore>)
    render(<GitSidebarPanel repoRoot="/repo" onClose={vi.fn()} />)
    expect(screen.getByTestId('resolve-conflicts-btn')).toBeTruthy()
  })

  it('hides Resolve conflicts button when no conflicts', () => {
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files: [], hasConflicts: false, truncated: false },
      setSelectedFile: vi.fn(),
      setDiff: vi.fn(),
    } as ReturnType<typeof useGitStore>)
    render(<GitSidebarPanel repoRoot="/repo" onClose={vi.fn()} />)
    expect(screen.queryByTestId('resolve-conflicts-btn')).toBeNull()
  })

  it('invokes git:request-merge-flow via extensionBridge when resolve button clicked', () => {
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files: [], hasConflicts: true, truncated: false },
      setSelectedFile: vi.fn(),
      setDiff: vi.fn(),
    } as ReturnType<typeof useGitStore>)
    render(<GitSidebarPanel repoRoot="/repo" onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('resolve-conflicts-btn'))
    expect(mockBridgeInvoke).toHaveBeenCalledWith('git:request-merge-flow', { repoRoot: '/repo' })
  })
})
