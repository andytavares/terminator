import { syntaxTree } from '@codemirror/language'
import type { EditorState, StateCommand } from '@codemirror/state'

// In live preview the `#` of a heading is hidden, so the caret at the start of
// the heading's text looks like it is at the start of the line. Pressing Enter
// there used to split the marker off its text: the `#` stayed behind on the old
// line (invisible, since an empty heading still renders as nothing) and the
// text moved down as an unformatted paragraph.
//
// Pressing Enter at the start of the visible text now pushes the whole heading
// down instead, which is what the rendered document implies.

const ATX_MARKER = /^(#{1,6})([ \t]+|$)/

/** Offset just past `# `, or null when the line is not an ATX heading. */
export function headingTextStart(state: EditorState, pos: number): number | null {
  const line = state.doc.lineAt(pos)
  const match = ATX_MARKER.exec(line.text)
  if (!match) return null

  // `# foo` inside a fenced code block is not a heading — trust the parse tree
  // over the regex.
  const node = syntaxTree(state).resolveInner(line.from, 1)
  let inHeading = false
  for (let cur: typeof node | null = node; cur; cur = cur.parent) {
    if (cur.name.startsWith('ATXHeading')) {
      inHeading = true
      break
    }
  }
  if (!inHeading) return null

  return line.from + match[0].length
}

export const insertNewlineKeepingHeadingMarker: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false

  const selection = state.selection.main
  if (!selection.empty) return false

  const textStart = headingTextStart(state, selection.head)
  if (textStart === null) return false
  // Only when the caret is at or before the start of the heading text. Splitting
  // mid-heading into a heading plus a paragraph is the conventional behaviour
  // and is left alone.
  if (selection.head > textStart) return false

  const line = state.doc.lineAt(selection.head)
  dispatch(
    state.update({
      changes: { from: line.from, insert: '\n' },
      selection: { anchor: selection.head + 1 },
      scrollIntoView: true,
      userEvent: 'input',
    })
  )
  return true
}
