import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// This spec checks the IPC payload, so it runs the real recorder (tests/setup.ts mocks it).
vi.unmock('../../../../src/renderer/usage/record')
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import {
  QuickActionsHost,
  paletteFeature,
} from '../../../../src/renderer/components/QuickActionsHost'
import type { ShellCommands } from '../../../../src/renderer/quick-actions/use-core-quick-actions'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useExtensionCommandsStore } from '../../../../src/renderer/stores/extension-commands.store'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'
import type { CustomAction } from '../../../../src/shared/types'
import { projectFixture, resetStore, workspaceFixture } from '../../../support/renderer-stores'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import { installElectronApi } from '../../../support/electron-api'

vi.mock('../../../../src/renderer/components/QuickActions.css', () => ({}))
vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => [],
  useIssue: () => null,
}))
const createSession = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: () => ({ createSession, splitSession: vi.fn() }),
}))

// jsdom doesn't implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn()

const shell: ShellCommands = {
  onNewTab: vi.fn(),
  onNewScratch: vi.fn(),
  onEditNote: vi.fn(),
  onLinkSession: vi.fn(),
  onToggleOverview: vi.fn(),
  onToggleSidebar: vi.fn(),
  onOpenSettings: vi.fn(),
  onToggleLog: vi.fn(),
}

const api = {
  getCommands: vi.fn(),
  list: vi.fn(),
  executeCommand: vi.fn(),
  input: vi.fn(),
}
const recordUse = vi.fn<ElectronAPI['usage']['recordUse']>(async () => ({ data: true as const }))
/** Main's answer to a settings save: the stored settings with the quick actions patch applied. */
const updateGlobal = vi.fn<ElectronAPI['settings']['updateGlobal']>(async (patch) => {
  const current = useSettingsStore.getState().globalSettings ?? DEFAULT_GLOBAL_SETTINGS
  const { quickActions } = patch as { quickActions: Partial<typeof current.quickActions> }
  return { settings: { ...current, quickActions: { ...current.quickActions, ...quickActions } } }
})
const onClose = vi.fn()

function withCustom(custom: CustomAction[], pins: string[] = []): void {
  useSettingsStore.setState({
    globalSettings: {
      ...DEFAULT_GLOBAL_SETTINGS,
      quickActions: { pins, usage: [], directUse: [], custom },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getCommands.mockResolvedValue({ commands: [] })
  api.list.mockResolvedValue({ extensions: [] })
  createSession.mockResolvedValue('new-session')
  installElectronApi({
    extension: {
      getCommands: api.getCommands,
      list: api.list,
      executeCommand: api.executeCommand,
    },
    terminal: { input: api.input },
    usage: { recordUse, declare: vi.fn() },
    settings: { updateGlobal },
  })
  resetStore(useSettingsStore)
  withCustom([])
  resetStore(useWorkspaceStore, {
    workspaces: [workspaceFixture({ id: 'ws-1', folderPath: '/repo' })],
    projectsByWorkspaceId: new Map([['ws-1', [projectFixture({ id: 'p1', workspaceId: 'ws-1' })]]]),
    activeWorkspaceId: 'ws-1',
    activeProjectId: 'p1',
  })
  resetStore(useSessionStore)
  resetStore(useToastStore)
  resetStore(useExtensionCommandsStore)
  useExtensionRegistry.setState(useExtensionRegistry.getInitialState(), true)
})

function renderHost(): void {
  render(
    <QuickActionsHost
      openedAt={0}
      searchSignal={0}
      surfaces={[]}
      activateSurface={vi.fn()}
      shell={shell}
      onClose={onClose}
    />
  )
}

/** Presses / to search the open palette and types `label` there. */
async function search(user: UserEvent, label: string): Promise<void> {
  await user.keyboard('/')
  await user.type(screen.getByRole('combobox'), label)
}

/** Searches the open palette and runs the first match with Enter. */
async function runFound(label: string): Promise<void> {
  const user = userEvent.setup()
  await search(user, label)
  expect(screen.getByRole('combobox').matches(':focus')).toBe(true)
  await user.keyboard('{Enter}')
}

describe('QuickActionsHost — extension commands', () => {
  it('runs a command the renderer registered, closing the palette first', async () => {
    const action = vi.fn()
    useExtensionRegistry
      .getState()
      .registerCommand({ id: 'x.ping', label: 'Ping the thing', category: 'X', action })
    renderHost()
    await runFound('Ping the thing')
    expect(onClose).toHaveBeenCalled()
    await waitFor(() => expect(action).toHaveBeenCalled())
  })

  it('asks main to run a command an extension registered, with where it was run, and leaves its count to main', async () => {
    api.getCommands.mockResolvedValue({
      commands: [{ key: 'ext:hello', extensionId: 'ext', id: 'hello', label: 'Say hello' }],
    })
    const user = userEvent.setup()
    renderHost()
    await search(user, 'Say hello')
    await screen.findByText('Say hello')
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(api.executeCommand).toHaveBeenCalledWith(
        'ext:hello',
        expect.objectContaining({ projectId: 'p1', via: 'palette' })
      )
    )
    expect(recorded().map((r) => r.feature)).not.toContain('ext:ext.command.hello')
  })
})

describe('QuickActionsHost — extension commands — still opens when the commands cannot be read, and says so in the log', () => {
  it('still opens when the commands cannot be read, and says so in the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    api.getCommands.mockRejectedValue(new Error('main is gone'))
    renderHost()
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('Could not read extension commands', expect.any(Error))
    )
    expect(screen.getByRole('dialog', { name: 'Quick actions' })).toBeTruthy()
    warn.mockRestore()
  })
})

const runTests: CustomAction = {
  id: 'c1',
  label: 'Run the tests',
  mnemonic: 't',
  kind: 'shell',
  target: 'new-tab',
  body: 'npx vitest run',
}

