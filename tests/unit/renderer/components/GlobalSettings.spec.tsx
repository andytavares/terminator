import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { GlobalSettings } from '../../../../src/renderer/components/settings/GlobalSettings'

vi.mock('../../../../src/renderer/stores/settings.store', () => ({
  useSettingsStore: vi.fn(),
}))

vi.mock('../../../../src/renderer/stores/toast.store', () => ({
  useToastStore: vi.fn().mockReturnValue({ addToast: vi.fn() }),
}))

const mockUpdateTheme = vi.fn()
const mockUpdateScrollback = vi.fn()
const mockUpdateWorktreeBaseDir = vi.fn()
const mockUpdateGlobal = vi.fn()
const mockUpdateRemoteControlEnabled = vi.fn()
const mockUpdateRemoteControlPort = vi.fn()

const globalSettings = {
  appearance: { theme: 'dark' as const },
  terminal: { scrollbackLimit: 5000, defaultShell: '/bin/zsh' },
  git: { worktreeBaseDir: '' },
  remoteControl: { enabled: false, port: 7681, password: '', passwordHash: '', ngrokAuthToken: '' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateGlobal.mockResolvedValue(undefined)
  vi.mocked(useSettingsStore).mockReturnValue({
    globalSettings,
    updateGlobalTheme: mockUpdateTheme,
    updateScrollbackLimit: mockUpdateScrollback,
    updateWorktreeBaseDir: mockUpdateWorktreeBaseDir,
    updateRemoteControlEnabled: mockUpdateRemoteControlEnabled,
    updateRemoteControlPort: mockUpdateRemoteControlPort,
  } as unknown as ReturnType<typeof useSettingsStore>)
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    settings: { updateGlobal: mockUpdateGlobal },
    extensionBridge: {
      on: vi.fn(() => vi.fn()),
      invoke: vi.fn().mockResolvedValue({}),
    },
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

  it('calls updateRemoteControlEnabled when remote control checkbox is toggled', () => {
    render(<GlobalSettings />)
    const checkbox = screen.getByRole('checkbox', { name: /enable remote control/i })
    fireEvent.click(checkbox)
    expect(mockUpdateRemoteControlEnabled).toHaveBeenCalledWith(true)
  })

  it('calls updateRemoteControlPort when port input is blurred with valid value', () => {
    render(<GlobalSettings />)
    const portInput = screen.getByDisplayValue('7681')
    fireEvent.blur(portInput)
    // Port field uses defaultValue (uncontrolled) — blur triggers validation with current DOM value
    expect(mockUpdateRemoteControlPort).toHaveBeenCalledWith(7681)
  })

  it('renders ngrok token input', () => {
    render(<GlobalSettings />)
    expect(screen.getByPlaceholderText('Paste your ngrok auth token')).toBeTruthy()
  })

  it('saves ngrok token on blur when changed', () => {
    render(<GlobalSettings />)
    const tokenInput = screen.getByPlaceholderText('Paste your ngrok auth token')
    fireEvent.change(tokenInput, { target: { value: 'my-token' } })
    fireEvent.blur(tokenInput)
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ remoteControl: { ngrokAuthToken: 'my-token' } })
  })

  it('does not save ngrok token on blur when unchanged', () => {
    render(<GlobalSettings />)
    const tokenInput = screen.getByPlaceholderText('Paste your ngrok auth token')
    // blur without changing (value is already '')
    fireEvent.blur(tokenInput)
    expect(mockUpdateGlobal).not.toHaveBeenCalled()
  })
})

