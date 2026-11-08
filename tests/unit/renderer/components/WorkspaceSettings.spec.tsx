import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { WorkspaceSettings } from '../../../../src/renderer/components/settings/WorkspaceSettings'
import { seedStore, workspaceFixture } from '../../../support/renderer-stores'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'
import type {
  GlobalSettings as GlobalSettingsValue,
  WorkspaceSettings as WorkspaceSettingsValue,
} from '../../../../src/shared/types'
import { installElectronApi } from '../../../support/electron-api'

const updateWorkspace = vi.fn()

const globalSettings: GlobalSettingsValue = {
  ...DEFAULT_GLOBAL_SETTINGS,
  appearance: { theme: 'dark' },
  terminal: {
    ...DEFAULT_GLOBAL_SETTINGS.terminal,
    scrollbackLimit: 5000,
    defaultShell: '/bin/zsh',
  },
}

/** Main's settings API, holding this workspace's stored overrides. */
function installSettings(overrides: WorkspaceSettingsValue['overrides'] = {}): void {
  const stored: WorkspaceSettingsValue = { workspaceId: 'ws-1', extensions: {}, overrides }
  updateWorkspace.mockResolvedValue({ settings: stored })
  installElectronApi({
    settings: {
      getGlobal: vi.fn(async () => ({ settings: globalSettings })),
      getWorkspace: vi.fn(async () => ({ settings: stored })),
      updateWorkspace,
    },
    // No extension declares a workspace-scoped setting here; WorkspaceExtensionSettings.spec covers those.
    extension: {
      getSettingsSchemas: vi.fn(async () => ({ schemas: [] })),
      getSettingsValues: vi.fn(async () => ({ values: {} })),
      onListChanged: vi.fn(() => () => {}),
    },
  })
  useSettingsStore.setState({
    ...useSettingsStore.getInitialState(),
    globalSettings,
    workspaceSettings: new Map([['ws-1', stored]]),
  })
}

/** The settings field whose heading is `label`. */
const fieldOf = (label: string): HTMLElement => screen.getByText(label).parentElement!

beforeEach(() => {
  vi.clearAllMocks()
  installSettings()
  seedStore(useWorkspaceStore, {
    workspaces: [workspaceFixture({ id: 'ws-1', name: 'My Workspace' })],
  })
})

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

describe('WorkspaceSettings', () => {
  it('shows loading when globalSettings is null', () => {
    useSettingsStore.setState({ globalSettings: null })
    window.electronAPI.settings.getGlobal = vi.fn(() => new Promise<never>(() => {}))
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(screen.getByText('Loading...')).not.toBeNull()
  })

  it('renders workspace name in title', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(screen.getByText(/Settings for: My Workspace/)).not.toBeNull()
  })

  it('shows workspaceId when workspace not found', () => {
    seedStore(useWorkspaceStore, { workspaces: [] })
    render(<WorkspaceSettings workspaceId="ws-unknown" />)
    expect(screen.getByText(/Settings for: ws-unknown/)).not.toBeNull()
  })

  it("loads the workspace's stored theme on mount", async () => {
    installSettingsOnlyInMain({ appearance: { theme: 'light' } })
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const light = await screen.findByRole('radio', { name: 'Light', checked: true })
    expect(light).not.toBeNull()
  })
})

/** Main holds `overrides` for ws-1; the renderer store has not loaded them yet. */
function installSettingsOnlyInMain(overrides: WorkspaceSettingsValue['overrides']): void {
  installSettings(overrides)
  useSettingsStore.setState({ workspaceSettings: new Map() })
}

describe('WorkspaceSettings — the theme', () => {
  it('offers dark, light and the global default', () => {
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const radios = within(fieldOf('Theme')).getAllByRole('radio')
    expect(radios.map((radio) => radio.parentElement!.textContent)).toEqual([
      'Dark',
      'Light',
      'Use global default',
    ])
  })

  it('saves the theme the user picks', async () => {
    const user = userEvent.setup()
    render(<WorkspaceSettings workspaceId="ws-1" />)
    await user.click(within(fieldOf('Theme')).getByRole('radio', { name: 'Light' }))
    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', { appearance: { theme: 'light' } })
  })

  it('clears the theme override with "Use global default"', async () => {
    const user = userEvent.setup()
    installSettings({ appearance: { theme: 'light' } })
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const field = fieldOf('Theme')
    await user.click(within(field).getByRole('radio', { name: 'Use global default' }))
    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', { appearance: undefined })
  })
})

/** Replaces the scrollback field's whole value, as one paste over the selection. */
async function enterScrollback(user: ReturnType<typeof userEvent.setup>, value: string) {
  const input = within(fieldOf('Scrollback Limit')).getByRole('spinbutton')
  await user.tripleClick(input)
  await user.paste(value)
}

