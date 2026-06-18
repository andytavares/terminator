import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { WorkspaceSettings } from '../../../../src/renderer/components/settings/WorkspaceSettings'

vi.mock('../../../../src/renderer/stores/settings.store', () => ({
  useSettingsStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))

const mockUpdateTheme = vi.fn()
const mockUpdateScrollback = vi.fn()
const mockUpdateWorktreeDir = vi.fn()
const mockUpdateBranchExcludePatterns = vi.fn()
const mockLoadSettings = vi.fn()
const mockUpdateWorkspace = vi.fn()

const globalSettings = {
  appearance: { theme: 'dark' as const },
  terminal: { scrollbackLimit: 5000, defaultShell: '/bin/zsh' },
  git: { worktreeBaseDir: '', branchExcludePatterns: [] as string[] },
  extensions: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadSettings.mockResolvedValue(undefined)
  mockUpdateWorkspace.mockResolvedValue(undefined)
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    settings: { updateWorkspace: mockUpdateWorkspace },
  }
  vi.mocked(useSettingsStore).mockReturnValue({
    globalSettings,
    workspaceSettings: new Map(),
    updateWorkspaceTheme: mockUpdateTheme,
    updateWorkspaceScrollback: mockUpdateScrollback,
    updateWorkspaceWorktreeBaseDir: mockUpdateWorktreeDir,
    updateWorkspaceBranchExcludePatterns: mockUpdateBranchExcludePatterns,
    loadSettings: mockLoadSettings,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useWorkspaceStore).mockReturnValue({
    workspaces: [{ id: 'ws-1', name: 'My Workspace' }],
  } as unknown as ReturnType<typeof useWorkspaceStore>)
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('WorkspaceSettings', () => {
  it('shows loading when globalSettings is null', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      globalSettings: null,
      workspaceSettings: new Map(),
      loadSettings: mockLoadSettings,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(screen.getByText('Loading...')).toBeTruthy()
  })

  it('renders workspace name in title', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(screen.getByText(/Settings for: My Workspace/)).toBeTruthy()
  })

  it('shows workspaceId when workspace not found', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({ workspaces: [] } as unknown as ReturnType<
      typeof useWorkspaceStore
    >)
    render(<WorkspaceSettings workspaceId="ws-unknown" />)
    expect(screen.getByText(/Settings for: ws-unknown/)).toBeTruthy()
  })

  it('calls loadSettings on mount', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(mockLoadSettings).toHaveBeenCalledWith('ws-1')
  })

  it('renders theme radio options', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(screen.getByText('Dark')).toBeTruthy()
    expect(screen.getByText('Light')).toBeTruthy()
    expect(screen.getAllByText('Use global default').length).toBeGreaterThan(0)
  })

  it('calls updateWorkspaceTheme when theme is changed', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const radios = screen.getAllByRole('radio')
    fireEvent.click(radios[1]) // light
    expect(mockUpdateTheme).toHaveBeenCalledWith('ws-1', 'light')
  })

  it('calls updateWorkspaceScrollback for valid value', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const input = screen.getByDisplayValue('5000')
    fireEvent.change(input, { target: { value: '8000' } })
    expect(mockUpdateScrollback).toHaveBeenCalledWith('ws-1', 8000)
  })

  it('does not call updateWorkspaceScrollback for out-of-range value', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const input = screen.getByDisplayValue('5000')
    fireEvent.change(input, { target: { value: '100' } })
    expect(mockUpdateScrollback).not.toHaveBeenCalled()
  })

  it('calls updateWorkspace to clear theme override when "Use global default" radio is changed', () => {
    // Set a theme override so the "Use global default" radio is not already checked
    vi.mocked(useSettingsStore).mockReturnValue({
      globalSettings,
      workspaceSettings: new Map([
        ['ws-1', { overrides: { appearance: { theme: 'light' as const } } }],
      ]),
      updateWorkspaceTheme: mockUpdateTheme,
      updateWorkspaceScrollback: mockUpdateScrollback,
      updateWorkspaceWorktreeBaseDir: mockUpdateWorktreeDir,
      loadSettings: mockLoadSettings,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<WorkspaceSettings workspaceId="ws-1" />)
    // The "Use global default" radio for theme is the third radio in the theme group
    const radios = screen.getAllByRole('radio')
    // First two are dark/light, third is "use global default" for theme
    // fireEvent.click triggers onChange in React for radio inputs
    fireEvent.click(radios[2])
    expect(mockUpdateWorkspace).toHaveBeenCalledWith('ws-1', { appearance: undefined })
  })

  it('calls updateWorkspace to clear scrollback override when "Use global default" link is clicked', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    // The button-link for scrollback reset — filter by role=button
    const buttons = screen.getAllByRole('button')
    // The "Use global default" button for scrollback
    const scrollbackBtn = buttons.find((b) => b.textContent === 'Use global default')
    expect(scrollbackBtn).toBeTruthy()
    fireEvent.click(scrollbackBtn!)
    expect(mockUpdateWorkspace).toHaveBeenCalledWith('ws-1', { terminal: undefined })
  })

  it('calls updateWorkspaceWorktreeBaseDir on blur of worktree dir input', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const input = screen.getByPlaceholderText('Leave empty to use <repo>/.worktrees')
    fireEvent.blur(input)
    expect(mockUpdateWorktreeDir).toHaveBeenCalledWith('ws-1', undefined)
  })

  it('calls updateWorkspaceWorktreeBaseDir with trimmed value on blur', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const input = screen.getByPlaceholderText('Leave empty to use <repo>/.worktrees')
    // defaultValue is controlled by key; simulate blur with a new value via Object.defineProperty
    Object.defineProperty(input, 'value', { value: '  /custom/dir  ', writable: true })
    fireEvent.blur(input)
    expect(mockUpdateWorktreeDir).toHaveBeenCalledWith('ws-1', '/custom/dir')
  })

  it('shows "Use global default" button for worktree override when override is set', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      globalSettings,
      workspaceSettings: new Map([
        ['ws-1', { overrides: { git: { worktreeBaseDir: '/custom' } } }],
      ]),
      updateWorkspaceTheme: mockUpdateTheme,
      updateWorkspaceScrollback: mockUpdateScrollback,
      updateWorkspaceWorktreeBaseDir: mockUpdateWorktreeDir,
      loadSettings: mockLoadSettings,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<WorkspaceSettings workspaceId="ws-1" />)
    // When override is set, a second "Use global default" button appears for worktree dir
    const buttons = screen.getAllByRole('button')
    const globalDefaults = buttons.filter((b) => b.textContent === 'Use global default')
    expect(globalDefaults.length).toBeGreaterThanOrEqual(2)
    // Click the worktree "Use global default" (last one)
    fireEvent.click(globalDefaults[globalDefaults.length - 1])
    expect(mockUpdateWorktreeDir).toHaveBeenCalledWith('ws-1', undefined)
  })

  it('calls updateWorkspaceBranchExcludePatterns on blur of branch exclude textarea', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const textarea = screen.getByPlaceholderText(/gh-readonly-queue/)
    Object.defineProperty(textarea, 'value', {
      value: 'gh-readonly-queue/*\nrenovate/*',
      writable: true,
    })
    fireEvent.blur(textarea)
    expect(mockUpdateBranchExcludePatterns).toHaveBeenCalledWith('ws-1', [
      'gh-readonly-queue/*',
      'renovate/*',
    ])
  })

  it('calls updateWorkspaceBranchExcludePatterns with undefined when textarea is empty on blur', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const textarea = screen.getByPlaceholderText(/gh-readonly-queue/)
    Object.defineProperty(textarea, 'value', { value: '   ', writable: true })
    fireEvent.blur(textarea)
    expect(mockUpdateBranchExcludePatterns).toHaveBeenCalledWith('ws-1', undefined)
  })

  it('shows Use global default button for branch exclude when override is set and clicking it calls update with undefined', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      globalSettings,
      workspaceSettings: new Map([
        ['ws-1', { overrides: { git: { branchExcludePatterns: ['renovate/*'] } } }],
      ]),
      updateWorkspaceTheme: mockUpdateTheme,
      updateWorkspaceScrollback: mockUpdateScrollback,
      updateWorkspaceWorktreeBaseDir: mockUpdateWorktreeDir,
      updateWorkspaceBranchExcludePatterns: mockUpdateBranchExcludePatterns,
      loadSettings: mockLoadSettings,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const buttons = screen.getAllByRole('button')
    const globalDefaults = buttons.filter((b) => b.textContent === 'Use global default')
    expect(globalDefaults.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(globalDefaults[globalDefaults.length - 1])
    expect(mockUpdateBranchExcludePatterns).toHaveBeenCalledWith('ws-1', undefined)
  })
})
