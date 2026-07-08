import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import { applyNotepadSchema, applyNotepadMigrations } from './db/db'
import { registerNotesIpcHandlers, registerTagsIpcHandlers } from './ipc/notes.ipc'
import { registerCommentsIpcHandlers } from './ipc/comments.ipc'
import { registerSearchIpcHandlers } from './ipc/search.ipc'
import { registerExportIpcHandlers } from './ipc/export.ipc'
import { registerDiagramsIpcHandlers } from './ipc/diagrams.ipc'
import { registerDiagramCommentsIpcHandlers } from './ipc/diagram-comments.ipc'
import { registerFoldersIpcHandlers } from './ipc/folders.ipc'
import type { SettingDefinition } from '../../../src/main/extensions/api'

// Every notification kind this extension ever raises, so the user can
// independently choose its delivery target(s) (system/in-app/toast) in this
// extension's own settings — core never knows these keys exist (Extension Isolation).
const NOTIFICATION_KEYS: { key: string; label: string }[] = [
  { key: 'schemaInitFailed', label: 'Database schema failed to apply' },
  { key: 'globalShortcutTaken', label: 'Global quick-create shortcut unavailable' },
]

function buildNotificationSettingProperties(): Record<string, SettingDefinition> {
  const properties: Record<string, SettingDefinition> = {}
  for (const { key, label } of NOTIFICATION_KEYS) {
    properties[`terminator.notepad.notify.${key}.system`] = {
      type: 'boolean',
      label: `${label} → System notification`,
      default: true,
    }
    properties[`terminator.notepad.notify.${key}.center`] = {
      type: 'boolean',
      label: `${label} → In-app notification center`,
      default: true,
    }
    properties[`terminator.notepad.notify.${key}.toast`] = {
      type: 'boolean',
      label: `${label} → Toast`,
      default: true,
    }
  }
  return properties
}

const disposables: Disposable[] = []
let _pendingQuickCreate = false
let _pendingQuickCreateTimer: ReturnType<typeof setTimeout> | null = null

