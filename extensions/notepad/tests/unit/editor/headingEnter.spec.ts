import { describe, it, expect } from 'vitest'
import { EditorState, type StateCommand, type Transaction } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import {
  headingTextStart,
  insertNewlineKeepingHeadingMarker,
} from '../../../src/editor/headingEnter'

function makeState(doc: string, cursor: number, readOnly = false) {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ extensions: [GFM] }), EditorState.readOnly.of(readOnly)],
  })
}

/** Runs the command and returns the resulting doc, or null when it declined. */
function run(
  command: StateCommand,
  doc: string,
  cursor: number,
  readOnly = false
): { doc: string; cursor: number } | null {
  const state = makeState(doc, cursor, readOnly)
  let next: EditorState | null = null
  const handled = command({
    state,
    dispatch: (tr: Transaction) => {
      next = tr.state
    },
  })
  if (!handled || !next) return null
  return {
    doc: (next as EditorState).doc.toString(),
    cursor: (next as EditorState).selection.main.head,
  }
}

describe('headingTextStart', () => {
  it('points just past the marker and its space', () => {
    const state = makeState('# Hello', 0)
    expect(headingTextStart(state, 0)).toBe(2)
  })

  it('handles every heading level', () => {
    for (let level = 1; level <= 6; level++) {
      const marker = '#'.repeat(level)
      const state = makeState(`${marker} Title`, 0)
      expect(headingTextStart(state, 0)).toBe(level + 1)
    }
  })

  it('handles multiple spaces after the marker', () => {
    const state = makeState('##   Spaced', 0)
    expect(headingTextStart(state, 0)).toBe(5)
  })

  it('returns null for a paragraph', () => {
    const state = makeState('just text', 0)
    expect(headingTextStart(state, 0)).toBeNull()
  })

  it('returns null for a hash that is not a heading', () => {
    const state = makeState('a #tag in prose', 0)
    expect(headingTextStart(state, 0)).toBeNull()
  })

  it('returns null inside a fenced code block', () => {
    const doc = '```\n# not a heading\n```'
    const state = makeState(doc, doc.indexOf('# not'))
    expect(headingTextStart(state, doc.indexOf('# not'))).toBeNull()
  })

  it('returns null for more than six hashes', () => {
    const state = makeState('####### too many', 0)
    expect(headingTextStart(state, 0)).toBeNull()
  })
})

describe('insertNewlineKeepingHeadingMarker', () => {
  it('pushes the whole heading down when the caret is at the start of its text', () => {
    // The reported bug: this used to leave '# ' behind and move 'Hello' down
    // as an unformatted paragraph.
    const result = run(insertNewlineKeepingHeadingMarker, '# Hello', 2)
    expect(result?.doc).toBe('\n# Hello')
  })

  it('keeps the caret with the heading text', () => {
    const result = run(insertNewlineKeepingHeadingMarker, '# Hello', 2)
    expect(result?.cursor).toBe(3)
  })

  it('behaves the same with the caret before the marker', () => {
    const result = run(insertNewlineKeepingHeadingMarker, '# Hello', 0)
    expect(result?.doc).toBe('\n# Hello')
  })

  it('works part-way through the marker', () => {
    const result = run(insertNewlineKeepingHeadingMarker, '## Hello', 1)
    expect(result?.doc).toBe('\n## Hello')
  })

  it('leaves a heading with text before it intact', () => {
    const result = run(insertNewlineKeepingHeadingMarker, '# Hello\nbody', 2)
    expect(result?.doc).toBe('\n# Hello\nbody')
  })

  it('declines mid-heading so splitting into heading plus paragraph still works', () => {
    expect(run(insertNewlineKeepingHeadingMarker, '# Hello', 5)).toBeNull()
  })

  it('declines at the end of a heading so Enter starts a new line as usual', () => {
    expect(run(insertNewlineKeepingHeadingMarker, '# Hello', 7)).toBeNull()
  })

  it('declines on a paragraph', () => {
    expect(run(insertNewlineKeepingHeadingMarker, 'plain text', 0)).toBeNull()
  })

  it('declines on a list item', () => {
    expect(run(insertNewlineKeepingHeadingMarker, '- item', 2)).toBeNull()
  })

  it('declines when there is a selection rather than a caret', () => {
    const state = EditorState.create({
      doc: '# Hello',
      selection: { anchor: 2, head: 5 },
      extensions: [markdown({ extensions: [GFM] })],
    })
    const handled = insertNewlineKeepingHeadingMarker({ state, dispatch: () => {} })
    expect(handled).toBe(false)
  })

  it('declines in read-only mode', () => {
    expect(run(insertNewlineKeepingHeadingMarker, '# Hello', 2, true)).toBeNull()
  })

  it('declines inside a fenced code block that looks like a heading', () => {
    const doc = '```\n# not a heading\n```'
    expect(run(insertNewlineKeepingHeadingMarker, doc, doc.indexOf('# not') + 2)).toBeNull()
  })

  it('operates on the heading the caret is in, not the first one', () => {
    const result = run(insertNewlineKeepingHeadingMarker, '# One\n\n## Two', 9)
    expect(result?.doc).toBe('# One\n\n\n## Two')
  })
})
