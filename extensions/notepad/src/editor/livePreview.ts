import { RangeSetBuilder, StateEffect, StateField, type EditorState } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import {
  ALERT_LABELS,
  parseAlertMarker,
  parseInlineSpans,
  parseTable,
  type AlertKind,
  type InlineSpan,
  type ParsedTable,
} from './markdownTable'

// Track editor focus so cursor-line raw reveal only activates after the user
// has actually focused the editor (not on initial mount).
const setEditorFocused = StateEffect.define<boolean>()
const editorFocusedField = StateField.define<boolean>({
  create() {
    return false
  },
  update(focused, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEditorFocused)) return effect.value
    }
    return focused
  },
})
/* v8 ignore next 16 */
const focusTrackPlugin = ViewPlugin.define((view) => {
  // Seed from the live focus state. `focusChanged` only fires on a transition,
  // so a view created while already focused would stay marked unfocused and
  // render as though the user were not editing. Deferred because a view may not
  // dispatch during its own construction.
  if (view.hasFocus) {
    setTimeout(() => view.dispatch({ effects: setEditorFocused.of(true) }), 0)
  }
  return {
    update(update) {
      if (update.focusChanged) {
        view.dispatch({ effects: setEditorFocused.of(view.hasFocus) })
      }
    },
  }
})

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
      if (view.state.readOnly) {
        cb.checked = this.checked
        return
      }
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

class MermaidWidget extends WidgetType {
  constructor(readonly code: string) {
    super()
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'notepad-mermaid'
    const id = `mermaid-${Math.random().toString(36).slice(2)}`
    void import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: 'dark' })
      void mermaid.render(id, this.code).then(({ svg }) => {
        container.innerHTML = svg
      })
    })
    return container
  }

  eq(other: MermaidWidget): boolean {
    return other.code === this.code
  }

  ignoreEvent(): boolean {
    return true
  }
}

function appendInline(parent: HTMLElement, text: string): void {
  for (const span of parseInlineSpans(text)) {
    parent.appendChild(inlineSpanToDOM(span))
  }
}

function inlineSpanToDOM(span: InlineSpan): Node {
  switch (span.type) {
    case 'text':
      return document.createTextNode(span.text)
    case 'code': {
      const el = document.createElement('code')
      el.className = 'notepad-code'
      el.textContent = span.text
      return el
    }
    case 'strong': {
      const el = document.createElement('strong')
      el.textContent = span.text
      return el
    }
    case 'em': {
      const el = document.createElement('em')
      el.textContent = span.text
      return el
    }
    case 'del': {
      const el = document.createElement('del')
      el.textContent = span.text
      return el
    }
    case 'link': {
      const el = document.createElement('a')
      el.className = 'notepad-link-widget'
      el.textContent = span.text
      el.href = span.href ?? ''
      el.title = span.href ?? ''
      el.addEventListener('click', (e) => {
        e.preventDefault()
        const api = (
          window as unknown as { electronAPI?: { shell?: { openExternal?: (u: string) => void } } }
        ).electronAPI
        if (api?.shell?.openExternal) {
          api.shell.openExternal(span.href ?? '')
        } else {
          window.open(span.href ?? '', '_blank', 'noopener')
        }
      })
      return el
    }
  }
}

