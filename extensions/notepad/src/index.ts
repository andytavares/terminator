import { app, ipcMain } from 'electron'
import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import { initDb, closeDb, reinitDb, repairDb, resetDb } from './db/db'
import { registerNotesIpcHandlers, registerTagsIpcHandlers } from './ipc/notes.ipc'
import { registerCommentsIpcHandlers } from './ipc/comments.ipc'
import { registerSearchIpcHandlers } from './ipc/search.ipc'
import { registerExportIpcHandlers } from './ipc/export.ipc'

const disposables: Disposable[] = []

export async function activate(api: ExtensionAPI): Promise<void> {
  try {
    initDb(app.getPath('userData'))
  } catch (err) {
    console.error('[notepad] Failed to initialize SQLite DB:', err)
    api.notifications.showToast(
      'error',
      'Notepad: database failed to open. Restart the app — if the problem persists, check the logs.'
    )
  }

  const disposeNotes = registerNotesIpcHandlers()
  disposables.push({ dispose: disposeNotes })

  const disposeComments = registerCommentsIpcHandlers()
  disposables.push({ dispose: disposeComments })

  const disposeTags = registerTagsIpcHandlers()
  disposables.push({ dispose: disposeTags })

  const disposeSearch = registerSearchIpcHandlers()
  disposables.push({ dispose: disposeSearch })

  const disposeExport = registerExportIpcHandlers()
  disposables.push({ dispose: disposeExport })

  ipcMain.handle('terminator.notepad:db.reinit', async () => {
    try {
      reinitDb(app.getPath('userData'))
      return { data: { ok: true } }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('terminator.notepad:db.repair', async () => {
    try {
      const result = repairDb(app.getPath('userData'))
      return { data: result }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('terminator.notepad:db.reset', async () => {
    try {
      resetDb(app.getPath('userData'))
      return { data: { ok: true } }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
  disposables.push({
    dispose: () => {
      ipcMain.removeHandler('terminator.notepad:db.reinit')
      ipcMain.removeHandler('terminator.notepad:db.repair')
      ipcMain.removeHandler('terminator.notepad:db.reset')
    },
  })

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
        'terminator.notepad.db.reinit': {
          type: 'action',
          label: 'Re-initialize',
          description: 'Close and reopen the database connection. Use if notes stop loading.',
          channel: 'terminator.notepad:db.reinit',
          default: null,
        },
        'terminator.notepad.db.repair': {
          type: 'action',
          label: 'Repair',
          description: 'Checkpoint WAL and run VACUUM. Fixes fragmentation without data loss.',
          channel: 'terminator.notepad:db.repair',
          default: null,
        },
        'terminator.notepad.db.reset': {
          type: 'action',
          label: 'Reset (delete all data)',
          description: 'Permanently delete the database and start fresh. All notes will be lost.',
          channel: 'terminator.notepad:db.reset',
          danger: true,
          confirmMessage:
            'This will permanently delete ALL your notes. This cannot be undone. Continue?',
          default: null,
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
  closeDb()
}
