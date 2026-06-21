import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import { applyNotepadSchema, applyNotepadMigrations } from './db/db'
import { registerNotesIpcHandlers, registerTagsIpcHandlers } from './ipc/notes.ipc'
import { registerCommentsIpcHandlers } from './ipc/comments.ipc'
import { registerSearchIpcHandlers } from './ipc/search.ipc'
import { registerExportIpcHandlers } from './ipc/export.ipc'
import { registerDiagramsIpcHandlers } from './ipc/diagrams.ipc'
import { registerDiagramCommentsIpcHandlers } from './ipc/diagram-comments.ipc'
import { registerFoldersIpcHandlers } from './ipc/folders.ipc'

const disposables: Disposable[] = []

export async function activate(api: ExtensionAPI): Promise<void> {
  try {
    await applyNotepadSchema(api.db)
    await applyNotepadMigrations(api.db)
  } catch (err) {
    console.error('[notepad] Failed to initialize schema:', err)
    api.notifications.showToast(
      'error',
      'Notepad: database schema failed to apply. Restart the app — if the problem persists, check the logs.'
    )
  }

  const disposeNotes = registerNotesIpcHandlers(api.db)
  disposables.push({ dispose: disposeNotes })

  const disposeComments = registerCommentsIpcHandlers(api.db)
  disposables.push({ dispose: disposeComments })

  const disposeTags = registerTagsIpcHandlers(api.db)
  disposables.push({ dispose: disposeTags })

  const disposeSearch = registerSearchIpcHandlers(api.db)
  disposables.push({ dispose: disposeSearch })

  const disposeExport = registerExportIpcHandlers(api.db)
  disposables.push({ dispose: disposeExport })

  const disposeDiagrams = registerDiagramsIpcHandlers(api.db)
  disposables.push({ dispose: disposeDiagrams })

  const disposeDiagramComments = registerDiagramCommentsIpcHandlers(api.db)
  disposables.push({ dispose: disposeDiagramComments })

  const disposeFolders = registerFoldersIpcHandlers(api.db)
  disposables.push({ dispose: disposeFolders })

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
        'terminator.notepad.mcpSidecar': {
          type: 'boolean',
          label: 'Enable MCP sidecar',
          description: 'Let agents read/search notes',
          default: false,
        },
      },
    })
  )

  try {
    const shortcutDisposable = api.globalShortcut.register('CommandOrControl+Shift+N', () => {
      api.window.broadcast('terminator.notepad:ui.openQuickCreate', {})
    })
    disposables.push(shortcutDisposable)
  } catch {
    api.notifications.showToast(
      'warning',
      'Notepad: Could not register Cmd+Shift+N globally — use in-app shortcut instead'
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
}
