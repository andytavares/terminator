import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QuickActionsHost } from '../../../../src/renderer/components/QuickActionsHost'
import type { ShellCommands } from '../../../../src/renderer/quick-actions/use-core-quick-actions'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useExtensionCommandsStore } from '../../../../src/renderer/stores/extension-commands.store'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'
import type { CustomAction } from '../../../../src/shared/types'
import { projectOf, resetStore, workspaceOf } from '../../../support/renderer-stores'
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
  })
  resetStore(useSettingsStore)
  withCustom([])
  resetStore(useWorkspaceStore, {
    workspaces: [workspaceOf({ id: 'ws-1', folderPath: '/repo' })],
    projectsByWorkspaceId: new Map([['ws-1', [projectOf({ id: 'p1', workspaceId: 'ws-1' })]]]),
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
        expect.objectContaining({ projectId: 'p1' })
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
