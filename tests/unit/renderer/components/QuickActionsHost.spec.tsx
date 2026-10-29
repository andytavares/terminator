import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// This spec checks the IPC payload, so it runs the real recorder (tests/setup.ts mocks it).
vi.unmock('../../../../src/renderer/usage/record')
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
const updateQuickActions = vi.fn(async () => {})
const onClose = vi.fn()

function withCustom(custom: CustomAction[], pins: string[] = []): void {
  useSettingsStore.setState({
    globalSettings: {
      ...DEFAULT_GLOBAL_SETTINGS,
      quickActions: { pins, usage: [], directUse: [], custom },
    },
    updateQuickActions,
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

/** Searches the open palette and runs the first match, as Enter would. */
function runFound(label: string): void {
  fireEvent.keyDown(window, { key: '/' })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: label } })
  fireEvent.keyDown(window, { key: 'Enter' })
}

describe('QuickActionsHost — extension commands', () => {
  it('runs a command the renderer registered, closing the palette first', async () => {
    const action = vi.fn()
    useExtensionRegistry
      .getState()
      .registerCommand({ id: 'x.ping', label: 'Ping the thing', category: 'X', action })
    renderHost()
    runFound('Ping the thing')
    expect(onClose).toHaveBeenCalled()
    await waitFor(() => expect(action).toHaveBeenCalled())
  })

  it('asks main to run a command an extension registered, with where it was run', async () => {
    api.getCommands.mockResolvedValue({
      commands: [{ key: 'ext:hello', extensionId: 'ext', id: 'hello', label: 'Say hello' }],
    })
    renderHost()
    fireEvent.keyDown(window, { key: '/' })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Say hello' } })
    await screen.findByText('Say hello')
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() =>
      expect(api.executeCommand).toHaveBeenCalledWith(
        'ext:hello',
        expect.objectContaining({ projectId: 'p1', via: 'palette' })
      )
    )
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
    runFound('Run the tests')
    await waitFor(() => expect(api.input).toHaveBeenCalledWith('new-session', expect.any(String)))
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', type: 'human', title: '' })
    )
  })
})

describe('QuickActionsHost — pins', () => {
  it('pins an action from its row', () => {
    withCustom([runTests])
    renderHost()
    fireEvent.keyDown(window, { key: '/' })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Run the tests' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pin Run the tests' }))
    expect(updateQuickActions).toHaveBeenCalledWith({ pins: ['custom:c1'] })
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
    runFound('Toggle sidebar')
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
    runFound('Boom now')
    await waitFor(() =>
      expect(recorded()).toContainEqual(
        expect.objectContaining({ feature: 'renderer:x.boom', via: 'palette', failed: true })
      )
    )
  })

  it('leaves an extension command to main', async () => {
    api.getCommands.mockResolvedValue({
      commands: [{ key: 'ext:hello', extensionId: 'ext', id: 'hello', label: 'Say hello' }],
    })
    renderHost()
    fireEvent.keyDown(window, { key: '/' })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Say hello' } })
    await screen.findByText('Say hello')
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(api.executeCommand).toHaveBeenCalled())
    expect(recorded().map((r) => r.feature)).not.toContain('ext:ext.command.hello')
  })
})

describe('QuickActionsHost — usage of custom actions and pins', () => {
  it('counts every custom action as one feature, without its name', async () => {
    withCustom([runTests])
    renderHost()
    runFound('Run the tests')
    await waitFor(() => expect(api.input).toHaveBeenCalled())
    expect(recorded()).toContainEqual({
      feature: 'core.custom-action',
      via: 'palette',
      declare: { label: 'Custom action', kind: 'action', source: 'core' },
    })
    expect(JSON.stringify(recorded())).not.toContain('Run the tests')
  })

  it('counts a pin', () => {
    withCustom([runTests])
    renderHost()
    fireEvent.keyDown(window, { key: '/' })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Run the tests' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pin Run the tests' }))
    expect(recorded().map((r) => r.feature)).toContain('core.quick-actions.pin')
  })
})

describe('paletteFeature', () => {
  it('counts a session under one fixed id, without its title', () => {
    expect(paletteFeature({ id: 'session:abc123', label: 'fix login bug' })).toEqual([
      'core.go-to-session',
      'Go to session',
    ])
  })

  it('counts a workspace switch under one fixed id', () => {
    expect(paletteFeature({ id: 'core.switch-workspace-ws9', label: 'Acme' })).toEqual([
      'core.switch-workspace',
      'Switch workspace',
    ])
  })

  it('leaves extension commands to main and keeps a core action as it is', () => {
    expect(paletteFeature({ id: 'ext:terminator.notepad.command.x', label: 'New' })).toBeNull()
    expect(paletteFeature({ id: 'core.split-vertical', label: 'Split' })).toEqual([
      'core.split-vertical',
      'Split',
    ])
  })
})
