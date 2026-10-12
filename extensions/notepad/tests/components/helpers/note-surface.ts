import { vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import type { Comment, NoteListItem } from '../../../src/db/types'

/** Answers bridge invokes by channel, and lets a test push to bridge subscribers. */
export function installBridge() {
  const responses: Record<string, unknown> = {}
  const handlers = new Map<string, (data: unknown) => void>()
  const invoke = vi.fn(async (channel: string) => responses[channel] ?? { data: [] })
  const on = vi.fn((channel: string, handler: (data: unknown) => void) => {
    handlers.set(channel, handler)
    return () => handlers.delete(channel)
  })
  Object.defineProperty(window, 'electronAPI', {
    value: {
      extensionBridge: { invoke, on },
      extension: { getSettingsValues: vi.fn().mockResolvedValue({ values: {} }) },
    },
    writable: true,
    configurable: true,
  })
  const push = (channel: string, data: unknown) => handlers.get(channel)?.(data)
  const calls = (channel: string) =>
    invoke.mock.calls.filter(([ch]) => ch === channel).map((call) => (call as unknown[])[1])
  return { responses, invoke, push, calls }
}

export function listItem(id: string, title: string, tags: string[] = []): NoteListItem {
  return {
    id,
    title,
    bodyPreview: '',
    updatedAt: '2026-01-02T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    tags,
    sortOrder: 0,
    folderId: null,
  }
}

export function comment(id: string, quote: string, offsets: [number, number]): Comment {
  return {
    id,
    noteId: 'n1',
    parentId: null,
    body: `about ${quote}`,
    author: 'me',
    status: 'open',
    startOffset: offsets[0],
    endOffset: offsets[1],
    quote,
    prefix: '',
    suffix: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    replies: [],
  }
}

/** The live CodeMirror view the surface mounted. */
export function editorView(): EditorView {
  const dom = document.querySelector<HTMLElement>('.cm-editor')
  if (!dom) throw new Error('no editor mounted')
  const view = EditorView.findFromDOM(dom)
  if (!view) throw new Error('no editor view')
  return view
}

/** Types at the end of the document, as a local edit. */
export function typeAtEnd(text: string): void {
  const view = editorView()
  view.dispatch({ changes: { from: view.state.doc.length, insert: text } })
}

/** Waits for an assertion to hold, allowing for a loaded machine. */
export function eventually(assertion: () => void, timeout = 8000) {
  return vi.waitFor(assertion, { timeout })
}
