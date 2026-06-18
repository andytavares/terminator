import { RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNodeRef } from '@lezer/common'

// ──────────────────────────────────────────────────────────────
// Checkbox widget
// ──────────────────────────────────────────────────────────────

const UNCHECKED_RE = /\[ \]/
const CHECKED_RE = /\[x\]/i

export function toggleCheckbox(view: EditorView, pos: number): void {
  const line = view.state.doc.lineAt(pos)
  const text = line.text

  const uncheckedIdx = text.search(UNCHECKED_RE)
  if (uncheckedIdx !== -1) {
    const from = line.from + uncheckedIdx
    view.dispatch({ changes: { from, to: from + 3, insert: '[x]' } })
    return
  }
  const checkedIdx = text.search(CHECKED_RE)
  if (checkedIdx !== -1) {
    const from = line.from + checkedIdx
    view.dispatch({ changes: { from, to: from + 3, insert: '[ ]' } })
  }
}

// ──────────────────────────────────────────────────────────────
// Checkbox ViewPlugin (all DOM-heavy — excluded from coverage)
// ──────────────────────────────────────────────────────────────

/* v8 ignore start */
class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number
  ) {
    super()
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('input')
    el.type = 'checkbox'
    el.checked = this.checked
    el.className = 'notepad-checkbox'
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      toggleCheckbox(view, this.pos)
    })
    return el
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof CheckboxWidget && other.checked === this.checked && other.pos === this.pos
    )
  }
}

function buildCheckboxDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number

  syntaxTree(view.state).iterate({
    enter(node: SyntaxNodeRef) {
      if (node.name === 'ListItem') {
        const line = view.state.doc.lineAt(node.from)
        if (line.number === cursorLine) return false

        const text = line.text
        const uncheckedIdx = text.search(UNCHECKED_RE)
        const checkedIdx = text.search(CHECKED_RE)

        if (uncheckedIdx !== -1) {
          const from = line.from + uncheckedIdx
          builder.add(
            from,
            from + 3,
            Decoration.replace({
              widget: new CheckboxWidget(false, from),
            })
          )
        } else if (checkedIdx !== -1) {
          const from = line.from + checkedIdx
          builder.add(
            from,
            from + 3,
            Decoration.replace({
              widget: new CheckboxWidget(true, from),
            })
          )
        }
        return false
      }
    },
  })
  return builder.finish()
}

const checkboxPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildCheckboxDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildCheckboxDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)
/* v8 ignore stop */

// ──────────────────────────────────────────────────────────────
// Exported extension array
// ──────────────────────────────────────────────────────────────

export const markdownExtensions = [checkboxPlugin]