export class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly table: ParsedTable,
    /** Document offset the table source starts at, used to place the caret. */
    readonly from: number
  ) {
    super()
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'notepad-table-wrap'
    const table = document.createElement('table')
    table.className = 'notepad-table'
    table.title = 'Click a cell to edit'

    const thead = document.createElement('thead')
    const headRow = document.createElement('tr')
    this.table.header.forEach((cell, i) => {
      const th = document.createElement('th')
      const align = this.table.align[i]
      if (align) th.style.textAlign = align
      appendInline(th, cell.text)
      this.makeEditable(view, th, cell.offset)
      headRow.appendChild(th)
    })
    thead.appendChild(headRow)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    for (const row of this.table.rows) {
      const tr = document.createElement('tr')
      row.forEach((cell, i) => {
        const td = document.createElement('td')
        const align = this.table.align[i]
        if (align) td.style.textAlign = align
        appendInline(td, cell.text)
        this.makeEditable(view, td, cell.offset)
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)

    wrap.appendChild(table)
    return wrap
  }

  /**
   * A replaced range is unreachable by clicking, so without this the caret can
   * never get inside a rendered table and it becomes uneditable. Clicking a
   * cell drops the caret into that cell's source, which reveals the raw
   * markdown (the decoration yields whenever the cursor is inside the table).
   */
  private makeEditable(view: EditorView, cell: HTMLElement, offset: number): void {
    cell.addEventListener('mousedown', (event) => {
      event.preventDefault()
      const pos = Math.min(this.from + offset, view.state.doc.length)
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
      view.focus()
    })
  }

  eq(other: TableWidget): boolean {
    return other.source === this.source && other.from === this.from
  }

  ignoreEvent(): boolean {
    // The widget handles its own mousedown; letting CodeMirror also process
    // events inside replaced content puts the caret in the wrong place.
    return true
  }
}

const ALERT_GLYPHS: Record<AlertKind, string> = {
  note: 'i',
  tip: '★',
  important: '!',
  warning: '▲',
  caution: '✕',
}

export class AlertHeaderWidget extends WidgetType {
  constructor(readonly kind: AlertKind) {
    super()
  }

  toDOM(): HTMLElement {
    const header = document.createElement('span')
    header.className = `notepad-alert__header notepad-alert__header--${this.kind}`
    const icon = document.createElement('span')
    icon.className = 'notepad-alert__icon'
    icon.textContent = ALERT_GLYPHS[this.kind]
    icon.setAttribute('aria-hidden', 'true')
    const label = document.createElement('span')
    label.className = 'notepad-alert__label'
    label.textContent = ALERT_LABELS[this.kind]
    header.appendChild(icon)
    header.appendChild(label)
    return header
  }

  eq(other: AlertHeaderWidget): boolean {
    return other.kind === this.kind
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

// focused defaults to true so callers that don't pass it (e.g. tests) get the
// original cursor-line raw-reveal behaviour.
export function buildDecorations(
  state: EditorState,
  selection: { anchor: number },
  focused = true
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const cursorPos = selection.anchor
  const cursorLine = state.doc.lineAt(cursorPos).number
  // Reveal raw markdown on the cursor line only when focused & not read-only.
  // Before the editor gains focus (initial mount) or in read-only mode, render fully.
  const revealCursorLine = focused && !state.readOnly

  syntaxTree(state).iterate({
    enter(node) {
      const lineNum = state.doc.lineAt(node.from).number
      const onCursorLine = revealCursorLine && lineNum === cursorLine

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
          const editable = !state.readOnly
          const openingLine = state.doc.lineAt(node.from)
          const codeText = node.node.getChild('CodeText')

          // While the caret is on the opening fence line the user is still
          // typing the ``` and its language, so nothing may render — otherwise
          // the line collapses out from under them mid-keystroke. Deliberately
          // not gated on `focused`: that flag only flips on a focus-change
          // event, so a stale false made a half-typed fence disappear.
          if (editable && cursorPos >= openingLine.from && cursorPos <= openingLine.to) {
            return false
          }

          // A fence with no body yet is a block under construction. Leaving it
          // raw is what makes it appear only once there is something to show.
          if (!codeText || codeText.to <= codeText.from) return false

          // Caret in the body: style the code but keep both fences visible, so
          // the language stays readable and clickable while editing.
          if (editable && cursorPos >= node.from && cursorPos <= node.to) {
            let bodyLine = state.doc.lineAt(codeText.from)
            for (;;) {
              builder.add(
                bodyLine.from,
                bodyLine.from,
                Decoration.line({ class: 'notepad-code-block-line' })
              )
              const nextFrom = bodyLine.to + 1
              if (nextFrom >= codeText.to) break
              bodyLine = state.doc.lineAt(nextFrom)
            }
            return false
          }

          {
            const codeInfoNode = node.node.getChild('CodeInfo')
            const lang = codeInfoNode
              ? state.sliceDoc(codeInfoNode.from, codeInfoNode.to).trim()
              : ''
            if (lang === 'mermaid') {
              const code = state.sliceDoc(codeText.from, codeText.to)
              builder.add(
                node.from,
                node.to,
                Decoration.replace({ widget: new MermaidWidget(code) })
              )
              return false
            }
            {
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
            }
          }
          return false
        }

        case 'Table': {
          // Rendered as a whole: a table only reads as a grid if every row is
          // replaced at once. Raw pipes come back while the caret is inside,
          // matching how FencedCode behaves.
          //
          // Deliberately not gated on `focused`: that flag only flips on a
          // focus-change event, so a stale false kept the table rendered even
          // with the caret inside it — the caret then had nowhere to land and
          // the table could not be edited at all, by mouse or keyboard.
          const isInTable = !state.readOnly && cursorPos >= node.from && cursorPos <= node.to
          if (!isInTable) {
            const source = state.sliceDoc(node.from, node.to)
            const parsed = parseTable(source)
            // Defensive: a Table node always carries a delimiter row, so
            // parseTable should never reject it. Falling through leaves the
            // raw pipes visible rather than throwing inside the state field.
            /* v8 ignore next */
            if (parsed) {
              const startLine = state.doc.lineAt(node.from)
              const endLine = state.doc.lineAt(node.to)
              // Defensive: a block widget may only replace whole lines. Table
              // nodes do span whole lines, but a mismatch here would throw and
              // take the whole editor down, so fall back to an inline replace.
              /* v8 ignore next */
              const wholeLines = node.from === startLine.from && node.to === endLine.to
              builder.add(
                node.from,
                node.to,
                Decoration.replace({
                  widget: new TableWidget(source, parsed, node.from),
                  block: wholeLines,
                })
              )
            }
          }
          return false
        }

        case 'Blockquote': {
          // GitHub alerts (`> [!NOTE]`) are not a lezer construct — they parse
          // as an ordinary blockquote, so the marker is matched textually here.
          const firstLine = state.doc.lineAt(node.from)
          const kind = parseAlertMarker(firstLine.text)
          if (kind === null) break // ordinary blockquote — let QuoteMark handle it

          // Not gated on `focused`, for the same reason as Table above.
          const isInAlert = !state.readOnly && cursorPos >= node.from && cursorPos <= node.to
          if (isInAlert) return false

          let line = firstLine
          for (;;) {
            builder.add(
              line.from,
              line.from,
              Decoration.line({ class: `notepad-alert notepad-alert--${kind}` })
            )
            if (line.from === firstLine.from) {
              // Replace the whole marker line with the alert's title row.
              builder.add(
                line.from,
                line.to,
                Decoration.replace({ widget: new AlertHeaderWidget(kind) })
              )
            } else {
              const markerLength = /^\s*>\s?/.exec(line.text)?.[0].length ?? 0
              if (markerLength > 0) {
                builder.add(
                  line.from,
                  Math.min(line.from + markerLength, line.to),
                  Decoration.replace({})
                )
              }
            }
            const nextFrom = line.to + 1
            if (nextFrom > node.to) break
            line = state.doc.lineAt(nextFrom)
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
          if (!onCursorLine) {
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
const livePreviewDecorations = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state, state.selection.main, false)
  },
  update(decos, tr) {
    const focusChanged = tr.effects.some((e) => e.is(setEditorFocused))
    if (tr.docChanged || tr.selection || focusChanged) {
      const focused = tr.state.field(editorFocusedField)
      return buildDecorations(tr.state, tr.state.selection.main, focused)
    }
    return decos.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

// Export as an array so callers add all required extensions at once
export const livePreviewPlugin = [editorFocusedField, focusTrackPlugin, livePreviewDecorations]
