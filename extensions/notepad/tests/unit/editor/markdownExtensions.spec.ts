import { describe, it, expect } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'

// The module under test — does not exist yet, so imports will fail until T027
import { toggleCheckbox, markdownExtensions } from '../../../src/editor/markdownExtensions'

describe('toggleCheckbox', () => {
  function makeView(doc: string, pos: number) {
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(pos),
      extensions: [markdown()],
    })
    const dispatched: Parameters<typeof state.update>[] = []
    const view = {
      state,
      dispatch(...args: Parameters<typeof state.update>) {
        dispatched.push(args)
        ;(view as { state: EditorState }).state = state.update(...args).state
      },
      dispatched,
    }
    return view
  }

  it('changes [ ] to [x] at the given position', () => {
    const doc = '- [ ] todo item\n'
    const view = makeView(doc, 2)
    // pos of '[ ]' open bracket
    const checkboxPos = doc.indexOf('[ ]')
    toggleCheckbox(view as never, checkboxPos)
    expect(view.state.doc.toString()).toContain('[x]')
  })

  it('changes [x] to [ ] at the given position', () => {
    const doc = '- [x] done item\n'
    const view = makeView(doc, 2)
    const checkboxPos = doc.indexOf('[x]')
    toggleCheckbox(view as never, checkboxPos)
    expect(view.state.doc.toString()).toContain('[ ]')
  })

  it('does nothing when pos is not on a checkbox', () => {
    const doc = 'plain text line\n'
    const view = makeView(doc, 0)
    const before = view.state.doc.toString()
    toggleCheckbox(view as never, 0)
    expect(view.state.doc.toString()).toBe(before)
  })
})

describe('markdownExtensions', () => {
  it('exports an array of CM6 extensions', () => {
    expect(Array.isArray(markdownExtensions)).toBe(true)
    expect(markdownExtensions.length).toBeGreaterThan(0)
  })
})
