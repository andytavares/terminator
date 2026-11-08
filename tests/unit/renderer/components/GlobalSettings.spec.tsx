import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { GlobalSettings } from '../../../../src/renderer/components/settings/GlobalSettings'
import { resetStore } from '../../../support/renderer-stores'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'
import type { GlobalSettings as GlobalSettingsValue } from '../../../../src/shared/types'
import { installElectronApi } from '../../../support/electron-api'

const mockUpdateGlobal = vi.fn()

const globalSettings: GlobalSettingsValue = {
  ...DEFAULT_GLOBAL_SETTINGS,
  appearance: { theme: 'dark' },
  terminal: {
    ...DEFAULT_GLOBAL_SETTINGS.terminal,
    scrollbackLimit: 5000,
    defaultShell: '/bin/zsh',
  },
  ui: {
    hasSeenWelcome: false,
    editor: '',
    showMetricsBar: false,
    hideSidebarOnHome: true,
    showUsageTab: true,
    homeLayout: 'tasks',
    sidebarMode: 'tree',
  },
  sidebar: { staleAfterMs: 7_200_000 },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateGlobal.mockResolvedValue({ settings: globalSettings })
  resetStore(useSettingsStore, { globalSettings, workspaceSettings: new Map() })
  installElectronApi({
    settings: { updateGlobal: mockUpdateGlobal },
    agents: { known: async () => ({ data: [] }) },
  })
})

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

describe('GlobalSettings — Usage in the sidebar', () => {
  it('is checked by default and saves an off', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    const checkbox = screen.getByRole('checkbox', { name: 'Show Usage in the sidebar' })
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    await user.click(checkbox)
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ ui: { showUsageTab: false } })
  })
})

describe('GlobalSettings — Home layout', () => {
  it('offers Classic and Tasks, shows the saved one, and saves a change', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    const layout = screen.getByRole('combobox', { name: 'Home layout' }) as HTMLSelectElement
    expect(
      within(layout)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Classic', 'Tasks'])
    expect(layout.value).toBe('tasks')
    await user.selectOptions(layout, 'Classic')
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ ui: { homeLayout: 'classic' } })
  })
})

describe('GlobalSettings — Sidebar', () => {
  it('offers Tree and Inbox, starts on Tree, and saves a change', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    const mode = screen.getByRole('combobox', { name: 'Sidebar' }) as HTMLSelectElement
    expect(
      within(mode)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Tree', 'Inbox'])
    expect(mode.value).toBe('tree')
    await user.selectOptions(mode, 'Inbox')
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ ui: { sidebarMode: 'inbox' } })
  })
})

describe('GlobalSettings', () => {
  it('shows loading when globalSettings is null', () => {
    resetStore(useSettingsStore, { globalSettings: null })
    render(<GlobalSettings />)
    expect(screen.getByText('Loading...')).toBeTruthy()
  })

  it('saves the Light theme when it is picked', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    await user.click(screen.getByRole('radio', { name: 'Light' }))
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ appearance: { theme: 'light' } })
  })

  it('saves a scrollback limit inside the allowed range', () => {
    render(<GlobalSettings />)
    const input = screen.getByDisplayValue('5000')
    // The field is controlled and drops out-of-range values, so typing key by
    // key never reaches 8000 (8, 80, 800 snap back): set the whole value.
    fireEvent.change(input, { target: { value: '8000' } })
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ terminal: { scrollbackLimit: 8000 } })
  })
})

// The scrollback field is controlled and drops out-of-range values, so these
// set the whole value with fireEvent.change rather than type key by key.
describe('GlobalSettings — scrollback range and text fields', () => {
  it.each([
    ['below the minimum', '500'],
    ['above the maximum', '200000'],
  ])('does not save a scrollback limit %s', (_case, limit) => {
    render(<GlobalSettings />)
    const input = screen.getByDisplayValue('5000')
    fireEvent.change(input, { target: { value: limit } })
    expect(mockUpdateGlobal).not.toHaveBeenCalled()
  })

  it('saves the worktree base directory when the field loses focus', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    const worktreeInput = screen.getByPlaceholderText('Leave empty to use <repo>/.worktrees')
    await user.type(worktreeInput, '/my/worktrees')
    await user.tab()
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ git: { worktreeBaseDir: '/my/worktrees' } })
  })

  it('saves a changed default shell when the field loses focus', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    const shellInput = screen.getAllByRole('textbox')[0]
    await user.clear(shellInput)
    await user.type(shellInput, '/bin/bash')
    await user.tab()
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ terminal: { defaultShell: '/bin/bash' } })
  })
})

describe('GlobalSettings — terminal and branch preferences', () => {
  it('saves the metrics bar as shown when its checkbox is checked', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    const checkbox = screen.getByRole('checkbox', { name: /show cpu/i })
    await user.click(checkbox)
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ ui: { showMetricsBar: true } })
  })

  it('saves the trimmed, non-empty branch patterns when the textarea loses focus', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    const textarea = screen.getByPlaceholderText(/gh-readonly-queue/i)
    await user.clear(textarea)
    await user.type(textarea, 'renovate/*{Enter}{Enter}  release/*  ')
    await user.tab()
    expect(mockUpdateGlobal).toHaveBeenCalledWith({
      git: { branchExcludePatterns: ['renovate/*', 'release/*'] },
    })
  })

  it('saves prompt-for-name as on when its checkbox is checked', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    const checkbox = screen.getByRole('checkbox', { name: /prompt for session name/i })
    await user.click(checkbox)
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ terminal: { promptForName: true } })
  })
})

