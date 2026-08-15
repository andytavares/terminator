import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import type { Decoration, DecorationSet } from '@codemirror/view'
import { buildDecorations } from '../../../src/editor/livePreview'

// GFM must be enabled for Table nodes to exist at all — this mirrors the
// parser configuration NoteEditor builds.
function makeState(doc: string, readOnly = false) {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM] }), EditorState.readOnly.of(readOnly)],
  })
}

interface Collected {
  from: number
  to: number
  spec: { class?: string; widget?: { constructor: { name: string } }; block?: boolean }
}

function collect(decos: DecorationSet, length: number): Collected[] {
  const out: Collected[] = []
  decos.between(0, length, (from, to, deco: Decoration) => {
    out.push({ from, to, spec: deco.spec as Collected['spec'] })
  })
  return out
}

function widgetNames(decos: Collected[]): string[] {
  return decos.map((d) => d.spec.widget?.constructor.name).filter(Boolean) as string[]
}

function classes(decos: Collected[]): string[] {
  return decos.map((d) => d.spec.class).filter(Boolean) as string[]
}

describe('buildDecorations — tables', () => {
  const TABLE = ['| Name | Count |', '| --- | ---: |', '| apples | 3 |'].join('\n')

  it('replaces the whole table with a table widget', () => {
    const doc = `${TABLE}\n\ntrailing paragraph`
    const state = makeState(doc)
    const decos = collect(buildDecorations(state, { anchor: doc.length }), doc.length)

    expect(widgetNames(decos)).toContain('TableWidget')
  })

  it('spans the table from its first character to its last', () => {
    const doc = `${TABLE}\n\ntrailing paragraph`
    const state = makeState(doc)
    const decos = collect(buildDecorations(state, { anchor: doc.length }), doc.length)
    const table = decos.find((d) => d.spec.widget?.constructor.name === 'TableWidget')!

    expect(table.from).toBe(0)
    expect(table.to).toBe(TABLE.length)
  })

  it('renders as a block widget when the table occupies whole lines', () => {
    const doc = `${TABLE}\n\ntrailing paragraph`
    const state = makeState(doc)
    const decos = collect(buildDecorations(state, { anchor: doc.length }), doc.length)
    const table = decos.find((d) => d.spec.widget?.constructor.name === 'TableWidget')!

    expect(table.spec.block).toBe(true)
  })

  it('shows raw markdown while the cursor is inside the table', () => {
    const state = makeState(`${TABLE}\n`)
    const decos = collect(buildDecorations(state, { anchor: 3 }, true), state.doc.length)

    expect(widgetNames(decos)).not.toContain('TableWidget')
  })

  it('still renders the table in read-only mode with the cursor inside', () => {
    const state = makeState(`${TABLE}\n`, true)
    const decos = collect(buildDecorations(state, { anchor: 3 }, true), state.doc.length)

    expect(widgetNames(decos)).toContain('TableWidget')
  })

  it('renders the table before the editor has been focused', () => {
    const state = makeState(`${TABLE}\n`)
    const decos = collect(buildDecorations(state, { anchor: 3 }, false), state.doc.length)

    expect(widgetNames(decos)).toContain('TableWidget')
  })

  it('leaves a pipe-looking paragraph that is not a table alone', () => {
    const doc = 'a | b\nnot a delimiter row\n'
    const state = makeState(doc)
    const decos = collect(buildDecorations(state, { anchor: doc.length }), doc.length)

    expect(widgetNames(decos)).not.toContain('TableWidget')
  })
})

describe('buildDecorations — alerts', () => {
  const ALERT = '> [!WARNING]\n> Mind the gap.'

  it('replaces the marker line with an alert header widget', () => {
    const doc = `${ALERT}\n\nafter`
    const state = makeState(doc)
    const decos = collect(buildDecorations(state, { anchor: doc.length }), doc.length)

    expect(widgetNames(decos)).toContain('AlertHeaderWidget')
  })

  it('applies the alert line class to every line of the alert', () => {
    const doc = `${ALERT}\n\nafter`
    const state = makeState(doc)
    const decos = collect(buildDecorations(state, { anchor: doc.length }), doc.length)

    const alertLines = classes(decos).filter((c) => c.includes('notepad-alert--warning'))
    expect(alertLines).toHaveLength(2)
  })

  it('hides the quote marker on body lines', () => {
    const doc = `${ALERT}\n\nafter`
    const state = makeState(doc)
    const decos = collect(buildDecorations(state, { anchor: doc.length }), doc.length)

    const bodyLineStart = doc.indexOf('> Mind')
    const hidden = decos.find(
      (d) => d.from === bodyLineStart && d.to === bodyLineStart + 2 && !d.spec.class
    )
    expect(hidden).toBeDefined()
  })

  it('carries the alert kind into the class name', () => {
    const doc = '> [!TIP]\n> Try this.\n\nafter'
    const state = makeState(doc)
    const decos = collect(buildDecorations(state, { anchor: doc.length }), doc.length)

    expect(classes(decos).some((c) => c.includes('notepad-alert--tip'))).toBe(true)
  })

  it('handles a multi-paragraph alert', () => {
    const doc = '> [!NOTE]\n> First.\n>\n> Second.\n\nafter'
    const state = makeState(doc)
    const decos = collect(buildDecorations(state, { anchor: doc.length }), doc.length)

    const alertLines = classes(decos).filter((c) => c.includes('notepad-alert--note'))
    expect(alertLines).toHaveLength(4)
  })

  it('styles a lazy continuation line that carries no quote marker', () => {
    // CommonMark lets a paragraph inside a blockquote continue without '>'.
    const doc = '> [!NOTE]\n> First line\nlazy continuation\n\nafter'
    const state = makeState(doc)
    const decos = collect(buildDecorations(state, { anchor: doc.length }), doc.length)

    const alertLines = classes(decos).filter((c) => c.includes('notepad-alert--note'))
    expect(alertLines).toHaveLength(3)
  })

  it('shows raw markdown while the cursor is inside the alert', () => {
    const state = makeState(`${ALERT}\n`)
    const decos = collect(buildDecorations(state, { anchor: 4 }, true), state.doc.length)

    expect(widgetNames(decos)).not.toContain('AlertHeaderWidget')
  })

  it('leaves an ordinary blockquote to the existing blockquote styling', () => {
    const doc = '> just a quote\n\nafter'
    const state = makeState(doc)
    const decos = collect(buildDecorations(state, { anchor: doc.length }), doc.length)

    expect(widgetNames(decos)).not.toContain('AlertHeaderWidget')
    expect(classes(decos).some((c) => c.includes('notepad-blockquote-line'))).toBe(true)
  })

  it('treats an unknown alert type as an ordinary blockquote', () => {
    const doc = '> [!DANGER]\n> nope\n\nafter'
    const state = makeState(doc)
    const decos = collect(buildDecorations(state, { anchor: doc.length }), doc.length)

    expect(widgetNames(decos)).not.toContain('AlertHeaderWidget')
  })
})
