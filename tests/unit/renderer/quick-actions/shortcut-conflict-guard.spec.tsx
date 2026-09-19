import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useTerminalSession } from '../../../../src/renderer/hooks/useTerminalSession'
import { CORE_SHORTCUTS } from '../../../../src/renderer/quick-actions/core-actions'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: Object.assign(vi.fn(), { getState: vi.fn() }),
}))
vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: Object.assign(vi.fn(), { getState: vi.fn() }),
}))
vi.mock('../../../../src/renderer/stores/settings.store', () => ({ useSettingsStore: vi.fn() }))
vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: vi.fn(),
  matchesAccelerator: vi.fn().mockReturnValue(false),
}))
vi.mock('../../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: vi.fn(),
}))

const workspace1 = { id: 'ws-1', name: 'WS 1', folderPath: '/ws1', color: '#fff', tags: [] }

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    terminal: { input: vi.fn() },
  }
  vi.mocked(useWorkspaceStore).mockReturnValue({
    workspaces: [workspace1],
    activeWorkspaceId: 'ws-1',
    setActiveWorkspace: vi.fn(),
    activeProjectId: 'proj-1',
    resolveActiveCwd: vi.fn().mockReturnValue('/ws1'),
    setExpandedWorkspaceIds: vi.fn(),
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useSessionStore).mockReturnValue({
    getActiveSessionForProject: vi.fn().mockReturnValue('ses-1'),
    setActiveSessionForProject: vi.fn(),
    getSessionsForProject: vi.fn().mockReturnValue([{ id: 'ses-1' }, { id: 'ses-2' }]),
    getPaneLayout: vi.fn().mockReturnValue(null),
    getFocusedSession: vi.fn().mockReturnValue(null),
    closeSplitLeaf: vi.fn(),
    closeSession: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useSessionStore>)
  vi.mocked(useWorkspaceStore.getState).mockReturnValue({
    setActiveProject: vi.fn(),
  } as unknown as ReturnType<typeof useWorkspaceStore.getState>)
  vi.mocked(useSessionStore.getState).mockReturnValue({
    sessions: new Map(),
  } as unknown as ReturnType<typeof useSessionStore.getState>)
  vi.mocked(useSettingsStore).mockReturnValue({
    resolveSettings: vi.fn().mockReturnValue({ terminal: { scrollbackLimit: 5000 } }),
  } as unknown as ReturnType<typeof useSettingsStore>)
  vi.mocked(useExtensionRegistry).mockReturnValue({
    keyboardShortcuts: [],
  } as unknown as ReturnType<typeof useExtensionRegistry>)
  vi.mocked(useTerminalSession).mockReturnValue({
    createSession: vi.fn().mockResolvedValue('session-id'),
    splitSession: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useTerminalSession>)
})

// A menu accelerator has no renderer keydown (e.g. Cmd+`, Cmd+B), so this
// guard only covers entries the hook itself handles.
const MENU_ONLY = new Set(['core.open-home', 'core.toggle-sidebar'])
const HOOK_HANDLED = new Set(
  CORE_SHORTCUTS.map((s) => s.actionId).filter((id) => !MENU_ONLY.has(id))
)

describe('CORE_SHORTCUTS conflict guard (AC 4)', () => {
  it('fires onDirectShortcut with the matching action id for every hook-handled entry', async () => {
    const { useKeyboardShortcuts } = await import(
      '../../../../src/renderer/hooks/useKeyboardShortcuts'
    )
    for (const entry of CORE_SHORTCUTS) {
      if (!HOOK_HANDLED.has(entry.actionId)) continue
      const onDirectShortcut = vi.fn()
      const { unmount } = renderHook(() =>
        useKeyboardShortcuts({
          onOpenSettings: vi.fn(),
          onToggleLog: vi.fn(),
          onOpenCommandPalette: vi.fn(),
          onToggleOverview: vi.fn(),
          onNewScratch: vi.fn(),
          onEditSessionNote: vi.fn(),
          onDirectShortcut,
        })
      )
      const sample = { key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }
      const withKey = (
        entry.actionId === 'core.switch-workspace' ? { ...sample, key: '1' } : sample
      ) as typeof sample
      // Reconstruct a KeyboardEvent-shaped input the entry's own matcher accepts.
      let keyEvent = withKey
      for (const candidate of candidatesFor()) {
        if (entry.match(candidate)) {
          keyEvent = candidate
          break
        }
      }
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
  })
})

function candidatesFor() {
  const base = { metaKey: true, ctrlKey: false, altKey: false }
  const keys = [
    'a',
    'b',
    'd',
    'e',
    'i',
    'k',
    'l',
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
  const shiftOptions = [false, true]
  const candidates: {
    key: string
    metaKey: boolean
    ctrlKey: boolean
    shiftKey: boolean
    altKey: boolean
  }[] = []
  for (const key of keys) {
    for (const shiftKey of shiftOptions) {
      candidates.push({ ...base, key, shiftKey })
    }
  }
  return candidates
}
