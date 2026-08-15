import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { cursorCharRight, cursorCharLeft } from '@codemirror/commands'
import { livePreviewPlugin } from '../../src/editor/livePreview'

// Exercises a real EditorView rather than buildDecorations alone, because the
// reported bug was that the caret could not reach a rendered table by mouse or
// keyboard — behaviour that only shows up with a live view.

const TABLE = ['| Name | Count |', '| --- | ---: |', '| apples | 3 |'].join('\n')
const DOC = `before\n\n${TABLE}\n\nafter`

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
})

function mountDoc(doc: string, cursor: number): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [markdown({ extensions: [GFM] }), livePreviewPlugin],
    }),
    parent,
  })
  return view
}

function mount(cursor: number): EditorView {
  return mountDoc(DOC, cursor)
}

/** Types text at the caret one character at a time, as a user would. */
function type(v: EditorView, text: string): void {
  for (const char of text) {
    const at = v.state.selection.main.head
    v.dispatch({ changes: { from: at, insert: char }, selection: { anchor: at + 1 } })
  }
}

const tableRendered = (v: EditorView) => v.dom.querySelector('.notepad-table') !== null

describe('editing a rendered table', () => {
  it('renders the table while the caret is elsewhere', () => {
    expect(tableRendered(mount(0))).toBe(true)
  })

  it('clicking a body cell puts the caret in that cell', () => {
    const v = mount(0)
    const cell = v.dom.querySelectorAll<HTMLElement>('.notepad-table tbody td')[0]
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

    expect(v.state.selection.main.head).toBe(DOC.indexOf('apples'))
  })

  it('clicking a cell reveals the raw markdown so it can be typed into', () => {
    const v = mount(0)
    const cell = v.dom.querySelectorAll<HTMLElement>('.notepad-table tbody td')[0]
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

    expect(tableRendered(v)).toBe(false)
    expect(v.dom.textContent).toContain('| apples | 3 |')
  })

  it('clicking a header cell puts the caret in the header source', () => {
    const v = mount(0)
    const cell = v.dom.querySelectorAll<HTMLElement>('.notepad-table thead th')[1]
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

    expect(v.state.selection.main.head).toBe(DOC.indexOf('Count'))
  })

  it('typing after a click edits the cell rather than the whole table', () => {
    const v = mount(0)
    const cell = v.dom.querySelectorAll<HTMLElement>('.notepad-table tbody td')[0]
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

    const at = v.state.selection.main.head
    v.dispatch({ changes: { from: at, insert: 'green ' } })

    expect(v.state.doc.toString()).toContain('| green apples | 3 |')
  })

  it('the caret can walk into the table from the line above', () => {
    // Just before the table's first character.
    const v = mount(DOC.indexOf('| Name') - 1)
    expect(tableRendered(v)).toBe(true)

    cursorCharRight(v)

    expect(v.state.selection.main.head).toBeGreaterThanOrEqual(DOC.indexOf('| Name'))
    expect(tableRendered(v)).toBe(false)
  })

  it('the caret can walk into the table from the line below', () => {
    const tableEnd = DOC.indexOf('| apples | 3 |') + '| apples | 3 |'.length
    const v = mount(tableEnd + 1)
    cursorCharLeft(v)

    expect(v.state.selection.main.head).toBeLessThanOrEqual(tableEnd)
    expect(tableRendered(v)).toBe(false)
  })

  it('re-renders once the caret leaves the table again', () => {
    const v = mount(DOC.indexOf('apples'))
    expect(tableRendered(v)).toBe(false)

    v.dispatch({ selection: { anchor: 0 } })

    expect(tableRendered(v)).toBe(true)
  })

  it('reflects an edit in the re-rendered table', () => {
    const v = mount(DOC.indexOf('apples'))
    v.dispatch({ changes: { from: DOC.indexOf('apples'), insert: 'green ' } })
    v.dispatch({ selection: { anchor: 0 } })

    expect(tableRendered(v)).toBe(true)
    expect(v.dom.querySelector('.notepad-table tbody td')?.textContent).toBe('green apples')
  })
})

describe('writing a fenced code block', () => {
  it('keeps the fence and language visible as they are typed', () => {
    const v = mountDoc('', 0)
    type(v, '```js')

    expect(v.dom.textContent).toContain('```js')
  })

  it('does not turn a half-typed mermaid fence into a diagram', () => {
    const v = mountDoc('', 0)
    type(v, '```mermaid')

    expect(v.dom.querySelector('.notepad-mermaid')).toBeNull()
    expect(v.dom.textContent).toContain('```mermaid')
  })

  it('keeps the language reachable while the body is written', () => {
    const v = mountDoc('```js\ncode\n```', 8)
    expect(v.dom.textContent).toContain('```js')
  })

  it('hides the fences once the caret leaves the finished block', () => {
    const v = mountDoc('```js\ncode\n```\n\nafter', 0)
    v.dispatch({ selection: { anchor: v.state.doc.length } })

    expect(v.dom.querySelector('.notepad-fence-hidden')).not.toBeNull()
  })
})