describe('GlobalSettings — Notifications', () => {
  it('renders the default target checkboxes, all checked by default', () => {
    render(<GlobalSettings />)
    expect(screen.getAllByRole('checkbox', { name: 'System' })[0]).toHaveProperty('checked', true)
    expect(screen.getAllByRole('checkbox', { name: 'In-App' })[0]).toHaveProperty('checked', true)
    expect(screen.getAllByRole('checkbox', { name: 'Toast' })[0]).toHaveProperty('checked', true)
  })

  it('unchecking a default target removes it from the array', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    await user.click(screen.getAllByRole('checkbox', { name: 'System' })[0])
    expect(mockUpdateGlobal).toHaveBeenCalledWith({
      notifications: { defaultTargets: ['center', 'toast'] },
    })
  })
})

describe('GlobalSettings — Notifications — checking an absent default target adds it back', () => {
  it('checking an absent default target adds it back', async () => {
    const user = userEvent.setup()
    resetStore(useSettingsStore, {
      globalSettings: {
        ...globalSettings,
        notifications: { defaultTargets: ['toast'], overrides: {} },
      },
    })
    render(<GlobalSettings />)
    await user.click(screen.getAllByRole('checkbox', { name: 'System' })[0])
    expect(mockUpdateGlobal).toHaveBeenCalledWith({
      notifications: { defaultTargets: ['toast', 'system'] },
    })
  })

  it('renders a per-notification override row for each core notification kind', () => {
    render(<GlobalSettings />)
    expect(screen.getByText('Terminal bell (session needs attention)')).toBeTruthy()
    expect(screen.getByText('Branch switch failed')).toBeTruthy()
    expect(screen.getByText('Extension install failed')).toBeTruthy()
  })
})

describe('GlobalSettings — Notifications — checking a target on a core notification override row saves that override', () => {
  it('checking a target on a core notification override row saves that override', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    const row = screen.getByText('Terminal bell (session needs attention)').closest('div')!
    const systemCheckbox = within(row.parentElement as HTMLElement).getAllByRole('checkbox')[0]
    await user.click(systemCheckbox)
    expect(mockUpdateGlobal).toHaveBeenCalledWith({
      notifications: { overrides: { terminalBell: ['system'] } },
    })
  })
})

describe('GlobalSettings — mounts the Quick actions section', () => {
  it('mounts the Quick actions section', () => {
    render(<GlobalSettings />)
    expect(screen.getByText('Quick actions')).toBeTruthy()
    expect(screen.getByText('Add action')).toBeTruthy()
  })
})

const field = () => screen.getByLabelText('Mark sessions stale after (minutes)')

describe('GlobalSettings — staleness threshold (FR-020)', () => {
  it('shows the current threshold in minutes', () => {
    render(<GlobalSettings />)
    expect((field() as HTMLInputElement).value).toBe('120')
  })

  it('saves a changed threshold as milliseconds', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    await user.clear(field())
    await user.type(field(), '30')
    await user.tab()
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ sidebar: { staleAfterMs: 1_800_000 } })
  })

  it('accepts the one-minute minimum', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    await user.clear(field())
    await user.type(field(), '1')
    await user.tab()
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ sidebar: { staleAfterMs: 60_000 } })
  })
})

describe('GlobalSettings — staleness threshold (FR-020) — out of range', () => {
  it('rejects zero rather than making every session stale', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    await user.clear(field())
    await user.type(field(), '0')
    await user.tab()
    expect(mockUpdateGlobal).not.toHaveBeenCalled()
  })

  it('rejects a value beyond thirty days', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    await user.clear(field())
    await user.type(field(), '43201')
    await user.tab()
    expect(mockUpdateGlobal).not.toHaveBeenCalled()
  })
})

describe('GlobalSettings — staleness threshold (FR-020) — rejects a non-numeric entry', () => {
  it('rejects a non-numeric entry', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    await user.clear(field())
    await user.tab()
    expect(mockUpdateGlobal).not.toHaveBeenCalled()
  })

  it('rounds a fractional entry to whole minutes', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    await user.clear(field())
    await user.type(field(), '2.6')
    await user.tab()
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ sidebar: { staleAfterMs: 180_000 } })
  })
})

describe('GlobalSettings — values left unset', () => {
  it('keeps the default shell when the field is cleared', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    const shellInput = screen.getAllByRole('textbox')[0]
    await user.clear(shellInput)
    await user.type(shellInput, '   ')
    await user.tab()
    expect(mockUpdateGlobal).not.toHaveBeenCalled()
  })
})

describe('GlobalSettings — hide the branch tree on home', () => {
  it('is checked by default and writes the unchecked value when toggled', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    const checkbox = screen.getByRole('checkbox', { name: /hide the branch tree on home/i })
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Press ⌘B to show it')).toBeTruthy()
    await user.click(checkbox)
    expect(mockUpdateGlobal).toHaveBeenCalledWith({ ui: { hideSidebarOnHome: false } })
  })
})

describe('GlobalSettings — Delete closed sessions after', () => {
  const hoursField = (): HTMLInputElement =>
    screen.getByRole('spinbutton', { name: /Delete closed sessions after/ }) as HTMLInputElement

  it('shows the 24-hour default and saves a new number of hours', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    expect(hoursField().value).toBe('24')
    await user.clear(hoursField())
    await user.type(hoursField(), '48')
    expect(mockUpdateGlobal).toHaveBeenLastCalledWith({ sessions: { deleteClosedAfterHours: 48 } })
  })

  it.each(['0', '721'])('never saves %s hours, outside one hour to thirty days', async (hours) => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    await user.clear(hoursField())
    await user.type(hoursField(), hours)
    expect(mockUpdateGlobal).not.toHaveBeenCalledWith({
      sessions: { deleteClosedAfterHours: Number(hours) },
    })
  })
})
