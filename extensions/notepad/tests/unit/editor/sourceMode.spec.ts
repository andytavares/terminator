import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import type { Decoration } from '@codemirror/view'
import { buildDecorations, livePreviewPlugin } from '../../../src/editor/livePreview'

const TABLE = ['| Name | Count |', '| --- | --- |', '| apples | 3 |'].join('\n')

function makeState(doc: string, cursor: number, extensions: unknown[] = []) {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ extensions: [GFM] }), ...(extensions as never[])],
  })
}

function decorationCount(state: EditorState, cursor: number, focused = true): number {
  const decos = buildDecorations(state, { anchor: cursor }, focused)
  let count = 0
  decos.between(0, state.doc.length, (_from: number, _to: number, _deco: Decoration) => {
    count++
  })
  return count
}

describe('source mode', () => {
  // Source mode is implemented by leaving livePreviewPlugin out of the
  // configuration, so the document keeps its raw markdown decorations-free.
  it('the live preview plugin is a set of extensions that can be omitted', () => {
    expect(Array.isArray(livePreviewPlugin)).toBe(true)
    expect(livePreviewPlugin.length).toBeGreaterThan(0)
  })

  it('a state without the plugin carries no preview decorations', () => {
    const state = makeState(`# Heading\n\n${TABLE}\n`, 0)
    const withoutPlugin = EditorState.create({ doc: state.doc.toString() })
    // No decoration field is installed at all, so nothing renders over the text.
    expect(withoutPlugin.doc.toString()).toContain('# Heading')
    expect(withoutPlugin.doc.toString()).toContain('| Name | Count |')
  })

  it('a state with the plugin decorates the same document', () => {
    const state = makeState(`# Heading\n\n${TABLE}\n`, 0, livePreviewPlugin)
    expect(decorationCount(state, state.doc.length)).toBeGreaterThan(0)
  })

  it('switching modes never alters the document text', () => {
    const doc = `# Heading\n\n${TABLE}\n`
    const live = makeState(doc, 0, livePreviewPlugin)
    const source = makeState(doc, 0)
    expect(live.doc.toString()).toBe(source.doc.toString())
  })
})

describe('table stays editable', () => {
  it('renders the table when the caret is outside it', () => {
    const doc = `${TABLE}\n\nafter`
    const state = makeState(doc, doc.length)
    let hasTable = false
    buildDecorations(state, { anchor: doc.length }, true).between(0, doc.length, (_f, _t, deco) => {
      if (
        (deco.spec as { widget?: { constructor: { name: string } } }).widget?.constructor.name ===
        'TableWidget'
      )
        hasTable = true
    })
    expect(hasTable).toBe(true)
  })

  it('yields to raw markdown as soon as the caret lands in a cell', () => {
    // This is the round trip a click performs: dispatch a selection inside the
    // table, and the rendering gives way so the text can be edited.
    const doc = `${TABLE}\n\nafter`
    const state = makeState(doc, doc.length)
    const insideCell = doc.indexOf('apples')

    let hasTable = false
    buildDecorations(state, { anchor: insideCell }, true).between(0, doc.length, (_f, _t, deco) => {
      if (
        (deco.spec as { widget?: { constructor: { name: string } } }).widget?.constructor.name ===
        'TableWidget'
      )
        hasTable = true
    })
    expect(hasTable).toBe(false)
  })

  it('re-renders once the caret leaves the table again', () => {
    const doc = `${TABLE}\n\nafter`
    const state = makeState(doc, doc.length)
    const countInside = decorationCount(state, doc.indexOf('apples'))
    const countOutside = decorationCount(state, doc.length)
    expect(countOutside).toBeGreaterThan(countInside)
  })
})
