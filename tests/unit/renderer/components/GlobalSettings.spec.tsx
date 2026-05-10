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
const mockUpdateGlobal = vi.fn()

const globalSettings = {
  appearance: { theme: 'dark' as const },
  terminal: { scrollbackLimit: 5000, defaultShell: '/bin/zsh' },
  git: { worktreeBaseDir: '' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateGlobal.mockResolvedValue(undefined)
  vi.mocked(useSettingsStore).mockReturnValue({
    globalSettings,
    updateGlobalTheme: mockUpdateTheme,
    updateScrollbackLimit: mockUpdateScrollback,
    updateWorktreeBaseDir: mockUpdateWorktreeBaseDir,
  } as any)
  ;(globalThis as any).electronAPI = {
    settings: { updateGlobal: mockUpdateGlobal },
  }
})

afterEach(() => {
  delete (globalThis as any).electronAPI
})

describe('GlobalSettings', () => {
  it('shows loading when globalSettings is null', () => {
    vi.mocked(useSettingsStore).mockReturnValue({ globalSettings: null } as any)
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
    const inputs = screen.getAllByRole('textbox')
    const worktreeInput = inputs[inputs.length - 1]
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
})
