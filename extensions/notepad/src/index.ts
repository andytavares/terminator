import { z } from 'zod'
import { defineChannel, noPayload } from '@terminator/extension-sdk'
import type { ExtensionAPI, Disposable, SettingDefinition } from '@terminator/extension-sdk'
import { applyNotepadSchema } from './db/db'
import { registerNotesIpcHandlers, registerTagsIpcHandlers } from './ipc/notes.ipc'
import { registerCommentsIpcHandlers } from './ipc/comments.ipc'
import { registerSearchIpcHandlers } from './ipc/search.ipc'
import { registerExportIpcHandlers } from './ipc/export.ipc'
import { registerDiagramsIpcHandlers } from './ipc/diagrams.ipc'
import { registerDiagramCommentsIpcHandlers } from './ipc/diagram-comments.ipc'
import { registerFoldersIpcHandlers } from './ipc/folders.ipc'
import { VALIDATION_ERROR } from './ipc/register'

/** The note or diagram a dedicated window opens on. */
const WindowTarget = z.object({ id: z.string().min(1) })

// Every notification kind this extension ever raises, so the user can
// independently choose its delivery target(s) (system/in-app/toast) in this
// extension's own settings — core never knows these keys exist (Extension Isolation).
const NOTIFICATION_KEYS: { key: string; label: string }[] = [
  { key: 'schemaInitFailed', label: 'Database schema failed to apply' },
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

// Each registers one group of IPC handlers and returns its cleanup.
const IPC_GROUPS = [
  registerNotesIpcHandlers,
  registerCommentsIpcHandlers,
  registerTagsIpcHandlers,
  registerSearchIpcHandlers,
  registerExportIpcHandlers,
  registerDiagramsIpcHandlers,
  registerDiagramCommentsIpcHandlers,
  registerFoldersIpcHandlers,
]

const NOTEPAD_SETTINGS: Record<string, SettingDefinition> = {
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
    default: null,
  },
  'terminator.notepad.mcpSidecar': {
    type: 'boolean',
    label: 'Enable MCP sidecar',
    description: 'Let agents read/search notes',
    default: false,
  },
}

export async function activate(api: ExtensionAPI): Promise<void> {
  await applySchemaOrWarn(api)
  for (const register of IPC_GROUPS) disposables.push({ dispose: register(api, api.db) })
  disposables.push(...windowChannels(api), dbReinitChannel(api))
  disposables.push(
    api.settings.register({
      label: 'Notepad',
      description: 'Markdown notes with live preview, comments, and export.',
      properties: { ...NOTEPAD_SETTINGS, ...buildNotificationSettingProperties() },
    })
  )
  disposables.push(api.ipc.registerHandler(pendingQuickCreateChannel()))
  disposables.push(...quickCreateEntryPoints(api))
}

async function applySchemaOrWarn(api: ExtensionAPI): Promise<void> {
  try {
    await applyNotepadSchema(api.db)
  } catch (err) {
    console.error('[notepad] Failed to initialize schema:', err)
    api.notifications.showToast(
      'error',
      'Notepad: database schema failed to apply. Restart the app — if the problem persists, check the logs.',
      'schemaInitFailed'
    )
  }
}

// Open note/diagram in a dedicated auxiliary window using the extension's own renderer.
// api.window.openAuxiliary loads ext://terminator.notepad/…, not the main app URL, which
// would trigger ExtensionPanelPortal and attach the WebContentsView to the main window.
function windowChannels(api: ExtensionAPI): Disposable[] {
  const openNote = defineChannel({
    channel: 'terminator.notepad:notes.openWindow',
    schema: WindowTarget,
    invalid: VALIDATION_ERROR,
    run: ({ id }) => {
      // Unique key per note so each note gets its own window; passing view:'note' in params
      // overrides the view key that openAuxiliary would derive from the first argument.
      api.window.openAuxiliary(`notepad-note-${id}`, { view: 'note', noteId: id })
      return { data: { ok: true } }
    },
  })
  const openDiagram = defineChannel({
    channel: 'terminator.notepad:diagrams.openWindow',
    schema: WindowTarget,
    invalid: VALIDATION_ERROR,
    run: ({ id }) => {
      api.window.openAuxiliary(`notepad-diagram-${id}`, { view: 'diagram', diagramId: id })
      return { data: { ok: true } }
    },
  })
  return [api.ipc.registerHandler(openNote), api.ipc.registerHandler(openDiagram)]
}

function dbReinitChannel(api: ExtensionAPI): Disposable {
  return api.ipc.registerHandler(
    defineChannel({
      channel: 'terminator.notepad:db.reinit',
      schema: noPayload,
      invalid: VALIDATION_ERROR,
      run: async () => {
        await applyNotepadSchema(api.db)
        return { data: { ok: true } }
      },
      onError: (err) => ({ error: err instanceof Error ? err.message : String(err) }),
    })
  )
}

// Renderer calls this on mount to pick up a quick-create triggered before the view existed.
function pendingQuickCreateChannel() {
  return defineChannel({
    channel: 'terminator.notepad:ui.consumePendingQuickCreate',
    schema: noPayload,
    invalid: VALIDATION_ERROR,
    run: () => {
      const pending = _pendingQuickCreate
      _pendingQuickCreate = false
      clearPendingQuickCreateTimer()
      return { data: { pending } }
    },
  })
}

// Cmd+Shift+N lives on the View menu, not globalShortcut: menu accelerators fire only
// while Terminator is focused, whereas a global registration would take the combo away
// from every other app on the system (it collides with New Incognito Window / New Folder).
// The quick-actions panel (⌘P) reaches the same path.
function quickCreateEntryPoints(api: ExtensionAPI): Disposable[] {
  const menuItem = api.nativeMenu.addViewMenuItem({
    id: 'notepad-new-note',
    label: 'New Note',
    accelerator: 'CmdOrCtrl+Shift+N',
    onClick: () => newNote(api),
  })
  const command = api.commands.register(
    {
      id: 'notepad:quick-create',
      label: 'New note',
      mnemonic: 'n',
      shortcut: '⌘⇧N',
      category: 'Notes',
      description: 'Open quick-create overlay',
    },
    () => newNote(api)
  )
  return [menuItem, command]
}

function clearPendingQuickCreateTimer(): void {
  if (_pendingQuickCreateTimer === null) return
  clearTimeout(_pendingQuickCreateTimer)
  _pendingQuickCreateTimer = null
}

function newNote(api: ExtensionAPI): void {
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
}

export function deactivate(): void {
  for (const d of disposables) d.dispose()
  disposables.length = 0
  _pendingQuickCreate = false
  clearPendingQuickCreateTimer()
}
