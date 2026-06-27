import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { GlobalSettings } from '../../../../src/renderer/components/settings/GlobalSettings'

vi.mock('../../../../src/renderer/stores/settings.store', () => ({
  useSettingsStore: vi.fn(),
}))

const mockUpdateTheme = vi.fn()
const mockUpdateScrollback = vi.fn()
const mockUpdateWorktreeBaseDir = vi.fn()
const mockUpdateShowMetrics = vi.fn()
const mockUpdateBranchExclude = vi.fn()
const mockUpdateGlobal = vi.fn()
const mockUpdatePromptForName = vi.fn()

const globalSettings = {
  appearance: { theme: 'dark' as const },
  terminal: {
    scrollbackLimit: 5000,
    defaultShell: '/bin/zsh',
  },
  git: { worktreeBaseDir: '' },
  extensions: {},
  ui: { hasSeenWelcome: false, showMetricsBar: false },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateGlobal.mockResolvedValue(undefined)
  vi.mocked(useSettingsStore).mockReturnValue({
    globalSettings,
    updateGlobalTheme: mockUpdateTheme,
    updateScrollbackLimit: mockUpdateScrollback,
    updateWorktreeBaseDir: mockUpdateWorktreeBaseDir,
    updateShowMetricsBar: mockUpdateShowMetrics,
    updateBranchExcludePatterns: mockUpdateBranchExclude,
    updatePromptForName: mockUpdatePromptForName,
  } as unknown as ReturnType<typeof useSettingsStore>)
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    settings: { updateGlobal: mockUpdateGlobal },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('GlobalSettings', () => {
  it('shows loading when globalSettings is null', () => {
    vi.mocked(useSettingsStore).mockReturnValue({ globalSettings: null } as unknown as ReturnType<
      typeof useSettingsStore
    >)
    render(<GlobalSettings />)
    expect(screen.getByText('Loading...')).toBeTruthy()
  })

  it('renders theme options', () => {
    render(<GlobalSettings />)
    expect(screen.getByText('Dark')).toBeTruthy()
    expect(screen.getByText('Light')).toBeTruthy()
  })

  it('calls updateGlobalTheme when theme is changed', () => {
    render(<GlobalSettings />)
    const radios = screen.getAllByRole('radio')
    fireEvent.click(radios[1]) // light
    expect(mockUpdateTheme).toHaveBeenCalledWith('light')
  })

  it('renders scrollback limit input with current value', () => {
    render(<GlobalSettings />)
    const input = screen.getByDisplayValue('5000')
    expect(input).toBeTruthy()
  })

  it('calls updateScrollbackLimit for valid scrollback value', () => {
    render(<GlobalSettings />)
    const input = screen.getByDisplayValue('5000')
    fireEvent.change(input, { target: { value: '8000' } })
    expect(mockUpdateScrollback).toHaveBeenCalledWith(8000)
  })

  it('does not call updateScrollbackLimit for below-minimum value', () => {
    render(<GlobalSettings />)
    const input = screen.getByDisplayValue('5000')
    fireEvent.change(input, { target: { value: '500' } })
    expect(mockUpdateScrollback).not.toHaveBeenCalled()
  })

  it('does not call updateScrollbackLimit for above-maximum value', () => {
    render(<GlobalSettings />)
    const input = screen.getByDisplayValue('5000')
    fireEvent.change(input, { target: { value: '200000' } })
    expect(mockUpdateScrollback).not.toHaveBeenCalled()
  })

  it('calls updateWorktreeBaseDir on blur of worktree input', () => {
    render(<GlobalSettings />)
    const worktreeInput = screen.getByPlaceholderText('Leave empty to use <repo>/.worktrees')
    fireEvent.change(worktreeInput, { target: { value: '/my/worktrees' } })
    fireEvent.blur(worktreeInput)
    expect(mockUpdateWorktreeBaseDir).toHaveBeenCalledWith('/my/worktrees')
  })

  it('calls electronAPI.settings.updateGlobal when default shell is changed', () => {
    render(<GlobalSettings />)
    const inputs = screen.getAllByRole('textbox')
    const shellInput = inputs[0]
    fireEvent.change(shellInput, { target: { value: '/bin/bash' } })
    fireEvent.blur(shellInput)
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ terminal: { defaultShell: '/bin/bash' } })
  })

  it('calls updateShowMetricsBar when metrics bar checkbox is toggled', () => {
    render(<GlobalSettings />)
    const checkbox = screen.getByRole('checkbox', { name: /show cpu/i })
    fireEvent.click(checkbox)
    expect(mockUpdateShowMetrics).toHaveBeenCalledWith(true)
  })

  it('renders the worktree base directory hint', () => {
    render(<GlobalSettings />)
    expect(screen.getByText(/where new git worktrees are created/i)).toBeTruthy()
  })

  it('calls updateBranchExcludePatterns on blur of the patterns textarea', () => {
    render(<GlobalSettings />)
    const textarea = screen.getByPlaceholderText(/gh-readonly-queue/i)
    fireEvent.change(textarea, { target: { value: 'renovate/*\n\n  release/*  ' } })
    fireEvent.blur(textarea)
    expect(mockUpdateBranchExclude).toHaveBeenCalledWith(['renovate/*', 'release/*'])
  })

  it('calls updatePromptForName when prompt-for-name checkbox is toggled', () => {
    render(<GlobalSettings />)
    const checkbox = screen.getByRole('checkbox', { name: /prompt for session name/i })
    fireEvent.click(checkbox)
    expect(mockUpdatePromptForName).toHaveBeenCalledWith(true)
  })
})
