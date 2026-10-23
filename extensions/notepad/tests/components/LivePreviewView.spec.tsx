import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { forceParsing } from '@codemirror/language'
import { GFM } from '@lezer/markdown'
import { livePreviewPlugin } from '../../src/editor/livePreview'
import { eventually } from '../../../../tests/support/eventually'

// The live preview in a real EditorView: the widgets it draws, what they do when used, and how
// focusing the editor turns on the raw markdown of the caret's line.

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg data-testid="diagram"></svg>' })),
  },
}))

let view: EditorView | null = null

// happy-dom fires selectionchange at once, inside the CodeMirror update that moved the selection;
// browsers queue it as a task (https://w3c.github.io/selection-api/#selectionchange-event).
function deferSelectionChange(event: Event): void {
  if ('deferred' in event) return
  event.stopImmediatePropagation()
  setTimeout(() =>
    document.dispatchEvent(Object.assign(new Event('selectionchange'), { deferred: true }))
  )
}

beforeEach(() => window.addEventListener('selectionchange', deferSelectionChange, true))

afterEach(() => {
  window.removeEventListener('selectionchange', deferSelectionChange, true)
  view?.destroy()
  view = null
})

function mountWith(doc: string, extensions: Extension[]): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [markdown({ extensions: [GFM] }), ...extensions],
    }),
    parent,
  })
  forceParsing(view, doc.length, Infinity)
  return view
}

function mountPreview(doc: string, extensions: Extension[] = []): EditorView {
  return mountWith(doc, [livePreviewPlugin, ...extensions])
}

function installShell() {
  const openExternal = vi.fn(async () => ({ ok: true }))
  Object.defineProperty(window, 'electronAPI', {
    value: { shell: { openExternal } },
    writable: true,
    configurable: true,
  })
  return openExternal
}

function pressOn(el: Element, type: 'click' | 'mousedown'): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  return event
}

function toggleCheckbox(v: EditorView, checked: boolean): HTMLInputElement {
  const box = v.dom.querySelector<HTMLInputElement>('.notepad-task-checkbox')!
  box.checked = checked
  box.dispatchEvent(new Event('change'))
  return box
}

describe('list and task widgets', listAndTaskTests)
describe('links, images and rules', linkImageRuleTests)
describe('mermaid blocks', mermaidTests)
describe('tables the preview cannot draw as a grid', unusualTableTests)
describe('an edit elsewhere in the note', redrawTests)
describe('a press on a drawn widget', widgetPressTests)
describe('focusing the editor', focusTests)

function listAndTaskTests() {
  it('draws a bullet for each item of a bullet list', () => {
    const bullets = mountPreview('- one\n- two\n\nend').dom.querySelectorAll('.notepad-list-bullet')
    expect([...bullets].map((b) => b.textContent)).toEqual(['•', '•'])
  })

  it('writes a ticked checkbox back into the markdown', () => {
    const v = mountPreview('- [ ] buy milk\n\nend')
    toggleCheckbox(v, true)
    expect(v.state.doc.toString()).toBe('- [x] buy milk\n\nend')
  })

  it('unticks a done task in the markdown', () => {
    const v = mountPreview('- [x] buy milk\n\nend')
    toggleCheckbox(v, false)
    expect(v.state.doc.toString()).toBe('- [ ] buy milk\n\nend')
  })

  it('leaves a read-only note as written, and the checkbox as it was', () => {
    const v = mountPreview('- [ ] buy milk\n\nend', [EditorState.readOnly.of(true)])
    expect(toggleCheckbox(v, true).checked).toBe(false)
    expect(v.state.doc.toString()).toBe('- [ ] buy milk\n\nend')
  })

  it('keeps the caret where it was when the checkbox is pressed', () => {
    const box = mountPreview('- [ ] buy milk\n\nend').dom.querySelector('.notepad-task-checkbox')!
    expect(pressOn(box, 'mousedown').defaultPrevented).toBe(true)
  })
}