export async function activate(api: ExtensionAPI): Promise<void> {
  try {
    await applyNotepadSchema(api.db)
    await applyNotepadMigrations(api.db)
  } catch (err) {
    console.error('[notepad] Failed to initialize schema:', err)
    api.notifications.showToast(
      'error',
      'Notepad: database schema failed to apply. Restart the app — if the problem persists, check the logs.',
      'schemaInitFailed'
    )
  }

  const disposeNotes = registerNotesIpcHandlers(api, api.db)
  disposables.push({ dispose: disposeNotes })

  const disposeComments = registerCommentsIpcHandlers(api, api.db)
  disposables.push({ dispose: disposeComments })

  const disposeTags = registerTagsIpcHandlers(api, api.db)
  disposables.push({ dispose: disposeTags })

  const disposeSearch = registerSearchIpcHandlers(api, api.db)
  disposables.push({ dispose: disposeSearch })

  const disposeExport = registerExportIpcHandlers(api, api.db)
  disposables.push({ dispose: disposeExport })

  const disposeDiagrams = registerDiagramsIpcHandlers(api, api.db)
  disposables.push({ dispose: disposeDiagrams })

  // Open note/diagram in a dedicated auxiliary window using the extension's own renderer.
  // Using api.window.openAuxiliary ensures the extension renderer URL (ext://terminator.notepad/…)
  // is loaded rather than the main app URL — which would trigger ExtensionPanelPortal and
  // wrongly attach the WebContentsView to the main window.
  disposables.push(
    api.ipc.registerHandler('terminator.notepad:notes.openWindow', (payload) => {
      const { id } = (payload ?? {}) as { id?: string }
      if (!id) return { error: 'VALIDATION_ERROR' }
      // Unique key per note so each note gets its own window; passing view:'note' in params
      // overrides the view key that openAuxiliary would derive from the first argument.
      api.window.openAuxiliary(`notepad-note-${id}`, { view: 'note', noteId: id })
      return { data: { ok: true } }
    })
  )

  disposables.push(
    api.ipc.registerHandler('terminator.notepad:diagrams.openWindow', (payload) => {
      const { id } = (payload ?? {}) as { id?: string }
      if (!id) return { error: 'VALIDATION_ERROR' }
      api.window.openAuxiliary(`notepad-diagram-${id}`, { view: 'diagram', diagramId: id })
      return { data: { ok: true } }
    })
  )

  const disposeDiagramComments = registerDiagramCommentsIpcHandlers(api, api.db)
  disposables.push({ dispose: disposeDiagramComments })

  const disposeFolders = registerFoldersIpcHandlers(api, api.db)
  disposables.push({ dispose: disposeFolders })

  const disposeDbReinit = api.ipc.registerHandler('terminator.notepad:db.reinit', async () => {
    try {
      await applyNotepadSchema(api.db)
      await applyNotepadMigrations(api.db)
      return { data: { ok: true } }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
  disposables.push(disposeDbReinit)

  disposables.push(
    api.settings.register({
      label: 'Notepad',
      description: 'Markdown notes with live preview, comments, and export.',
      properties: {
        'terminator.notepad.exportPath': {
          type: 'folder',
          label: 'Export folder',
          description: 'Where "Export" writes .md files',
          default: '~/Documents/Terminator Notes',
        },
        'terminator.notepad.commentExportFormat': {
          type: 'enum',
          label: 'Export comments as',
          description: 'Format for comment export',
          default: 'sidecar',
          options: ['sidecar', 'inline', 'both'],
        },
        'terminator.notepad.autosaveMs': {
          type: 'number',
          label: 'Autosave debounce',
          description: 'Idle delay before write (ms)',
          default: 800,
        },
        'terminator.notepad.defaultTags': {
          type: 'string',
          label: 'Default tags for new notes',
          description: 'Applied on quick-create',
          default: '',
        },
        'terminator.notepad.editorFontSize': {
          type: 'number',
          label: 'Editor font size',
          description: 'Font size in pixels',
          default: 14,
        },
        'terminator.notepad.db.reinit': {
          type: 'action',
          label: 'Re-initialise database',
          description: 'Re-apply schema and migrations without deleting data',
          channel: 'terminator.notepad:db.reinit',
        },
        'terminator.notepad.mcpSidecar': {
          type: 'boolean',
          label: 'Enable MCP sidecar',
          description: 'Let agents read/search notes',
          default: false,
        },
        ...buildNotificationSettingProperties(),
      },
    })
  )

  // Renderer calls this on mount to pick up a quick-create triggered before the view existed.
  disposables.push(
    api.ipc.registerHandler('terminator.notepad:ui.consumePendingQuickCreate', () => {
      const pending = _pendingQuickCreate
      _pendingQuickCreate = false
      if (_pendingQuickCreateTimer !== null) {
        clearTimeout(_pendingQuickCreateTimer)
        _pendingQuickCreateTimer = null
      }
      return { data: { pending } }
    })
  )

  try {
    const shortcutDisposable = api.globalShortcut.register('CommandOrControl+Shift+N', () => {
      // Broadcast to any already-running extension view immediately.
      api.window.broadcast('terminator.notepad:ui.openQuickCreate', {})
      // Activate the notepad tab — this creates the WebContentsView if it doesn't exist yet.
      api.window.broadcast('extension:activate-global-tab', 'terminator.notepad')
      // Set pending flag so the renderer shows the overlay on first load.
      // Auto-expire after 5 s so a late manual panel open doesn't surprise the user.
      _pendingQuickCreate = true
      if (_pendingQuickCreateTimer !== null) clearTimeout(_pendingQuickCreateTimer)
      _pendingQuickCreateTimer = setTimeout(() => {
        _pendingQuickCreate = false
        _pendingQuickCreateTimer = null
      }, 5000)
    })
    disposables.push(shortcutDisposable)
  } catch {
    api.notifications.showToast(
      'warning',
      'Notepad: Could not register Cmd+Shift+N globally — use in-app shortcut instead',
      'globalShortcutTaken'
    )
  }

  // T041: Sole registration point for Cmd+Opt+M — toggles comment margin
  try {
    const commentToggleDisposable = api.globalShortcut.register('CommandOrControl+Alt+M', () => {
      api.window.broadcast('terminator.notepad:ui.toggleComments', {})
    })
    disposables.push(commentToggleDisposable)
  } catch {
    console.warn('[notepad] Could not register Cmd+Alt+M for comment margin toggle')
  }

  try {
    const searchDisposable = api.globalShortcut.register('CommandOrControl+Shift+F', () => {
      api.window.broadcast('terminator.notepad:ui.openSearch', {})
    })
    disposables.push(searchDisposable)
  } catch {
    console.warn('[notepad] Could not register Cmd+Shift+F for search')
  }

  disposables.push(
    api.nativeMenu.addViewMenuItem({
      id: 'notepad-new-note',
      label: 'New Note',
      accelerator: 'CmdOrCtrl+Shift+N',
      onClick: () => {
        api.window.broadcast('terminator.notepad:ui.openQuickCreate', {})
      },
    })
  )
}

export function deactivate(): void {
  for (const d of disposables) d.dispose()
  disposables.length = 0
  _pendingQuickCreate = false
  if (_pendingQuickCreateTimer !== null) {
    clearTimeout(_pendingQuickCreateTimer)
    _pendingQuickCreateTimer = null
  }
}
