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
const mockLoadSettings = vi.fn()
const mockUpdateWorkspace = vi.fn()

const globalSettings = {
  appearance: { theme: 'dark' as const },
  terminal: { scrollbackLimit: 5000, defaultShell: '/bin/zsh' },
  git: { worktreeBaseDir: '' },
  extensions: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadSettings.mockResolvedValue(undefined)
  mockUpdateWorkspace.mockResolvedValue(undefined)
  ;(globalThis as any).electronAPI = {
    settings: { updateWorkspace: mockUpdateWorkspace },
  }
  vi.mocked(useSettingsStore).mockReturnValue({
    globalSettings,
    workspaceSettings: new Map(),
    updateWorkspaceTheme: mockUpdateTheme,
    updateWorkspaceScrollback: mockUpdateScrollback,
    updateWorkspaceWorktreeBaseDir: mockUpdateWorktreeDir,
    loadSettings: mockLoadSettings,
  } as any)
  vi.mocked(useWorkspaceStore).mockReturnValue({
    workspaces: [{ id: 'ws-1', name: 'My Workspace' }],
  } as any)
})

afterEach(() => {
  delete (globalThis as any).electronAPI
})

describe('WorkspaceSettings', () => {
  it('shows loading when globalSettings is null', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      globalSettings: null,
      workspaceSettings: new Map(),
      loadSettings: mockLoadSettings,
    } as any)
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(screen.getByText('Loading...')).toBeTruthy()
  })

  it('renders workspace name in title', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(screen.getByText(/Settings for: My Workspace/)).toBeTruthy()
  })

  it('shows workspaceId when workspace not found', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({ workspaces: [] } as any)
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
})
