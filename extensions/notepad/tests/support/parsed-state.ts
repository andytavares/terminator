import { EditorState, type EditorStateConfig } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'

/**
 * A state whose document is parsed to the end. EditorState.create parses for
 * at most 20 ms (CodeMirror's Work.Apply) and leaves the rest to a view's
 * background parser; a spec has no view, and a loaded machine runs out of the
 * 20 ms, so a spec that reads the tree builds its state here.
 */
export function parsedState(config: EditorStateConfig): EditorState {
  const state = EditorState.create(config)
  ensureSyntaxTree(state, state.doc.length, 10_000)
  return state.update({}).state
}
