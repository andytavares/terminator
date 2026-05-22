import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import { BranchSwitcher } from '../../../../src/renderer/components/sidebar/BranchSwitcher'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/stores/toast.store', () => ({
  useToastStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/hooks/useBranchSync', () => ({
  useBranchSync: vi.fn(),
}))

const mockUpdateProjectBranch = vi.fn()
const mockAddToast = vi.fn()
const mockListBranches = vi.fn()
const mockCheckout = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    git: {
      listBranches: mockListBranches,
      checkout: mockCheckout,
    },
  }
  vi.mocked(useWorkspaceStore).mockReturnValue({
    updateProjectBranch: mockUpdateProjectBranch,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useToastStore).mockReturnValue({
    addToast: mockAddToast,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  mockListBranches.mockResolvedValue({
    branches: [
      { name: 'main', isRemote: false },
      { name: 'feature/test', isRemote: false },
      { name: 'origin/main', isRemote: true },
    ],
  })
  mockCheckout.mockResolvedValue({ success: true })
  mockUpdateProjectBranch.mockResolvedValue(undefined)
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

const project = {
  id: 'proj-1',
  workspaceId: 'ws-1',
  name: 'My Project',
  gitBranch: 'main',
  worktreePath: null,
  isWorktree: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

describe('BranchSwitcher', () => {
  it('renders branch name', () => {
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    expect(screen.getByText('main')).toBeTruthy()
  })

  it('renders branch icon', () => {
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    expect(screen.getByText('⎇')).toBeTruthy()
  })

  it('returns null when project has no gitBranch and no worktreePath', () => {
    const projectWithoutBranch = { ...project, gitBranch: null, worktreePath: null }
    const { container } = render(
      <BranchSwitcher project={projectWithoutBranch} workspaceFolderPath="/repo" />
    )
    expect(container.firstChild).toBeNull()
  })

  it('opens dropdown when trigger is clicked', async () => {
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => expect(mockListBranches).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Local')).toBeTruthy())
  })

  it('shows branches after opening dropdown', async () => {
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => expect(screen.getByText('feature/test')).toBeTruthy())
  })

  it('shows remote branches section', async () => {
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => expect(screen.getByText('Remote')).toBeTruthy())
  })

  it('shows loading state while fetching branches', async () => {
    let resolve: (v: { branches: unknown[] }) => void
    mockListBranches.mockReturnValue(
      new Promise((r) => {
        resolve = r
      })
    )
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => expect(screen.getByText('Loading branches…')).toBeTruthy())
    resolve!({ branches: [] })
  })

  it('shows error state when branch fetch fails', async () => {
    mockListBranches.mockRejectedValue(new Error('git error'))
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => expect(screen.getByText(/Could not load branches/)).toBeTruthy())
  })

  it('shows no branches message when both lists are empty', async () => {
    mockListBranches.mockResolvedValue({ branches: [] })
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => expect(screen.getByText('No branches found')).toBeTruthy())
  })

  it('checks out branch when a branch is selected', async () => {
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => screen.getByText('feature/test'))
    fireEvent.click(screen.getByText('feature/test'))
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledWith('/repo', 'feature/test'))
    await waitFor(() =>
      expect(mockUpdateProjectBranch).toHaveBeenCalledWith('proj-1', 'feature/test')
    )
  })

  it('shows error toast when checkout fails', async () => {
    mockCheckout.mockResolvedValue({ error: 'CONFLICT' })
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => screen.getByText('feature/test'))
    fireEvent.click(screen.getByText('feature/test'))
    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    )
  })

  it('toggles closed when trigger is clicked again', async () => {
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    const trigger = screen.getByTitle('Branch: main')
    fireEvent.click(trigger)
    await waitFor(() => screen.getByText('Local'))
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.queryByText('Local')).toBeNull())
  })

  it('uses worktreePath as cwd when project has worktreePath', async () => {
    const worktreeProject = { ...project, worktreePath: '/worktrees/feature' }
    render(<BranchSwitcher project={worktreeProject} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => expect(mockListBranches).toHaveBeenCalledWith('/worktrees/feature'))
  })

  it('shows checkmark for current branch', async () => {
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => screen.getByText('main'))
    const mainBtns = screen.getAllByTitle('main')
    expect(mainBtns.some((b) => b.className.includes('branch-sw__item--active'))).toBe(true)
  })

  it('filters branches by text input', async () => {
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => screen.getByText('feature/test'))
    const filterInput = screen.getByPlaceholderText('Filter branches…')
    fireEvent.change(filterInput, { target: { value: 'feature' } })
    expect(screen.queryByText('feature/test')).toBeTruthy()
    // 'main' branch name button should no longer appear (but the trigger still shows main)
    const mainItems = screen.queryAllByTitle('main')
    expect(mainItems.length).toBe(0)
  })

  it('shows no matching branches message when filter has no results', async () => {
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => screen.getByText('feature/test'))
    const filterInput = screen.getByPlaceholderText('Filter branches…')
    fireEvent.change(filterInput, { target: { value: 'zzz-no-match' } })
    await waitFor(() => expect(screen.getByText('No matching branches')).toBeTruthy())
  })

  it('closes dropdown when Escape is pressed in filter input', async () => {
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => screen.getByPlaceholderText('Filter branches…'))
    fireEvent.keyDown(screen.getByPlaceholderText('Filter branches…'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByPlaceholderText('Filter branches…')).toBeNull())
  })

  it('closes dropdown on outside click', async () => {
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => screen.getByText('Local'))
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByText('Local')).toBeNull())
  })

  it('does not switch branch when clicking the currently active branch', async () => {
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => screen.getByText('main'))
    // Click the active branch button (there should be one inside the dropdown list)
    const mainBtns = screen.getAllByTitle('main')
    fireEvent.click(mainBtns[0])
    expect(mockCheckout).not.toHaveBeenCalled()
  })

  it('shows error toast when checkout throws an exception', async () => {
    mockCheckout.mockRejectedValue(new Error('network failure'))
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => screen.getByText('feature/test'))
    fireEvent.click(screen.getByText('feature/test'))
    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: expect.stringContaining('network failure') })
      )
    )
  })

  it('uses workspaceFolderPath for checkout on non-worktree project', async () => {
    mockCheckout.mockResolvedValue({ success: true })
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => screen.getByText('feature/test'))
    fireEvent.click(screen.getByText('feature/test'))
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledWith('/repo', 'feature/test'))
  })

  it('uses worktreePath for checkout on worktree project', async () => {
    const worktreeProject = { ...project, worktreePath: '/worktrees/feat', isWorktree: true }
    mockCheckout.mockResolvedValue({ success: true })
    render(<BranchSwitcher project={worktreeProject} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => screen.getByText('feature/test'))
    fireEvent.click(screen.getByText('feature/test'))
    await waitFor(() =>
      expect(mockCheckout).toHaveBeenCalledWith('/worktrees/feat', 'feature/test')
    )
  })

  it('shows error text for unknown error type during branch fetch', async () => {
    mockListBranches.mockRejectedValue('plain string error')
    render(<BranchSwitcher project={project} workspaceFolderPath="/repo" />)
    fireEvent.click(screen.getByTitle('Branch: main'))
    await waitFor(() => expect(screen.getByText(/Could not load branches/)).toBeTruthy())
  })
})
