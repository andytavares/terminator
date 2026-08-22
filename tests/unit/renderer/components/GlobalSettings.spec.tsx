import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
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
const mockUpdateNotificationDefaultTargets = vi.fn()
const mockUpdateNotificationOverride = vi.fn()

const globalSettings = {
  appearance: { theme: 'dark' as const },
  terminal: {
    scrollbackLimit: 5000,
    defaultShell: '/bin/zsh',
  },
  git: { worktreeBaseDir: '' },
  extensions: {},
  ui: { hasSeenWelcome: false, showMetricsBar: false },
  sidebar: { staleAfterMs: 7_200_000 },
  notifications: {
    defaultTargets: ['system', 'center', 'toast'] as const,
    overrides: {},
  },
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
    updateNotificationDefaultTargets: mockUpdateNotificationDefaultTargets,
    updateNotificationOverride: mockUpdateNotificationOverride,
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

  describe('Notifications', () => {
    it('renders the default target checkboxes, all checked by default', () => {
      render(<GlobalSettings />)
      expect(screen.getAllByRole('checkbox', { name: 'System' })[0]).toHaveProperty('checked', true)
      expect(screen.getAllByRole('checkbox', { name: 'In-App' })[0]).toHaveProperty('checked', true)
      expect(screen.getAllByRole('checkbox', { name: 'Toast' })[0]).toHaveProperty('checked', true)
    })

    it('unchecking a default target removes it from the array', () => {
      render(<GlobalSettings />)
      fireEvent.click(screen.getAllByRole('checkbox', { name: 'System' })[0])
      expect(mockUpdateNotificationDefaultTargets).toHaveBeenCalledWith(['center', 'toast'])
    })

    it('checking an absent default target adds it back', () => {
      vi.mocked(useSettingsStore).mockReturnValue({
        globalSettings: {
          ...globalSettings,
          notifications: { defaultTargets: ['toast'], overrides: {} },
        },
        updateGlobalTheme: mockUpdateTheme,
        updateScrollbackLimit: mockUpdateScrollback,
        updateWorktreeBaseDir: mockUpdateWorktreeBaseDir,
        updateShowMetricsBar: mockUpdateShowMetrics,
        updateBranchExcludePatterns: mockUpdateBranchExclude,
        updatePromptForName: mockUpdatePromptForName,
        updateNotificationDefaultTargets: mockUpdateNotificationDefaultTargets,
        updateNotificationOverride: mockUpdateNotificationOverride,
      } as unknown as ReturnType<typeof useSettingsStore>)
      render(<GlobalSettings />)
      fireEvent.click(screen.getAllByRole('checkbox', { name: 'System' })[0])
      expect(mockUpdateNotificationDefaultTargets).toHaveBeenCalledWith(['toast', 'system'])
    })

    it('renders a per-notification override row for each core notification kind', () => {
      render(<GlobalSettings />)
      expect(screen.getByText('Terminal bell (session needs attention)')).toBeTruthy()
      expect(screen.getByText('Branch switch failed')).toBeTruthy()
      expect(screen.getByText('Extension install failed')).toBeTruthy()
    })

    it('checking a target on a core notification override row calls updateNotificationOverride', () => {
      render(<GlobalSettings />)
      const row = screen.getByText('Terminal bell (session needs attention)').closest('div')!
      const systemCheckbox = within(row.parentElement as HTMLElement).getAllByRole('checkbox')[0]
      fireEvent.click(systemCheckbox)
      expect(mockUpdateNotificationOverride).toHaveBeenCalledWith('terminalBell', ['system'])
    })

    it('does not show a per-extension table (extensions configure their own notifications)', () => {
      render(<GlobalSettings />)
      expect(screen.queryByText('Per-Extension Overrides')).toBeNull()
    })
  })
})

describe('GlobalSettings — staleness threshold (FR-020)', () => {
  const field = () => screen.getByLabelText('Mark sessions stale after (minutes)')

  it('shows the current threshold in minutes', () => {
    render(<GlobalSettings />)
    expect((field() as HTMLInputElement).value).toBe('120')
  })

  it('saves a changed threshold as milliseconds', () => {
    render(<GlobalSettings />)
    fireEvent.blur(field(), { target: { value: '30' } })
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ sidebar: { staleAfterMs: 1_800_000 } })
  })

  it('accepts the one-minute minimum', () => {
    render(<GlobalSettings />)
    fireEvent.blur(field(), { target: { value: '1' } })
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ sidebar: { staleAfterMs: 60_000 } })
  })

  it('rejects zero rather than making every session stale', () => {
    render(<GlobalSettings />)
    fireEvent.blur(field(), { target: { value: '0' } })
    expect(mockUpdateGlobal).not.toHaveBeenCalled()
  })

  it('rejects a value beyond thirty days', () => {
    render(<GlobalSettings />)
    fireEvent.blur(field(), { target: { value: '43201' } })
    expect(mockUpdateGlobal).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric entry', () => {
    render(<GlobalSettings />)
    fireEvent.blur(field(), { target: { value: '' } })
    expect(mockUpdateGlobal).not.toHaveBeenCalled()
  })

  it('rounds a fractional entry to whole minutes', () => {
    render(<GlobalSettings />)
    fireEvent.blur(field(), { target: { value: '2.6' } })
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ sidebar: { staleAfterMs: 180_000 } })
  })

  it('falls back to two hours when the setting is absent', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      globalSettings: { ...globalSettings, sidebar: undefined },
      updateGlobalTheme: mockUpdateTheme,
    } as unknown as ReturnType<typeof useSettingsStore>)
    render(<GlobalSettings />)
    expect((field() as HTMLInputElement).value).toBe('120')
  })
})
