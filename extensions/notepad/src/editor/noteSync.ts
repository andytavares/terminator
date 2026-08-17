// Cross-surface note synchronisation.
//
// A note can be open in two independent renderers at once: the docked notepad
// panel (a WebContentsView) and a popped-out note window (its own
// BrowserWindow). Each has its own module state and its own autosave timer, so
// without an explicit push they serve — and then re-save — divergent copies of
// the same note. autosaveNote broadcasts on NOTES_CHANGED_CHANNEL after every
// successful write; every surface adopts foreign writes and ignores its own.

/** Push channel announcing a saved note body. Must match notes.ipc.ts. */
export const NOTES_CHANGED_CHANNEL = 'terminator.notepad:notes.changed'

/**
 * Identifies this renderer for the lifetime of the document. Sent with every
 * autosave and echoed back on the broadcast so a surface can tell its own write
 * apart from another surface's and skip re-applying it (which would clobber
 * keystrokes typed during the IPC round-trip).
 */
export const ORIGIN_ID = `notepad-${Math.random().toString(36).slice(2)}-${Date.now()}`

export interface NoteChangedEvent {
  id: string
  title: string
  body: string
  tags: string[]
  updatedAt: string
  originId: string | null
}

export function parseNoteChangedEvent(data: unknown): NoteChangedEvent | null {
  if (typeof data !== 'object' || data === null) return null
  const e = data as Partial<NoteChangedEvent>
  if (typeof e.id !== 'string' || typeof e.body !== 'string') return null
  return {
    id: e.id,
    title: typeof e.title === 'string' ? e.title : '',
    body: e.body,
    tags: Array.isArray(e.tags) ? e.tags : [],
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : '',
    originId: typeof e.originId === 'string' ? e.originId : null,
  }
}

/** True when the change came from another surface and should be adopted here. */
export function isForeignChange(event: NoteChangedEvent): boolean {
  return event.originId !== ORIGIN_ID
}

/**
 * Subscribes to note-change pushes, delivering only changes written by another
 * surface. Returns the unsubscribe function.
 */
export function onForeignNoteChange(handler: (event: NoteChangedEvent) => void): () => void {
  return window.electronAPI.extensionBridge.on(NOTES_CHANGED_CHANNEL, (data: unknown) => {
    const event = parseNoteChangedEvent(data)
    if (event && isForeignChange(event)) handler(event)
  })
}
