import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import type { Decoration } from '@codemirror/view'
import { buildDecorations } from '../../../src/editor/livePreview'

function makeState(doc: string, readOnly = false) {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM] }), EditorState.readOnly.of(readOnly)],
  })
}

interface Collected {
  from: number
  to: number
  cls?: string
  widget?: string
}

function collect(doc: string, cursor: number, focused = false, readOnly = false): Collected[] {
  const state = makeState(doc, readOnly)
  const out: Collected[] = []
  buildDecorations(state, { anchor: cursor }, focused).between(
    0,
    state.doc.length,
    (from: number, to: number, deco: Decoration) => {
      const spec = deco.spec as { class?: string; widget?: { constructor: { name: string } } }
      out.push({ from, to, cls: spec.class, widget: spec.widget?.constructor.name })
    }
  )
  return out
}

// The `focused` flag only flips on a focus-change event, so it can be stale
// while the user is typing. Fence rendering must not depend on it — a stale
// false used to make a half-typed fence vanish mid-keystroke. Every case here
// is asserted with focused=false, the worst case.
describe('fenced code — while the block is being written', () => {
  it('leaves a bare ``` alone', () => {
    expect(collect('```', 3)).toEqual([])
  })

  it('leaves the language visible as it is typed', () => {
    expect(collect('```js', 5)).toEqual([])
    expect(collect('```jav', 6)).toEqual([])
  })

  it('does not turn a half-typed mermaid fence into a diagram', () => {
    expect(collect('```mermaid', 10)).toEqual([])
  })

  it('leaves a fence with no body yet alone', () => {
    expect(collect('```js\n', 6)).toEqual([])
  })

  it('leaves an unterminated fence alone even when the caret is elsewhere', () => {
    const doc = 'intro\n\n```js'
    expect(collect(doc, 0)).toEqual([])
  })
})

describe('fenced code — editing the body', () => {
  const BLOCK = '```js\ncode\n```'

  it('styles the code lines once the caret is past the opening fence', () => {
    const decos = collect(BLOCK, BLOCK.indexOf('code'))
    expect(decos.some((d) => d.cls === 'notepad-code-block-line')).toBe(true)
  })

  it('keeps both fences visible while the body is being edited', () => {
    const decos = collect(BLOCK, BLOCK.indexOf('code'))
    expect(decos.some((d) => d.cls === 'notepad-fence-hidden')).toBe(false)
    expect(decos.every((d) => d.widget === undefined)).toBe(true)
  })

  it('styles every line of a multi-line body', () => {
    const doc = '```js\none\ntwo\nthree\n```'
    const decos = collect(doc, doc.indexOf('two'))
    expect(decos.filter((d) => d.cls === 'notepad-code-block-line')).toHaveLength(3)
  })

  it('does not render a mermaid diagram while its source is being edited', () => {
    const doc = '```mermaid\ngraph TD;\n```'
    expect(collect(doc, doc.indexOf('graph')).every((d) => d.widget === undefined)).toBe(true)
  })

  it('goes back to raw when the caret returns to the language', () => {
    expect(collect(BLOCK, 4)).toEqual([])
  })

  it('keeps the closing fence visible when the caret is on it', () => {
    const decos = collect(BLOCK, BLOCK.length - 1)
    expect(decos.some((d) => d.cls === 'notepad-fence-hidden')).toBe(false)
  })
})

describe('fenced code — finished block', () => {
  it('hides both fences once the caret leaves', () => {
    const doc = '```js\ncode\n```\n\nafter'
    const decos = collect(doc, doc.length)
    expect(decos.filter((d) => d.cls === 'notepad-fence-hidden')).toHaveLength(2)
  })

  it('renders a mermaid block as a diagram once the caret leaves', () => {
    const doc = '```mermaid\ngraph TD;\n```\n\nafter'
    expect(collect(doc, doc.length).some((d) => d.widget === 'MermaidWidget')).toBe(true)
  })

  it('renders fully in read-only mode even with the caret inside', () => {
    const doc = '```js\ncode\n```'
    const decos = collect(doc, doc.indexOf('code'), true, true)
    expect(decos.filter((d) => d.cls === 'notepad-fence-hidden')).toHaveLength(2)
  })

  it('renders a read-only mermaid block as a diagram', () => {
    const doc = '```mermaid\ngraph TD;\n```'
    expect(collect(doc, 12, true, true).some((d) => d.widget === 'MermaidWidget')).toBe(true)
  })
})