describe('GlobalSettings — enabled section', () => {
  const mockInvoke = vi.fn().mockResolvedValue({})
  const mockUpdateGlobalLocal = vi.fn().mockResolvedValue(undefined)
  const mockAddToast = vi.fn()

  function renderEnabled(password = '', publicUrl?: string, lanUrl?: string) {
    let capturedStatusHandler: ((data: unknown) => void) | null = null
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      settings: { updateGlobal: mockUpdateGlobalLocal },
      extensionBridge: {
        on: vi.fn((event: string, handler: (data: unknown) => void) => {
          if (event === 'remote:status') capturedStatusHandler = handler
          return vi.fn()
        }),
        invoke: mockInvoke,
      },
    }
    vi.mocked(useSettingsStore).mockReturnValue({
      globalSettings: {
        appearance: { theme: 'dark' as const },
        terminal: { scrollbackLimit: 5000, defaultShell: '/bin/zsh' },
        git: { worktreeBaseDir: '' },
        remoteControl: {
          enabled: true,
          port: 7681,
          password,
          passwordHash: '',
          ngrokAuthToken: '',
        },
      },
      updateGlobalTheme: vi.fn(),
      updateScrollbackLimit: vi.fn(),
      updateWorktreeBaseDir: vi.fn(),
      updateShowMetricsBar: vi.fn(),
      updateRemoteControlEnabled: vi.fn(),
      updateRemoteControlPort: vi.fn(),
    } as unknown as ReturnType<typeof useSettingsStore>)
    const result = render(<GlobalSettings />)
    // Fire a status event to set remoteStatus fields
    if (capturedStatusHandler) {
      capturedStatusHandler({ enabled: true, publicUrl: publicUrl ?? null, lanUrl: lanUrl ?? null })
    }
    return result
  }

  beforeEach(() => {
    mockInvoke.mockReset()
    mockUpdateGlobalLocal.mockReset()
    mockAddToast.mockReset()
    mockInvoke.mockResolvedValue({})
    mockUpdateGlobalLocal.mockResolvedValue(undefined)
    // Mock clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).electronAPI
    vi.clearAllMocks()
  })

  it('renders password input when remote control is enabled', () => {
    renderEnabled()
    expect(screen.getByPlaceholderText(/enter a password or generate one/i)).toBeTruthy()
  })

  it('toggles password visibility with Show/Hide button', () => {
    renderEnabled('mypassword')
    const passwordInput = screen.getByPlaceholderText(/enter a password or generate one/i)
    expect(passwordInput.getAttribute('type')).toBe('password')
    const showBtn = screen.getByRole('button', { name: /show/i })
    fireEvent.click(showBtn)
    expect(passwordInput.getAttribute('type')).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: /hide/i }))
    expect(passwordInput.getAttribute('type')).toBe('password')
  })

  it('invokes remote:update-password on password blur when changed', () => {
    renderEnabled('old')
    const passwordInput = screen.getByPlaceholderText(/enter a password or generate one/i)
    fireEvent.change(passwordInput, { target: { value: 'newpass' } })
    fireEvent.blur(passwordInput)
    expect(mockInvoke).toHaveBeenCalledWith('remote:update-password', { password: 'newpass' })
  })

  it('does NOT invoke remote:update-password on blur when unchanged', () => {
    renderEnabled('same')
    const passwordInput = screen.getByPlaceholderText(/enter a password or generate one/i)
    // No change, just blur
    fireEvent.blur(passwordInput)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('invokes remote:update-password with empty string on Generate new click', () => {
    renderEnabled()
    const genBtn = screen.getByRole('button', { name: /generate new/i })
    fireEvent.click(genBtn)
    expect(mockInvoke).toHaveBeenCalledWith('remote:update-password', { password: '' })
  })

  it('copies password to clipboard on Copy click', () => {
    renderEnabled('mypassword')
    const copyBtns = screen.getAllByRole('button', { name: /copy/i })
    fireEvent.click(copyBtns[0]) // first Copy button is for password
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('mypassword')
  })

  it('shows ngrok not installed warning from status event', async () => {
    let capturedHandler: ((data: unknown) => void) | null = null
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      settings: { updateGlobal: mockUpdateGlobalLocal },
      extensionBridge: {
        on: vi.fn((event: string, handler: (data: unknown) => void) => {
          if (event === 'remote:status') capturedHandler = handler
          return vi.fn()
        }),
        invoke: mockInvoke,
      },
    }
    vi.mocked(useSettingsStore).mockReturnValue({
      globalSettings: {
        appearance: { theme: 'dark' as const },
        terminal: { scrollbackLimit: 5000, defaultShell: '/bin/zsh' },
        git: { worktreeBaseDir: '' },
        remoteControl: {
          enabled: true,
          port: 7681,
          password: '',
          passwordHash: '',
          ngrokAuthToken: '',
        },
      },
      updateGlobalTheme: vi.fn(),
      updateScrollbackLimit: vi.fn(),
      updateWorktreeBaseDir: vi.fn(),
      updateShowMetricsBar: vi.fn(),
      updateRemoteControlEnabled: vi.fn(),
      updateRemoteControlPort: vi.fn(),
    } as unknown as ReturnType<typeof useSettingsStore>)

    const { unmount } = render(<GlobalSettings />)
    if (capturedHandler) capturedHandler({ ngrokInstalled: false })
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByText(/ngrok not installed/i)).toBeTruthy()
    unmount()
  })

  it('shows ngrok error from status event', async () => {
    let capturedHandler: ((data: unknown) => void) | null = null
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      settings: { updateGlobal: mockUpdateGlobalLocal },
      extensionBridge: {
        on: vi.fn((event: string, handler: (data: unknown) => void) => {
          if (event === 'remote:status') capturedHandler = handler
          return vi.fn()
        }),
        invoke: mockInvoke,
      },
    }
    vi.mocked(useSettingsStore).mockReturnValue({
      globalSettings: {
        appearance: { theme: 'dark' as const },
        terminal: { scrollbackLimit: 5000, defaultShell: '/bin/zsh' },
        git: { worktreeBaseDir: '' },
        remoteControl: {
          enabled: true,
          port: 7681,
          password: '',
          passwordHash: '',
          ngrokAuthToken: '',
        },
      },
      updateGlobalTheme: vi.fn(),
      updateScrollbackLimit: vi.fn(),
      updateWorktreeBaseDir: vi.fn(),
      updateShowMetricsBar: vi.fn(),
      updateRemoteControlEnabled: vi.fn(),
      updateRemoteControlPort: vi.fn(),
    } as unknown as ReturnType<typeof useSettingsStore>)

    const { unmount } = render(<GlobalSettings />)
    if (capturedHandler) capturedHandler({ ngrokError: 'ngrok requires an auth token' })
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByText(/ngrok requires an auth token/i)).toBeTruthy()
    unmount()
  })
})
