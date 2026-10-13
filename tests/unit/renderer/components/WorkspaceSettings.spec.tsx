import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { WorkspaceSettings } from '../../../../src/renderer/components/settings/WorkspaceSettings'
import { seedStore, workspaceFixture } from '../../../support/renderer-stores'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'
import type { GlobalSettings as GlobalSettingsValue } from '../../../../src/shared/types'
import { installElectronApi } from '../../../support/electron-api'

const mockUpdateTheme = vi.fn()
const mockUpdateScrollback = vi.fn()
const mockUpdateWorktreeDir = vi.fn()
const mockUpdateBranchExcludePatterns = vi.fn()
const mockLoadSettings = vi.fn()
const mockUpdateWorkspace = vi.fn()
const mockUpdateWorkspaceQuickActions = vi.fn()

const globalSettings: GlobalSettingsValue = {
  ...DEFAULT_GLOBAL_SETTINGS,
  appearance: { theme: 'dark' },
  terminal: {
    ...DEFAULT_GLOBAL_SETTINGS.terminal,
    scrollbackLimit: 5000,
    defaultShell: '/bin/zsh',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadSettings.mockResolvedValue(undefined)
  mockUpdateWorkspace.mockResolvedValue(undefined)
  installElectronApi({
    settings: { updateWorkspace: mockUpdateWorkspace },
    // No extension declares a workspace-scoped setting here; WorkspaceExtensionSettings.spec covers those.
    extension: {
      getSettingsSchemas: vi.fn(async () => ({ schemas: [] })),
      getSettingsValues: vi.fn(async () => ({ values: {} })),
      onListChanged: vi.fn(() => () => {}),
    },
  })
  seedStore(useSettingsStore, {
    globalSettings,
    workspaceSettings: new Map(),
    updateWorkspaceTheme: mockUpdateTheme,
    updateWorkspaceScrollback: mockUpdateScrollback,
    updateWorkspaceWorktreeBaseDir: mockUpdateWorktreeDir,
    updateWorkspaceBranchExcludePatterns: mockUpdateBranchExcludePatterns,
    updateWorkspaceQuickActions: mockUpdateWorkspaceQuickActions,
    loadSettings: mockLoadSettings,
  })
  seedStore(useWorkspaceStore, {
    workspaces: [workspaceFixture({ id: 'ws-1', name: 'My Workspace' })],
  })
})

describe('WorkspaceSettings', () => {
  it('shows loading when globalSettings is null', () => {
    seedStore(useSettingsStore, {
      globalSettings: null,
      workspaceSettings: new Map(),
      loadSettings: mockLoadSettings,
    })
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(screen.getByText('Loading...')).toBeTruthy()
  })

  it('renders workspace name in title', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(screen.getByText(/Settings for: My Workspace/)).toBeTruthy()
  })

  it('shows workspaceId when workspace not found', () => {
    seedStore(useWorkspaceStore, { workspaces: [] })
    render(<WorkspaceSettings workspaceId="ws-unknown" />)
    expect(screen.getByText(/Settings for: ws-unknown/)).toBeTruthy()
  })

  it('calls loadSettings on mount', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(mockLoadSettings).toHaveBeenCalledWith('ws-1')
  })
})

describe('WorkspaceSettings — renders theme radio options', () => {
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
})

describe('WorkspaceSettings — calls updateWorkspace to clear theme override when "Use global default" radio is changed', () => {
  it('calls updateWorkspace to clear theme override when "Use global default" radio is changed', () => {
    // Set a theme override so the "Use global default" radio is not already checked
    seedStore(useSettingsStore, {
      globalSettings,
      workspaceSettings: new Map([
        [
          'ws-1',
          {
            workspaceId: 'ws-1',
            extensions: {},
            overrides: { appearance: { theme: 'light' as const } },
          },
        ],
      ]),
      updateWorkspaceTheme: mockUpdateTheme,
      updateWorkspaceScrollback: mockUpdateScrollback,
      updateWorkspaceWorktreeBaseDir: mockUpdateWorktreeDir,
      loadSettings: mockLoadSettings,
    })
    render(<WorkspaceSettings workspaceId="ws-1" />)
    // The "Use global default" radio for theme is the third radio in the theme group
    const radios = screen.getAllByRole('radio')
    // First two are dark/light, third is "use global default" for theme
    // fireEvent.click triggers onChange in React for radio inputs
    fireEvent.click(radios[2])
    expect(mockUpdateWorkspace).toHaveBeenCalledWith('ws-1', { appearance: undefined })
  })
})