describe('WorkspaceSettings — the scrollback limit', () => {
  it('saves a value within range', async () => {
    const user = userEvent.setup()
    render(<WorkspaceSettings workspaceId="ws-1" />)
    await enterScrollback(user, '8000')
    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', { terminal: { scrollbackLimit: 8000 } })
  })

  it('does not save a value below 1000', async () => {
    const user = userEvent.setup()
    render(<WorkspaceSettings workspaceId="ws-1" />)
    await enterScrollback(user, '100')
    expect(updateWorkspace).not.toHaveBeenCalled()
  })

  it('clears the scrollback override with "Use global default"', async () => {
    const user = userEvent.setup()
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const field = fieldOf('Scrollback Limit')
    await user.click(within(field).getByRole('button', { name: 'Use global default' }))
    // Only the scrollback: the workspace's own shell, if it sets one, stays.
    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', {
      terminal: { scrollbackLimit: undefined },
    })
  })
})

describe('WorkspaceSettings — the worktree base directory', () => {
  const worktreeBox = () => screen.getByPlaceholderText('Leave empty to use <repo>/.worktrees')

  it('hands an emptied directory back to the global one on blur', async () => {
    const user = userEvent.setup()
    render(<WorkspaceSettings workspaceId="ws-1" />)
    await user.click(worktreeBox())
    await user.tab()
    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', { git: { worktreeBaseDir: undefined } })
  })

  it('saves the trimmed directory on blur', async () => {
    const user = userEvent.setup()
    render(<WorkspaceSettings workspaceId="ws-1" />)
    await user.type(worktreeBox(), '  /custom/dir  ')
    await user.tab()
    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', {
      git: { worktreeBaseDir: '/custom/dir' },
    })
  })

  it('clears a directory override with "Use global default"', async () => {
    const user = userEvent.setup()
    installSettings({ git: { worktreeBaseDir: '/custom' } })
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const field = fieldOf('Worktree Base Directory')
    await user.click(within(field).getByRole('button', { name: 'Use global default' }))
    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', { git: { worktreeBaseDir: undefined } })
  })
})

describe('WorkspaceSettings — the branch exclude patterns', () => {
  const patternsBox = () => screen.getByPlaceholderText(/gh-readonly-queue/)

  it('saves one pattern per line on blur', async () => {
    const user = userEvent.setup()
    render(<WorkspaceSettings workspaceId="ws-1" />)
    await user.type(patternsBox(), 'gh-readonly-queue/*{Enter}renovate/*')
    await user.tab()
    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', {
      git: { branchExcludePatterns: ['gh-readonly-queue/*', 'renovate/*'] },
    })
  })

  it('hands blank patterns back to the global ones on blur', async () => {
    const user = userEvent.setup()
    render(<WorkspaceSettings workspaceId="ws-1" />)
    await user.type(patternsBox(), '   ')
    await user.tab()
    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', {
      git: { branchExcludePatterns: undefined },
    })
  })
})

describe('WorkspaceSettings — the branch exclude patterns override', () => {
  it('clears a patterns override with "Use global default"', async () => {
    const user = userEvent.setup()
    installSettings({ git: { branchExcludePatterns: ['renovate/*'] } })
    render(<WorkspaceSettings workspaceId="ws-1" />)
    const field = fieldOf('Branch Exclude Patterns')
    await user.click(within(field).getByRole('button', { name: 'Use global default' }))
    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', {
      git: { branchExcludePatterns: undefined },
    })
  })
})

describe('WorkspaceSettings — mounts the Quick actions section scoped to the workspace', () => {
  it('saves a new quick action to this workspace', async () => {
    const user = userEvent.setup()
    render(<WorkspaceSettings workspaceId="ws-1" />)
    await user.click(screen.getByRole('button', { name: 'Add action' }))
    await user.type(screen.getByLabelText('Label'), 'Deploy')
    await user.type(screen.getByLabelText('Body'), 'echo deploy')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', {
      quickActions: { custom: [expect.objectContaining({ label: 'Deploy' })] },
    })
  })
})

describe("WorkspaceSettings — the workspace's own default shell", () => {
  const shellBox = () => screen.getByRole('textbox', { name: 'Default Shell' }) as HTMLInputElement

  it('shows the global shell until the workspace sets its own, then saves that one', async () => {
    const user = userEvent.setup()
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(shellBox().value).toBe('/bin/zsh')

    await user.clear(shellBox())
    await user.type(shellBox(), '  /bin/fish ')
    await user.tab()

    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', {
      terminal: { defaultShell: '/bin/fish' },
    })
  })

  it('hands the shell back to the global one with "Use global default"', async () => {
    const user = userEvent.setup()
    installSettings({ terminal: { defaultShell: '/bin/fish' } })
    render(<WorkspaceSettings workspaceId="ws-1" />)
    expect(shellBox().value).toBe('/bin/fish')

    const field = shellBox().closest('div')!
    await user.click(within(field).getByRole('button', { name: 'Use global default' }))

    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', { terminal: { defaultShell: undefined } })
  })
})
