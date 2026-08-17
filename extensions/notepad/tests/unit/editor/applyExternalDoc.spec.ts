import { describe, it, expect, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { applyExternalDoc } from '../../../src/editor/NoteEditor'

// A stand-in for EditorView that keeps real EditorState semantics (doc,
// selection, transaction application) without needing a DOM.
function makeView(doc: string, cursor = 0) {
  let state = EditorState.create({ doc, selection: { anchor: cursor } })
  const dispatch = vi.fn((spec: Parameters<EditorView['dispatch']>[0]) => {
    state = state.update(spec as Parameters<EditorState['update']>[0]).state
  })
  return {
    get state() {
      return state
    },
    dispatch,
  } as unknown as EditorView & { dispatch: ReturnType<typeof vi.fn> }
}

describe('applyExternalDoc', () => {
  it('replaces the document with the incoming body', () => {
    const view = makeView('stale body')
    applyExternalDoc(view, 'fresh body from the other window')
    expect(view.state.doc.toString()).toBe('fresh body from the other window')
  })

  it('keeps the caret where it was', () => {
    const view = makeView('hello world', 5)
    applyExternalDoc(view, 'hello there world')
    expect(view.state.selection.main.head).toBe(5)
  })

  it('clamps the caret when the incoming body is shorter', () => {
    const view = makeView('a very long body indeed', 20)
    applyExternalDoc(view, 'short')
    expect(view.state.selection.main.head).toBe(5)
  })

  it('does nothing when the text already matches, so an echo is free', () => {
    const view = makeView('same text')
    applyExternalDoc(view, 'same text')
    expect(view.dispatch).not.toHaveBeenCalled()
  })

  it('tolerates a null view', () => {
    expect(() => applyExternalDoc(null, 'anything')).not.toThrow()
  })

  it('applies an empty incoming body', () => {
    const view = makeView('had content', 4)
    applyExternalDoc(view, '')
    expect(view.state.doc.toString()).toBe('')
    expect(view.state.selection.main.head).toBe(0)
  })

  it('marks the transaction so it is not reported as a local edit', () => {
    const view = makeView('before')
    applyExternalDoc(view, 'after')
    const spec = view.dispatch.mock.calls[0][0] as { annotations?: unknown }
    expect(spec.annotations).toBeDefined()
  })
})
