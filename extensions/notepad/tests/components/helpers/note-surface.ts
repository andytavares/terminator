import { vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import type { Comment, NoteListItem } from '../../../src/db/types'
import { installExtensionBridge } from '../../../../../tests/support/extension-bridge'

export { eventually } from '../../../../../tests/support/extension-bridge'

/** The extension bridge as Notepad's views see it: unanswered channels list nothing. */
export function installNotepadBridge() {
  return installExtensionBridge(
    { data: [] },
    {
      extension: {
        getSettingsValues: vi.fn().mockResolvedValue({ values: {} }),
        onSettingsChanged: vi.fn(() => () => {}),
      },
    }
  )
}

/** Answers getSettingsValues with `values`, as Notepad's settings page stores them. */
export function storeSettings(values: Record<string, unknown>): void {
  vi.mocked(window.electronAPI.extension.getSettingsValues).mockResolvedValue({ values })
}

/** Resolves after `ms` of real time. */
export function elapse(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

export function anchoredComment(id: string, quote: string, offsets: [number, number]): Comment {
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
export function mountedEditorView(): EditorView {
  const dom = document.querySelector<HTMLElement>('.cm-editor')
  if (!dom) throw new Error('no editor mounted')
  const view = EditorView.findFromDOM(dom)
  if (!view) throw new Error('no editor view')
  return view
}

/** Types at the end of the document, as a local edit. */
export function typeAtEnd(text: string): void {
  const view = mountedEditorView()
  view.dispatch({ changes: { from: view.state.doc.length, insert: text } })
}
