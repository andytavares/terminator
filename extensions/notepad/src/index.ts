import { app } from 'electron'
import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import { initDb, closeDb } from './db/db'
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
    return
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

  disposables.push(
    api.settings.register({
      label: 'Notepad',
      properties: {
        'terminator.notepad.exportPath': {
          type: 'string',
          label: 'Export folder path',
          description: 'Folder to export notes as .md files',
          default: '~/Documents/Terminator Notes',
        },
        'terminator.notepad.commentExportFormat': {
          type: 'string',
          label: 'Comment export format',
          description: 'How to export comments: sidecar, inline, or both',
          default: 'sidecar',
        },
        'terminator.notepad.autosaveMs': {
          type: 'number',
          label: 'Autosave debounce (ms)',
          description: 'Delay before autosaving changes (200–5000 ms)',
          default: 800,
        },
        'terminator.notepad.defaultTags': {
          type: 'string',
          label: 'Default new-note tags',
          description: 'Comma-separated tags to apply to every new note',
          default: '',
        },
        'terminator.notepad.editorFontSize': {
          type: 'number',
          label: 'Editor font size',
          description: 'Font size for the note editor (pt)',
          default: 14,
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
