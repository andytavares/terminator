import { RangeSetBuilder, StateField, type EditorState } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

// ── Widgets ──────────────────────────────────────────────────────

/* v8 ignore start */
class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.textContent = '•'
    span.className = 'notepad-list-bullet'
    return span
  }
  eq(): boolean {
    return true
  }
  ignoreEvent(): boolean {
    return true
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly markerFrom: number,
    readonly markerTo: number
  ) {
    super()
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'notepad-task-wrap'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = this.checked
    cb.className = 'notepad-task-checkbox'
    cb.addEventListener('mousedown', (e) => {
      e.preventDefault()
    })
    cb.addEventListener('change', () => {
      const replacement = cb.checked ? '[x]' : '[ ]'
      view.dispatch({
        changes: { from: this.markerFrom, to: this.markerTo, insert: replacement },
      })
    })
    wrap.appendChild(cb)
    return wrap
  }

  ignoreEvent(): boolean {
    return false
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }
}

class LinkWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly url: string
  ) {
    super()
  }

  toDOM(): HTMLElement {
    const a = document.createElement('a')
    a.href = this.url
    a.textContent = this.label
    a.className = 'notepad-link-widget'
    a.title = this.url
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const api = (
        window as unknown as { electronAPI?: { shell?: { openExternal?: (u: string) => void } } }
      ).electronAPI
      if (api?.shell?.openExternal) {
        api.shell.openExternal(this.url)
      } else {
        window.open(this.url, '_blank', 'noopener')
      }
    })
    return a
  }

  ignoreEvent(): boolean {
    return false
  }

  eq(other: LinkWidget): boolean {
    return other.label === this.label && other.url === this.url
  }
}

class HRWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement('hr')
    hr.className = 'notepad-hr'
    return hr
  }
  eq(): boolean {
    return true
  }
  ignoreEvent(): boolean {
    return true
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly url: string
  ) {
    super()
  }

  toDOM(): HTMLElement {
    const img = document.createElement('img')
    img.src = this.url
    img.alt = this.alt
    img.className = 'notepad-image-widget'
    return img
  }

  eq(other: ImageWidget): boolean {
    return other.alt === this.alt && other.url === this.url
  }

  ignoreEvent(): boolean {
    return true
  }
}

/* v8 ignore stop */

// ── Decoration builder ────────────────────────────────────────────