describe('WorkspaceSettings — calls updateWorkspace to clear scrollback override when "Use global default" link is clicked', () => {
  it('calls updateWorkspace to clear scrollback override when "Use global default" link is clicked', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    // The button-link for scrollback reset — filter by role=button
    const buttons = screen.getAllByRole('button')
    // The "Use global default" button for scrollback
    const scrollbackBtn = buttons.find((b) => b.textContent === 'Use global default')
    expect(scrollbackBtn).toBeTruthy()
    fireEvent.click(scrollbackBtn!)
    // Only the scrollback: the workspace's own shell, if it sets one, stays.
    expect(mockUpdateWorkspace).toHaveBeenCalledWith('ws-1', {
      terminal: { scrollbackLimit: undefined },
    })
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
})

describe('WorkspaceSettings — shows "Use global default" button for worktree override when override is set', () => {
  it('shows "Use global default" button for worktree override when override is set', () => {
    seedStore(useSettingsStore, {
      globalSettings,
      workspaceSettings: new Map([
        [
          'ws-1',
          {
            workspaceId: 'ws-1',
            extensions: {},
            overrides: { git: { worktreeBaseDir: '/custom' } },
          },
        ],
      ]),
      updateWorkspaceTheme: mockUpdateTheme,
      updateWorkspaceScrollback: mockUpdateScrollback,
      updateWorkspaceWorktreeBaseDir: mockUpdateWorktreeDir,
      loadSettings: mockLoadSettings,
    })
    render(<WorkspaceSettings workspaceId="ws-1" />)
    // When override is set, a second "Use global default" button appears for worktree dir
    const buttons = screen.getAllByRole('button')
    const globalDefaults = buttons.filter((b) => b.textContent === 'Use global default')
    expect(globalDefaults.length).toBeGreaterThanOrEqual(2)
    // Click the worktree "Use global default" (last one)
    fireEvent.click(globalDefaults[globalDefaults.length - 1])
    expect(mockUpdateWorktreeDir).toHaveBeenCalledWith('ws-1', undefined)
  })
})

describe('WorkspaceSettings — calls updateWorkspaceBranchExcludePatterns on blur of branch exclude textarea', () => {
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
})

describe('WorkspaceSettings — shows Use global default button for branch exclude when override is set and clicking it calls update with undefined', () => {
  it('shows Use global default button for branch exclude when override is set and clicking it calls update with undefined', () => {
    seedStore(useSettingsStore, {
      globalSettings,
      workspaceSettings: new Map([
        [
          'ws-1',
          {
            workspaceId: 'ws-1',
            extensions: {},
            overrides: { git: { branchExcludePatterns: ['renovate/*'] } },
          },
        ],
      ]),
      updateWorkspaceTheme: mockUpdateTheme,
      updateWorkspaceScrollback: mockUpdateScrollback,
      updateWorkspaceWorktreeBaseDir: mockUpdateWorktreeDir,
      updateWorkspaceBranchExcludePatterns: mockUpdateBranchExcludePatterns,
      loadSettings: mockLoadSettings,
    })
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const buttons = screen.getAllByRole('button')
    const globalDefaults = buttons.filter((b) => b.textContent === 'Use global default')
    expect(globalDefaults.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(globalDefaults[globalDefaults.length - 1])
    expect(mockUpdateBranchExcludePatterns).toHaveBeenCalledWith('ws-1', undefined)
  })
})

describe('WorkspaceSettings — mounts the Quick actions section scoped to the workspace', () => {
  it('mounts the Quick actions section scoped to the workspace', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(screen.getByText('Quick actions')).toBeTruthy()
    fireEvent.click(screen.getByText('Add action'))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Deploy' } })
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'echo deploy' } })
    fireEvent.click(screen.getByText('Save'))
    expect(mockUpdateWorkspaceQuickActions).toHaveBeenCalledWith(
      'ws-1',
      expect.arrayContaining([expect.objectContaining({ label: 'Deploy' })])
    )
  })
})

describe("WorkspaceSettings — the workspace's own default shell", () => {
  const mockUpdateShell = vi.fn()
  const shellBox = () => screen.getByRole('textbox', { name: 'Default Shell' }) as HTMLInputElement

  /** The store as the page reads it, with this workspace's own shell when given. */
  function seedShell(own?: string) {
    const overrides = own ? { terminal: { defaultShell: own } } : {}
    seedStore(useSettingsStore, {
      globalSettings,
      workspaceSettings: new Map([['ws-1', { workspaceId: 'ws-1', overrides, extensions: {} }]]),
      updateWorkspaceDefaultShell: mockUpdateShell,
      loadSettings: mockLoadSettings,
    })
  }

  it('shows the global shell until the workspace sets its own, then saves that one', () => {
    seedShell()
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(shellBox().value).toBe('/bin/zsh')

    fireEvent.change(shellBox(), { target: { value: '  /bin/fish ' } })
    fireEvent.blur(shellBox())

    expect(mockUpdateShell).toHaveBeenCalledWith('ws-1', '/bin/fish')
  })

  it('hands the shell back to the global one with "Use global default"', () => {
    seedShell('/bin/fish')
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(shellBox().value).toBe('/bin/fish')

    const field = shellBox().closest('div')!
    fireEvent.click(within(field).getByRole('button', { name: 'Use global default' }))

    expect(mockUpdateShell).toHaveBeenCalledWith('ws-1', undefined)
  })
})
