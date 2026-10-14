import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState, type EditorStateConfig } from '@codemirror/state'

/** A state whose syntax tree covers the whole document: CodeMirror stops a new state's first parse
 *  after 20ms, so on a loaded machine `EditorState.create` can return a tree that ends early. */
export function parsedState(config: EditorStateConfig): EditorState {
  const state = EditorState.create(config)
  ensureSyntaxTree(state, state.doc.length, Infinity)
  // ensureSyntaxTree finishes the parse in place; a transaction publishes the tree.
  return state.update({}).state
}
