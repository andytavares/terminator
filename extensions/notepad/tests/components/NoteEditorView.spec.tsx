import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import {
  NoteEditor,
  applyAnchors,
  setEditorHoverAnchor,
  type SelectionAnchor,
} from '../../src/editor/NoteEditor'

// NoteEditor around a real CodeMirror view: what it reports to its owner, the code languages it
// loads, and the comment highlights it draws.

afterEach(cleanup)

type EditorProps = React.ComponentProps<typeof NoteEditor>

function renderEditor(props: Partial<EditorProps> & { initialDoc: string }) {
  const onChange = vi.fn()
  const element = (extra: Partial<EditorProps>) => (
    <NoteEditor onChange={onChange} {...props} {...extra} />
  )
  const result = render(element({}))
  const dom = result.container.querySelector<HTMLElement>('.cm-editor')!
  const view = EditorView.findFromDOM(dom)!
  const rerender = (extra: Partial<EditorProps>) => result.rerender(element(extra))
  return { view, onChange, rerender }
}

describe('what the editor reports', reportTests)
describe('fenced code languages', languageTests)
describe('the view settings', settingsTests)
describe('comment highlights', highlightTests)

function reportTests() {
  it('reports the selected text with the text around it', () => {
    const onSelectionChange = vi.fn<(sel: SelectionAnchor | null) => void>()
    const { view } = renderEditor({ initialDoc: 'hello world foo', onSelectionChange })

    view.dispatch({ selection: { anchor: 6, head: 11 } })
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: 6, to: 11, quote: 'world', prefix: 'hello ', suffix: ' foo' })
    )

    view.dispatch({ selection: { anchor: 3 } })
    expect(onSelectionChange).toHaveBeenLastCalledWith(null)
  })

  it('reports how far below the top of the editor the selection starts', () => {
    const onSelectionChange = vi.fn<(sel: SelectionAnchor | null) => void>()
    const { view } = renderEditor({ initialDoc: 'hello world', onSelectionChange })
    // happy-dom lays nothing out, so the two measurements are given.
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 140, bottom: 160, left: 0, right: 0 })
    vi.spyOn(view.dom, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: 100 }))

    view.dispatch({ selection: { anchor: 0, head: 5 } })
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ lineTop: 40 }))
  })

  it('reports an edit even with no one listening for the selection', () => {
    const { view, onChange } = renderEditor({ initialDoc: 'hello' })
    view.dispatch({ changes: { from: 5, insert: '!' }, selection: { anchor: 6 } })
    expect(onChange).toHaveBeenCalledWith('hello!')
  })
}

// A word in each block, and the node its language's parser makes of it.
const LANGUAGES = [
  { lang: 'js', code: 'const answer = 42', word: 'answer', node: 'VariableDefinition' },
  { lang: 'go', code: 'func main() {}', word: 'func', node: 'keyword' },
  { lang: 'sh', code: 'echo hi', word: 'echo', node: 'variableName.standard' },
]

/** The names of the syntax nodes around `pos`, innermost first, nested languages included. */
function nodeNamesAt(view: EditorView, pos: number): string[] {
  const names: string[] = []
  for (let node = syntaxTree(view.state).resolveInner(pos, 1); node.parent; node = node.parent) {
    names.push(node.name)
  }
  return names
}

function languageTests() {
  it.each(LANGUAGES)(
    'parses a ```$lang block as that language',
    async ({ lang, code, word, node }) => {
      const doc = `\`\`\`${lang}\n${code}\n\`\`\`\n\nend`
      const { view } = renderEditor({ initialDoc: doc })
      const at = doc.indexOf(code) + code.indexOf(word)
      await vi.waitFor(() => expect(nodeNamesAt(view, at)).toContain(node))
    }
  )
}

function settingsTests() {
  it('shows the raw markdown in source mode and the preview otherwise', () => {
    const { view, rerender } = renderEditor({ initialDoc: '**bold**\n\nend', sourceMode: true })
    expect(view.contentDOM.textContent).toContain('**bold**')

    rerender({ sourceMode: false })
    expect(view.contentDOM.textContent).not.toContain('**')
  })

  it('becomes read-only when asked to', () => {
    const { view, rerender } = renderEditor({ initialDoc: 'text' })
    expect(view.state.readOnly).toBe(false)
    rerender({ readOnly: true })
    expect(view.state.readOnly).toBe(true)
  })
}

function highlights(view: EditorView): string[] {
  return [...view.dom.querySelectorAll('.notepad-comment-highlight')].map((el) => el.className)
}

function highlightTests() {
  it('highlights a commented range, marks the hovered one, and clears them all', () => {
    const { view } = renderEditor({ initialDoc: 'one two three' })
    applyAnchors(view, [{ id: 'c1', from: 4, to: 7 }])
    expect(view.dom.querySelector('[data-comment-id="c1"]')?.textContent).toBe('two')

    setEditorHoverAnchor(view, 'c1')
    expect(highlights(view)).toEqual(['notepad-comment-highlight notepad-comment-highlight--hover'])

    applyAnchors(view, [])
    expect(highlights(view)).toEqual([])
  })

  it('highlights two comments that start at the same word', () => {
    const { view } = renderEditor({ initialDoc: 'one two three' })
    applyAnchors(view, [
      { id: 'long', from: 4, to: 13 },
      { id: 'short', from: 4, to: 7 },
    ])
    expect(view.dom.querySelector('[data-comment-id="short"]')).not.toBeNull()
    expect(view.dom.querySelector('[data-comment-id="long"]')).not.toBeNull()
  })

  it('draws nothing for a comment whose text was deleted', () => {
    const { view } = renderEditor({ initialDoc: 'one two three' })
    applyAnchors(view, [
      { id: 'gone', from: 4, to: 4 },
      { id: 'kept', from: 8, to: 13 },
    ])
    expect(view.dom.querySelector('[data-comment-id="gone"]')).toBeNull()
    expect(view.dom.querySelector('[data-comment-id="kept"]')?.textContent).toBe('three')
  })
}