describe('QuickActionsHost — custom actions', () => {
  it('opens a new terminal on the branch for a new-tab action, then types into it', async () => {
    withCustom([runTests])
    renderHost()
    await runFound('Run the tests')
    await waitFor(() => expect(api.input).toHaveBeenCalledWith('new-session', expect.any(String)))
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', type: 'human', title: '' })
    )
  })
})

describe('QuickActionsHost — pins', () => {
  it('pins an action from its row', async () => {
    const user = userEvent.setup()
    withCustom([runTests])
    renderHost()
    await search(user, 'Run the tests')
    await user.click(screen.getByRole('button', { name: 'Pin Run the tests' }))
    expect(await screen.findByRole('button', { name: 'Unpin Run the tests' })).toBeTruthy()
  })
})

const recorded = () => recordUse.mock.calls.map(([record]) => record)

describe('QuickActionsHost — usage', () => {
  it('counts the palette opening', () => {
    renderHost()
    expect(recorded()).toContainEqual({
      feature: 'core.quick-actions.open',
      via: 'palette',
      declare: { label: 'Open Quick Actions', kind: 'control', source: 'core' },
    })
  })

  it('counts a core action run from the palette, with its label', async () => {
    renderHost()
    await runFound('Toggle sidebar')
    await waitFor(() =>
      expect(recorded()).toContainEqual({
        feature: 'core.toggle-sidebar',
        via: 'palette',
        declare: { label: 'Toggle sidebar', kind: 'action', source: 'core' },
      })
    )
  })
})

describe('QuickActionsHost — usage of runs', () => {
  it('counts a failed run when the action throws', async () => {
    useExtensionRegistry.getState().registerCommand({
      id: 'x.boom',
      label: 'Boom now',
      action: () => {
        throw new Error('boom')
      },
    })
    renderHost()
    await runFound('Boom now')
    await waitFor(() =>
      expect(recorded()).toContainEqual(
        expect.objectContaining({ feature: 'renderer:x.boom', via: 'palette', failed: true })
      )
    )
  })
})

describe('QuickActionsHost — usage of custom actions and pins', () => {
  it('counts every custom action as one feature, without its name', async () => {
    withCustom([runTests])
    renderHost()
    await runFound('Run the tests')
    await waitFor(() => expect(api.input).toHaveBeenCalled())
    expect(recorded()).toContainEqual({
      feature: 'core.custom-action',
      via: 'palette',
      declare: { label: 'Custom action', kind: 'action', source: 'core' },
    })
    expect(JSON.stringify(recorded())).not.toContain('Run the tests')
  })

  it('counts a pin', async () => {
    const user = userEvent.setup()
    withCustom([runTests])
    renderHost()
    await search(user, 'Run the tests')
    await user.click(screen.getByRole('button', { name: 'Pin Run the tests' }))
    expect(recorded().map((r) => r.feature)).toContain('core.quick-actions.pin')
  })
})

describe('paletteFeature', () => {
  it.each([
    ['session:abc123', 'fix login bug', ['core.go-to-session', 'Go to session']],
    ['core.switch-workspace-ws9', 'Acme', ['core.switch-workspace', 'Switch workspace']],
    ['ext:terminator.notepad.command.x', 'New', null],
    ['core.split-vertical', 'Split', ['core.split-vertical', 'Split']],
  ])('counts the palette item %s (%s) as %j', (id, label, feature) => {
    expect(paletteFeature({ id, label })).toEqual(feature)
  })
})

const gitPush = {
  key: 'terminator.git-integration:push',
  extensionId: 'terminator.git-integration',
  id: 'push',
  label: 'Push',
  category: 'Git',
  requires: 'repo' as const,
}

describe('QuickActionsHost — a command that needs a repository', () => {
  it('is dimmed with "No repository focused" when no workspace is open, and does not run', async () => {
    resetStore(useWorkspaceStore)
    api.getCommands.mockResolvedValue({ commands: [gitPush] })
    const user = userEvent.setup()
    renderHost()
    await search(user, 'Push')
    const row = await screen.findByRole('option', { name: /Push/ })
    expect(row.textContent).toContain('No repository focused')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('status').textContent).toContain('No repository focused')
    expect(screen.getByRole('dialog', { name: 'Quick actions' })).toBeTruthy()
    expect(api.executeCommand).not.toHaveBeenCalled()
  })
})

describe('QuickActionsHost — a command that needs a repository, with a branch focused', () => {
  it("runs in the focused branch's worktree", async () => {
    resetStore(useWorkspaceStore, {
      workspaces: [workspaceFixture({ id: 'ws-1', folderPath: '/repo' })],
      projectsByWorkspaceId: new Map([
        ['ws-1', [projectFixture({ id: 'p1', workspaceId: 'ws-1', worktreePath: '/repo-main' })]],
      ]),
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'p1',
    })
    api.getCommands.mockResolvedValue({ commands: [gitPush] })
    const user = userEvent.setup()
    renderHost()
    await search(user, 'Push')
    await screen.findByRole('option', { name: /Push/ })
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(api.executeCommand).toHaveBeenCalledWith(
        gitPush.key,
        expect.objectContaining({ repoRoot: '/repo-main' })
      )
    )
  })
})

describe('QuickActionsHost — recent actions', () => {
  it('lists an action run from the palette under Pinned & recent the next time it opens', async () => {
    renderHost()
    await runFound('Toggle sidebar')
    await waitFor(() => expect(updateGlobal).toHaveBeenCalled())
    cleanup()
    renderHost()
    const recent = screen.getByRole('listbox', { name: 'Pinned & recent' })
    expect(within(recent).getByRole('option', { name: /Toggle sidebar/ })).toBeTruthy()
  })
})
