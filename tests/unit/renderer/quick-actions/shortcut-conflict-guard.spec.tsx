import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useTerminalSession } from '../../../../src/renderer/hooks/useTerminalSession'
import { CORE_SHORTCUTS } from '../../../support/quick-actions'
import {
  projectFixture,
  terminalSessionOf,
  workspaceFixture,
} from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'

vi.mock('../../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: vi.fn(),
}))

const workspace1 = workspaceFixture({ id: 'ws-1', name: 'WS 1', folderPath: '/ws1', color: '#fff' })

beforeEach(() => {
  // The app ships for macOS: Cmd is the command key.
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
  vi.clearAllMocks()
  // The real stores, with only the actions that reach the main process replaced.
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getInitialState(),
    workspaces: [workspace1],
    activeWorkspaceId: 'ws-1',
    activeProjectId: 'proj-1',
    projectsByWorkspaceId: new Map([
      ['ws-1', [projectFixture({ id: 'proj-1', workspaceId: 'ws-1' })]],
    ]),
    loadProjects: vi.fn().mockResolvedValue(undefined),
  })
  useSessionStore.setState({
    ...useSessionStore.getInitialState(),
    sessions: new Map([
      ['ses-1', terminalSessionOf({ id: 'ses-1', projectId: 'proj-1' })],
      ['ses-2', terminalSessionOf({ id: 'ses-2', projectId: 'proj-1' })],
    ]),
    projectViews: new Map([['proj-1', { activeSessionId: 'ses-1', terminalCounter: 0 }]]),
    closeSession: vi.fn().mockResolvedValue(undefined),
  })
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useExtensionRegistry.setState(useExtensionRegistry.getInitialState(), true)
  vi.mocked(useTerminalSession).mockReturnValue({
    createSession: vi.fn().mockResolvedValue('session-id'),
    splitSession: vi.fn().mockResolvedValue(undefined),
  })
})

// A menu accelerator has no renderer keydown (e.g. Cmd+Shift+H, Cmd+B), so this
// guard only covers entries the hook itself handles.
const MENU_ONLY = new Set([
  'core.open-home',
  'core.toggle-sidebar',
  'core.break-out',
  'core.open-settings',
  'core.close-tab',
])
const HOOK_HANDLED = new Set(
  CORE_SHORTCUTS.map((s) => s.actionId).filter((id) => !MENU_ONLY.has(id))
)

type ShortcutEntry = (typeof CORE_SHORTCUTS)[number]

const KEYS = [
  'a',
  'b',
  'd',
  'e',
  'i',
  'k',
  'l',
  'n',
  't',
  'w',
  '1',
  '=',
  '-',
  '[',
  ']',
  'ArrowLeft',
  'ArrowRight',
  ',',
  '`',
]

function candidatesFor() {
  return KEYS.flatMap((key) =>
    [false, true].map((shiftKey) => ({
      key,
      shiftKey,
      metaKey: true,
      ctrlKey: false,
      altKey: false,
    }))
  )
}

/** A KeyboardEvent-shaped input the entry's own matcher accepts. */
function keyEventFor(entry: ShortcutEntry) {
  const sample = { key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }
  const withKey = entry.actionId === 'core.switch-workspace' ? { ...sample, key: '1' } : sample
  return candidatesFor().find((candidate) => entry.firedBy(candidate)) ?? withKey
}

async function renderShortcuts(onDirectShortcut: (actionId: string) => void) {
  // ⌘K clears the focused terminal, which reaches the main process.
  installElectronApi({ terminal: { input: vi.fn() } })
  const { useKeyboardShortcuts } = await import(
    '../../../../src/renderer/hooks/useKeyboardShortcuts'
  )
  return renderHook(() =>
    useKeyboardShortcuts({
      onToggleLog: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      onToggleOverview: vi.fn(),
      onNewScratch: vi.fn(),
      onEditSessionNote: vi.fn(),
      onDirectShortcut,
    })
  )
}

const hookHandled = CORE_SHORTCUTS.filter((entry) => HOOK_HANDLED.has(entry.actionId))

describe('CORE_SHORTCUTS conflict guard (AC 4)', () => {
  it.each(hookHandled.map((entry) => [entry.actionId, entry] as const))(
    'fires onDirectShortcut with %s for its own keys',
    async (_actionId, entry) => {
      const onDirectShortcut = vi.fn()
      const { unmount } = await renderShortcuts(onDirectShortcut)
      const keyEvent = keyEventFor(entry)
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: keyEvent.key,
          metaKey: keyEvent.metaKey,
          shiftKey: keyEvent.shiftKey,
          bubbles: true,
        })
      )
      expect(onDirectShortcut, `entry ${entry.actionId}`).toHaveBeenCalledWith(entry.actionId)
      unmount()
    }
  )
})