export function buildDecorations(state: EditorState, selection: { anchor: number }): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const cursorPos = selection.anchor
  const cursorLine = state.doc.lineAt(cursorPos).number

  syntaxTree(state).iterate({
    enter(node) {
      const lineNum = state.doc.lineAt(node.from).number
      const onCursorLine = lineNum === cursorLine

      switch (node.name) {
        case 'ATXHeading1':
        case 'ATXHeading2':
        case 'ATXHeading3':
        case 'ATXHeading4':
        case 'ATXHeading5':
        case 'ATXHeading6': {
          if (!onCursorLine) {
            const level = parseInt(node.name.slice(-1))
            const markerEnd = node.from + level + 1
            if (markerEnd < node.to) {
              builder.add(node.from, markerEnd, Decoration.replace({}))
              builder.add(
                markerEnd,
                node.to,
                Decoration.mark({ class: `notepad-heading notepad-h${level}` })
              )
            }
          }
          return false
        }

        case 'StrongEmphasis': {
          if (!onCursorLine) {
            const contentFrom = node.from + 2
            const contentTo = node.to - 2
            if (contentFrom < contentTo) {
              builder.add(node.from, contentFrom, Decoration.replace({}))
              builder.add(contentFrom, contentTo, Decoration.mark({ class: 'notepad-bold' }))
              builder.add(contentTo, node.to, Decoration.replace({}))
            }
          }
          return false
        }

        case 'Emphasis': {
          if (!onCursorLine) {
            const contentFrom = node.from + 1
            const contentTo = node.to - 1
            if (contentFrom < contentTo) {
              builder.add(node.from, contentFrom, Decoration.replace({}))
              builder.add(contentFrom, contentTo, Decoration.mark({ class: 'notepad-italic' }))
              builder.add(contentTo, node.to, Decoration.replace({}))
            }
          }
          return false
        }

        case 'Strikethrough': {
          if (!onCursorLine) {
            const firstChild = node.node.firstChild
            /* v8 ignore next 2 */
            const markLen =
              firstChild?.name === 'StrikethroughMark' ? firstChild.to - firstChild.from : 2
            const contentFrom = node.from + markLen
            const contentTo = node.to - markLen
            if (contentFrom < contentTo) {
              builder.add(node.from, contentFrom, Decoration.replace({}))
              builder.add(
                contentFrom,
                contentTo,
                Decoration.mark({ class: 'notepad-strikethrough' })
              )
              builder.add(contentTo, node.to, Decoration.replace({}))
            }
          }
          return false
        }

        case 'InlineCode': {
          if (!onCursorLine) {
            // Hide backtick markers, style only the inner content
            const firstChild = node.node.firstChild
            const lastChild = node.node.lastChild
            /* v8 ignore next */
            const openEnd = firstChild?.name === 'CodeMark' ? firstChild.to : node.from + 1
            /* v8 ignore next */
            const closeStart = lastChild?.name === 'CodeMark' ? lastChild.from : node.to - 1
            if (openEnd < closeStart) {
              builder.add(node.from, openEnd, Decoration.replace({}))
              builder.add(openEnd, closeStart, Decoration.mark({ class: 'notepad-code' }))
              builder.add(closeStart, node.to, Decoration.replace({}))
            }
          }
          return false
        }

        case 'FencedCode': {
          // Show raw fences when cursor is anywhere inside the block
          const isInBlock = cursorPos >= node.from && cursorPos <= node.to
          if (!isInBlock) {
            const codeText = node.node.getChild('CodeText')
            if (codeText && codeText.to > codeText.from) {
              // Opening fence: collapse the line to zero-height by adding a line class
              // then replace the fence text (NOT the trailing \n) so the code line
              // keeps its own .cm-line element and gets its line decoration properly.
              const fenceLine = state.doc.lineAt(node.from)
              builder.add(
                fenceLine.from,
                fenceLine.from,
                Decoration.line({ class: 'notepad-fence-hidden' })
              )
              // codeText.from - 1 is the \n that ends the fence line — leave it untouched
              builder.add(node.from, codeText.from - 1, Decoration.replace({}))

              // Apply code block styling to each code content line
              let lineInfo = state.doc.lineAt(codeText.from)
              for (;;) {
                builder.add(
                  lineInfo.from,
                  lineInfo.from,
                  Decoration.line({ class: 'notepad-code-block-line' })
                )
                const nextFrom = lineInfo.to + 1
                if (nextFrom >= codeText.to) break
                lineInfo = state.doc.lineAt(nextFrom)
              }

              // Closing fence: codeText.to is the \n that ends the last code line.
              // codeText.to + 1 is the first char of the closing fence line.
              const closingLineFrom = codeText.to + 1
              builder.add(
                closingLineFrom,
                closingLineFrom,
                Decoration.line({ class: 'notepad-fence-hidden' })
              )
              builder.add(closingLineFrom, node.to, Decoration.replace({}))
              /* v8 ignore next 2 */
            } else {
              builder.add(node.from, node.to, Decoration.replace({}))
            }
          }
          return false
        }

        case 'QuoteMark': {
          // Hide "> " marker + apply blockquote line styling
          if (!onCursorLine) {
            const lineInfo = state.doc.lineAt(node.from)
            builder.add(
              lineInfo.from,
              lineInfo.from,
              Decoration.line({ class: 'notepad-blockquote-line' })
            )
            // Hide the mark and the space that follows it
            const hideEnd = Math.min(node.to + 1, lineInfo.to)
            builder.add(lineInfo.from, hideEnd, Decoration.replace({}))
          }
          return false
        }

        case 'HorizontalRule': {
          if (!onCursorLine) {
            builder.add(node.from, node.to, Decoration.replace({ widget: new HRWidget() }))
          }
          return false
        }

        case 'Image': {
          if (!onCursorLine) {
            const urlChild = node.node.getChild('URL')
            const url = urlChild ? state.sliceDoc(urlChild.from, urlChild.to) : ''
            // Alt text lives between "![" (2 chars) and "]" (before URL)
            const altEnd = urlChild ? urlChild.from - 2 : node.to
            const alt = state.sliceDoc(node.from + 2, altEnd)
            builder.add(
              node.from,
              node.to,
              Decoration.replace({ widget: new ImageWidget(alt, url) })
            )
          }
          return false
        }

        case 'ListItem': {
          if (!onCursorLine) {
            const parentName = node.node.parent?.name
            if (parentName === 'BulletList' || parentName === 'OrderedList') {
              const lineStart = state.doc.lineAt(node.from).from
              builder.add(
                lineStart,
                lineStart,
                Decoration.line({ class: 'notepad-list-item-line' })
              )
            }
          }
          break // continue into children
        }

        case 'ListMark': {
          if (!onCursorLine) {
            const grandParent = node.node.parent?.parent
            if (grandParent?.name === 'BulletList') {
              builder.add(
                node.from,
                node.to,
                Decoration.replace({
                  widget: new BulletWidget(),
                })
              )
            } else if (grandParent?.name === 'OrderedList') {
              builder.add(node.from, node.to, Decoration.mark({ class: 'notepad-ordered-mark' }))
            }
          }
          return false
        }

        case 'TaskMarker': {
          // GFM task list markers: [x] (checked) or [ ] (unchecked)
          if (!onCursorLine) {
            const text = state.sliceDoc(node.from, node.to)
            const checked = text === '[x]' || text === '[X]'
            builder.add(
              node.from,
              node.to,
              Decoration.replace({ widget: new CheckboxWidget(checked, node.from, node.to) })
            )
          }
          return false
        }

        case 'Paragraph': {
          break // continue into children
        }

        case 'Link': {
          const urlChild = node.node.getChild('URL')
          if (urlChild) {
            const url = state.sliceDoc(urlChild.from, urlChild.to)
            const raw = state.sliceDoc(node.from, urlChild.from - 2)
            const label = raw.startsWith('[') ? raw.slice(1, raw.lastIndexOf(']')) : url
            builder.add(
              node.from,
              node.to,
              Decoration.replace({ widget: new LinkWidget(label || url, url) })
            )
          }
          return false
        }
      }
    },
  })

  return builder.finish()
}

// StateField (not ViewPlugin) so that Decoration.replace() across line breaks is allowed.
// ViewPlugin decorations cannot replace newlines; StateField decorations can.
export const livePreviewPlugin = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state, state.selection.main)
  },
  update(decos, tr) {
    if (tr.docChanged || tr.selection) {
      return buildDecorations(tr.state, tr.state.selection.main)
    }
    return decos.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})