function linkImageRuleTests() {
  it('opens a link in the system browser, not in the app', () => {
    const openExternal = installShell()
    const link = mountPreview('see [the docs](https://example.com/docs)\n\nend').dom.querySelector(
      'a.notepad-link-widget'
    )!
    expect(link.textContent).toBe('the docs')
    expect(pressOn(link, 'click').defaultPrevented).toBe(true)
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('opens a link inside a table cell the same way', () => {
    const openExternal = installShell()
    const v = mountPreview('| site |\n| --- |\n| [home](https://example.com) |\n\nend')
    pressOn(v.dom.querySelector('.notepad-table a.notepad-link-widget')!, 'click')
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('shows an image with its alt text', () => {
    const v = mountPreview('![a cat](cat.png)\n\nend')
    const img = v.dom.querySelector<HTMLImageElement>('img.notepad-image-widget')!
    expect(img.getAttribute('src')).toBe('cat.png')
    expect(img.alt).toBe('a cat')
  })

  it('names a link with no label by its address', () => {
    const v = mountPreview('[](https://example.com)\n\nend')
    expect(v.dom.querySelector('a.notepad-link-widget')?.textContent).toBe('https://example.com')
  })

  it('draws a horizontal rule for ---', () => {
    expect(mountPreview('above\n\n---\n\nend').dom.querySelector('hr.notepad-hr')).not.toBeNull()
  })
}

function mermaidTests() {
  it('replaces a finished mermaid block with the rendered diagram', async () => {
    const v = mountPreview('```mermaid\ngraph TD; A-->B\n```\n\nend')
    const container = v.dom.querySelector('.notepad-mermaid')!
    await eventually(() =>
      expect(container.querySelector('[data-testid="diagram"]')).not.toBeNull()
    )
  })
}

function unusualTableTests() {
  it('leaves a table inside a quote as raw markdown', () => {
    const v = mountPreview('> | a | b |\n> | --- | --- |\n> | 1 | 2 |\n\nend')
    expect(v.dom.querySelector('.notepad-table')).toBeNull()
    expect(v.dom.textContent).toContain('| --- | --- |')
  })

  it('draws a table inside a list item in line with the item', () => {
    const v = mountPreview('- item\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n\nend')
    expect(v.dom.querySelector('.cm-line .notepad-table')).not.toBeNull()
  })
}

const EVERY_WIDGET = [
  '- bullet\n- [ ] task\n[link](https://example.com)\n![img](cat.png)',
  '---',
  '```mermaid\ngraph TD; A-->B\n```',
  '| a |\n| --- |\n| 1 |',
  '> [!NOTE]\n> remember',
  'end',
].join('\n\n')

const WIDGET_SELECTORS = [
  '.notepad-list-bullet',
  '.notepad-task-wrap',
  '.notepad-link-widget',
  '.notepad-image-widget',
  '.notepad-hr',
  '.notepad-mermaid',
  '.notepad-table-wrap',
  '.notepad-alert__header',
]

function redrawTests() {
  it('keeps every drawn widget rather than drawing it again', () => {
    const v = mountPreview(EVERY_WIDGET)
    const before = WIDGET_SELECTORS.map((selector) => v.dom.querySelector(selector))
    expect(before).not.toContain(null)

    v.dispatch({ changes: { from: v.state.doc.length, insert: '!' } })
    WIDGET_SELECTORS.forEach((selector, i) => expect(v.dom.querySelector(selector)).toBe(before[i]))
  })

  it('draws a widget again when its own markdown changes', () => {
    const v = mountPreview('- [ ] task\n\nend')
    const before = v.dom.querySelector('.notepad-task-checkbox')
    v.dispatch({ changes: { from: 3, to: 4, insert: 'x' } })
    const after = v.dom.querySelector<HTMLInputElement>('.notepad-task-checkbox')
    expect(after).not.toBe(before)
    expect(after?.checked).toBe(true)
  })
}

function widgetPressTests() {
  it('is left to the widget: the editor neither moves the caret nor takes focus', () => {
    const v = mountPreview(EVERY_WIDGET)
    const head = v.state.selection.main.head
    for (const selector of ['.notepad-list-bullet', '.notepad-hr', '.notepad-image-widget']) {
      pressOn(v.dom.querySelector(selector)!, 'mousedown')
      expect(v.hasFocus).toBe(false)
      expect(v.state.selection.main.head).toBe(head)
    }
    for (const selector of ['.notepad-mermaid', '.notepad-table', '.notepad-alert__header']) {
      pressOn(v.dom.querySelector(selector)!, 'mousedown')
      expect(v.hasFocus).toBe(false)
    }
  })

  it('on a link reaches the editor too, which takes focus', () => {
    const v = mountPreview('[link](https://example.com)\n\nend')
    pressOn(v.dom.querySelector('.notepad-link-widget')!, 'mousedown')
    expect(v.hasFocus).toBe(true)
  })
}

const BOLD = '**bold** text\nnext line'

function focusTests() {
  it('shows the raw markdown of the caret line while focused, and hides it on blur', async () => {
    const v = mountPreview(BOLD)
    v.dispatch({ selection: { anchor: 2 } })
    expect(v.contentDOM.textContent).not.toContain('**')

    v.focus()
    await eventually(() => expect(v.contentDOM.textContent).toContain('**bold**'))

    v.contentDOM.blur()
    await eventually(() => expect(v.contentDOM.textContent).not.toContain('**'))
  })

  it('shows it at once when the preview is switched on in an editor that has focus', async () => {
    const preview = new Compartment()
    const v = mountWith(BOLD, [preview.of([])])
    v.dispatch({ selection: { anchor: 2 } })
    v.focus()
    await eventually(() => expect(v.hasFocus).toBe(true))

    v.dispatch({ effects: preview.reconfigure(livePreviewPlugin) })
    await eventually(() => expect(v.contentDOM.textContent).toContain('**bold**'))
  })
}
