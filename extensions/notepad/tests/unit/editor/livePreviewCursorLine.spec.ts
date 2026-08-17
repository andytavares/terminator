import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import type { Decoration } from '@codemirror/view'
import { buildDecorations } from '../../../src/editor/livePreview'

// Live preview reveals the raw markdown of whatever line the caret is on, so
// the construct stays editable. These cover that reveal for every construct
// that implements it — the counterpart to the "rendered" assertions elsewhere.

function makeState(doc: string) {
  return EditorState.create({ doc, extensions: [markdown({ extensions: [GFM] })] })
}

function countDecorations(doc: string, cursor: number): number {
  const state = makeState(doc)
  const decos = buildDecorations(state, { anchor: cursor })
  let count = 0
  decos.between(0, state.doc.length, (_from: number, _to: number, _deco: Decoration) => {
    count++
  })
  return count
}

// Each fixture puts the construct on line 1 and a plain line after it, so the
// same document can be measured with the caret on and off the construct.
const CONSTRUCTS: { name: string; line: string }[] = [
  { name: 'heading', line: '# Heading' },
  { name: 'bold', line: 'text **bold** text' },
  { name: 'italic', line: 'text *italic* text' },
  { name: 'strikethrough', line: 'text ~~struck~~ text' },
  { name: 'inline code', line: 'text `code` text' },
  { name: 'blockquote', line: '> quoted' },
  { name: 'horizontal rule', line: '---' },
  { name: 'image', line: '![alt](https://example.com/i.png)' },
  { name: 'bullet list item', line: '- item' },
  { name: 'ordered list item', line: '1. item' },
  { name: 'task list item', line: '- [ ] task' },
  { name: 'link', line: '[label](https://example.com)' },
]

describe('buildDecorations — raw reveal on the caret line', () => {
  it.each(CONSTRUCTS)('decorates $name when the caret is elsewhere', ({ line }) => {
    const doc = `${line}\nplain second line`
    expect(countDecorations(doc, doc.length)).toBeGreaterThan(0)
  })

  it.each(CONSTRUCTS)('reveals raw $name markdown when the caret is on its line', ({ line }) => {
    const doc = `${line}\nplain second line`
    const onLine = countDecorations(doc, 1)
    const offLine = countDecorations(doc, doc.length)
    expect(onLine).toBeLessThan(offLine)
  })
})

describe('buildDecorations — degenerate constructs', () => {
  // Caret parked at the very end, off the construct's line, so the renderer
  // takes its decorating path rather than the raw-reveal one.
  const atEnd = (doc: string) => countDecorations(doc, doc.length)

  it('leaves a bare heading marker with no text alone', () => {
    expect(() => atEnd('#\nsecond line')).not.toThrow()
  })

  it('leaves empty emphasis markers alone', () => {
    expect(() => atEnd('****\nsecond line')).not.toThrow()
  })

  it('handles an image with no URL', () => {
    expect(() => atEnd('![alt]()\nsecond line')).not.toThrow()
  })

  it('handles a fenced code block with no content', () => {
    expect(() => atEnd('```\n```\nsecond line')).not.toThrow()
  })

  it('renders a mermaid fence as a widget', () => {
    const doc = '```mermaid\ngraph TD;\n```\nsecond line'
    const state = makeState(doc)
    const decos = buildDecorations(state, { anchor: doc.length })
    let hasWidget = false
    decos.between(0, state.doc.length, (_from, _to, deco: Decoration) => {
      const widget = (deco.spec as { widget?: { constructor: { name: string } } }).widget
      if (widget?.constructor.name === 'MermaidWidget') hasWidget = true
    })
    expect(hasWidget).toBe(true)
  })

  it('renders a non-mermaid fenced block as code lines', () => {
    const doc = '```js\nconst a = 1\n```\nsecond line'
    expect(countDecorations(doc, doc.length)).toBeGreaterThan(0)
  })
})
