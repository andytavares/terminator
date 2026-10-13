import { RangeSetBuilder, StateEffect, StateField, type EditorState } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNodeRef } from '@lezer/common'
import {
  ALERT_LABELS,
  parseAlertMarker,
  parseInlineSpans,
  parseTable,
  type AlertKind,
  type InlineSpan,
  type ParsedTable,
  type TableCell,
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
/** A click on the link opens `url` in the system browser (a new window outside the app). */
function openOnClick(link: HTMLAnchorElement, url: string): void {
  link.addEventListener('click', (e) => {
    e.preventDefault()
    const api: { shell?: { openExternal?: (u: string) => void } } | undefined = window.electronAPI
    if (api?.shell?.openExternal) {
      api.shell.openExternal(url)
    } else {
      window.open(url, '_blank', 'noopener')
    }
  })
}

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
    openOnClick(a, this.url)
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
    const id = `mermaid-${crypto.randomUUID()}`
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

const INLINE_SPAN_TAGS = { code: 'code', strong: 'strong', em: 'em', del: 'del' } as const

function inlineSpanToDOM(span: InlineSpan): Node {
  if (span.type === 'text') return document.createTextNode(span.text)
  if (span.type === 'link') return inlineLinkToDOM(span.text, span.href ?? '')
  const el = document.createElement(INLINE_SPAN_TAGS[span.type])
  if (span.type === 'code') el.className = 'notepad-code'
  el.textContent = span.text
  return el
}

function inlineLinkToDOM(text: string, href: string): Node {
  const el = document.createElement('a')
  el.className = 'notepad-link-widget'
  el.textContent = text
  el.href = href
  el.title = href
  openOnClick(el, href)
  return el
}

/** @internal */
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
    thead.appendChild(this.rowElement(view, 'th', this.table.header))
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    for (const row of this.table.rows) tbody.appendChild(this.rowElement(view, 'td', row))
    table.appendChild(tbody)

    wrap.appendChild(table)
    return wrap
  }

  private rowElement(view: EditorView, tag: 'th' | 'td', cells: TableCell[]): HTMLElement {
    const tr = document.createElement('tr')
    cells.forEach((cell, i) => {
      const el = document.createElement(tag)
      const align = this.table.align[i]
      if (align) el.style.textAlign = align
      appendInline(el, cell.text)
      this.makeEditable(view, el, cell.offset)
      tr.appendChild(el)
    })
    return tr
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

/** @internal */
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

/** A span of the document. */
interface TextRange {
  from: number
  to: number
}

/** What every node handler needs to decide on and add its decorations. */
interface DecorationContext {
  state: EditorState
  builder: RangeSetBuilder<Decoration>
  cursorPos: number
  /** The node is on the caret's line and that line shows its raw markdown. */
  onCursorLine: boolean
}

/**
 * Adds a node's decorations. Returning false skips its children; returning
 * nothing lets the tree walk continue into them.
 */
type NodeDecorator = (node: SyntaxNodeRef, ctx: DecorationContext) => false | void

// focused defaults to true so callers that don't pass it (e.g. tests) get the
// original cursor-line raw-reveal behaviour.
/** @internal */
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
      return NODE_DECORATORS[node.name]?.(node, { state, builder, cursorPos, onCursorLine })
    },
  })

  return builder.finish()
}

/** Decorators that render nothing while their line shows raw markdown. */
function offCursorLine(decorate: NodeDecorator): NodeDecorator {
  return (node, ctx) => {
    if (!ctx.onCursorLine) decorate(node, ctx)
    return false
  }
}

/** Hides `markLen` characters at each end of the node and styles what lies between. */
function wrapped(markLen: (node: SyntaxNodeRef) => number, className: string): NodeDecorator {
  return offCursorLine((node, { builder }) => {
    const length = markLen(node)
    const contentFrom = node.from + length
    const contentTo = node.to - length
    if (contentFrom < contentTo) {
      builder.add(node.from, contentFrom, Decoration.replace({}))
      builder.add(contentFrom, contentTo, Decoration.mark({ class: className }))
      builder.add(contentTo, node.to, Decoration.replace({}))
    }
  })
}

const decorateHeading = offCursorLine((node, { builder }) => {
  const level = parseInt(node.name.slice(-1))
  const markerEnd = node.from + level + 1
  if (markerEnd < node.to) {
    builder.add(node.from, markerEnd, Decoration.replace({}))
    builder.add(markerEnd, node.to, Decoration.mark({ class: `notepad-heading notepad-h${level}` }))
  }
})

function strikethroughMarkLength(node: SyntaxNodeRef): number {
  const firstChild = node.node.firstChild
  /* v8 ignore next 2 */
  if (firstChild?.name === 'StrikethroughMark') return firstChild.to - firstChild.from
  return 2
}

const decorateInlineCode = offCursorLine((node, { builder }) => {
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
})

/** Adds a line decoration to every line from `from` up to (not including) `to`. */
function decorateLines(ctx: DecorationContext, range: TextRange, className: string) {
  const { state, builder } = ctx
  let line = state.doc.lineAt(range.from)
  for (;;) {
    builder.add(line.from, line.from, Decoration.line({ class: className }))
    const nextFrom = line.to + 1
    if (nextFrom >= range.to) break
    line = state.doc.lineAt(nextFrom)
  }
}

function caretWithin(ctx: DecorationContext, range: TextRange): boolean {
  return !ctx.state.readOnly && ctx.cursorPos >= range.from && ctx.cursorPos <= range.to
}

/**
 * While the caret is on the opening fence line the user is still typing the
 * ``` and its language, so nothing may render — otherwise the line collapses
 * out from under them mid-keystroke. Deliberately not gated on `focused`: that
 * flag only flips on a focus-change event, so a stale false made a half-typed
 * fence disappear.
 *
 * A fence with no body yet is a block under construction; leaving it raw is
 * what makes it appear only once there is something to show. With the caret in
 * the body, the code is styled but both fences stay visible, so the language
 * stays readable and clickable while editing.
 */
function decorateFencedCode(node: SyntaxNodeRef, ctx: DecorationContext): false {
  const openingLine = ctx.state.doc.lineAt(node.from)
  const codeText = node.node.getChild('CodeText')
  if (caretWithin(ctx, openingLine)) return false
  if (!codeText || codeText.to <= codeText.from) return false
  if (caretWithin(ctx, node)) {
    decorateLines(ctx, codeText, 'notepad-code-block-line')
    return false
  }

  const codeInfoNode = node.node.getChild('CodeInfo')
  const lang = codeInfoNode ? ctx.state.sliceDoc(codeInfoNode.from, codeInfoNode.to).trim() : ''
  if (lang === 'mermaid') {
    const code = ctx.state.sliceDoc(codeText.from, codeText.to)
    ctx.builder.add(node.from, node.to, Decoration.replace({ widget: new MermaidWidget(code) }))
    return false
  }
  renderCodeBlock(node, ctx, codeText)
  return false
}

/**
 * Opening fence: the line collapses to zero height through a line class, and
 * the fence text is replaced but not its trailing newline (codeText.from - 1),
 * so the code line keeps its own .cm-line element and its line decoration.
 * Closing fence: codeText.to is the newline ending the last code line, so the
 * closing fence line starts at codeText.to + 1.
 */
function renderCodeBlock(node: SyntaxNodeRef, ctx: DecorationContext, codeText: TextRange): void {
  const { state, builder } = ctx
  const fenceLine = state.doc.lineAt(node.from)
  builder.add(fenceLine.from, fenceLine.from, Decoration.line({ class: 'notepad-fence-hidden' }))
  builder.add(node.from, codeText.from - 1, Decoration.replace({}))

  decorateLines(ctx, codeText, 'notepad-code-block-line')

  const closingLineFrom = codeText.to + 1
  builder.add(closingLineFrom, closingLineFrom, Decoration.line({ class: 'notepad-fence-hidden' }))
  builder.add(closingLineFrom, node.to, Decoration.replace({}))
}

/**
 * Rendered as a whole: a table only reads as a grid if every row is replaced at
 * once. Raw pipes come back while the caret is inside, matching how FencedCode
 * behaves.
 *
 * Deliberately not gated on `focused`: that flag only flips on a focus-change
 * event, so a stale false kept the table rendered even with the caret inside
 * it — the caret then had nowhere to land and the table could not be edited at
 * all, by mouse or keyboard.
 *
 * Defensive checks: a Table node always carries a delimiter row, so parseTable
 * should never reject it, and falling through leaves the raw pipes visible
 * rather than throwing inside the state field. A block widget may only replace
 * whole lines; Table nodes do span whole lines, but a mismatch would throw and
 * take the whole editor down, so it falls back to an inline replace.
 */
function decorateTable(node: SyntaxNodeRef, ctx: DecorationContext): false {
  if (caretWithin(ctx, node)) return false
  const { state, builder } = ctx
  const source = state.sliceDoc(node.from, node.to)
  const parsed = parseTable(source)
  /* v8 ignore next */
  if (!parsed) return false
  /* v8 ignore next */
  const wholeLines =
    node.from === state.doc.lineAt(node.from).from && node.to === state.doc.lineAt(node.to).to
  builder.add(
    node.from,
    node.to,
    Decoration.replace({ widget: new TableWidget(source, parsed, node.from), block: wholeLines })
  )
  return false
}

/**
 * GitHub alerts (`> [!NOTE]`) are not a lezer construct — they parse as an
 * ordinary blockquote, so the marker is matched textually here. An ordinary
 * blockquote is left to QuoteMark. Not gated on `focused`, for the same reason
 * as Table above.
 */
function decorateBlockquote(node: SyntaxNodeRef, ctx: DecorationContext): false | void {
  const firstLine = ctx.state.doc.lineAt(node.from)
  const kind = parseAlertMarker(firstLine.text)
  if (kind === null) return
  if (caretWithin(ctx, node)) return false

  const { state, builder } = ctx
  let line = firstLine
  for (;;) {
    builder.add(
      line.from,
      line.from,
      Decoration.line({ class: `notepad-alert notepad-alert--${kind}` })
    )
    if (line.from === firstLine.from) {
      // Replace the whole marker line with the alert's title row.
      builder.add(line.from, line.to, Decoration.replace({ widget: new AlertHeaderWidget(kind) }))
    } else {
      hideQuoteMarker(builder, line)
    }
    const nextFrom = line.to + 1
    if (nextFrom > node.to) break
    line = state.doc.lineAt(nextFrom)
  }
  return false
}

function hideQuoteMarker(
  builder: RangeSetBuilder<Decoration>,
  line: { from: number; to: number; text: string }
): void {
  const markerLength = /^\s*>\s?/.exec(line.text)?.[0].length ?? 0
  if (markerLength > 0) {
    builder.add(line.from, Math.min(line.from + markerLength, line.to), Decoration.replace({}))
  }
}

const decorateQuoteMark = offCursorLine((node, { state, builder }) => {
  // Hide "> " marker + apply blockquote line styling
  const lineInfo = state.doc.lineAt(node.from)
  builder.add(lineInfo.from, lineInfo.from, Decoration.line({ class: 'notepad-blockquote-line' }))
  // Hide the mark and the space that follows it
  const hideEnd = Math.min(node.to + 1, lineInfo.to)
  builder.add(lineInfo.from, hideEnd, Decoration.replace({}))
})

const decorateHorizontalRule = offCursorLine((node, { builder }) => {
  builder.add(node.from, node.to, Decoration.replace({ widget: new HRWidget() }))
})

const decorateImage = offCursorLine((node, { state, builder }) => {
  const urlChild = node.node.getChild('URL')
  const url = urlChild ? state.sliceDoc(urlChild.from, urlChild.to) : ''
  // Alt text lives between "![" (2 chars) and "]" (before URL)
  const altEnd = urlChild ? urlChild.from - 2 : node.to
  const alt = state.sliceDoc(node.from + 2, altEnd)
  builder.add(node.from, node.to, Decoration.replace({ widget: new ImageWidget(alt, url) }))
})

function decorateListItem(node: SyntaxNodeRef, ctx: DecorationContext): void {
  const { state, builder, onCursorLine } = ctx
  if (onCursorLine) return // continue into children
  const parentName = node.node.parent?.name
  if (parentName === 'BulletList' || parentName === 'OrderedList') {
    const lineStart = state.doc.lineAt(node.from).from
    builder.add(lineStart, lineStart, Decoration.line({ class: 'notepad-list-item-line' }))
  }
}

const decorateListMark = offCursorLine((node, { builder }) => {
  const grandParent = node.node.parent?.parent
  if (grandParent?.name === 'BulletList') {
    builder.add(node.from, node.to, Decoration.replace({ widget: new BulletWidget() }))
  } else if (grandParent?.name === 'OrderedList') {
    builder.add(node.from, node.to, Decoration.mark({ class: 'notepad-ordered-mark' }))
  }
})

// GFM task list markers: [x] (checked) or [ ] (unchecked)
const decorateTaskMarker = offCursorLine((node, { state, builder }) => {
  const text = state.sliceDoc(node.from, node.to)
  const checked = text === '[x]' || text === '[X]'
  builder.add(
    node.from,
    node.to,
    Decoration.replace({ widget: new CheckboxWidget(checked, node.from, node.to) })
  )
})

const decorateLink = offCursorLine((node, { state, builder }) => {
  const urlChild = node.node.getChild('URL')
  if (!urlChild) return
  const url = state.sliceDoc(urlChild.from, urlChild.to)
  const raw = state.sliceDoc(node.from, urlChild.from - 2)
  const label = raw.startsWith('[') ? raw.slice(1, raw.lastIndexOf(']')) : url
  builder.add(node.from, node.to, Decoration.replace({ widget: new LinkWidget(label || url, url) }))
})

const NODE_DECORATORS: Record<string, NodeDecorator> = {
  ATXHeading1: decorateHeading,
  ATXHeading2: decorateHeading,
  ATXHeading3: decorateHeading,
  ATXHeading4: decorateHeading,
  ATXHeading5: decorateHeading,
  ATXHeading6: decorateHeading,
  StrongEmphasis: wrapped(() => 2, 'notepad-bold'),
  Emphasis: wrapped(() => 1, 'notepad-italic'),
  Strikethrough: wrapped(strikethroughMarkLength, 'notepad-strikethrough'),
  InlineCode: decorateInlineCode,
  FencedCode: decorateFencedCode,
  Table: decorateTable,
  Blockquote: decorateBlockquote,
  QuoteMark: decorateQuoteMark,
  HorizontalRule: decorateHorizontalRule,
  Image: decorateImage,
  ListItem: decorateListItem,
  ListMark: decorateListMark,
  TaskMarker: decorateTaskMarker,
  Link: decorateLink,
}

// StateField (not ViewPlugin) so that Decoration.replace() across line breaks is allowed.
// ViewPlugin decorations cannot replace newlines; StateField decorations can.
const livePreviewDecorations = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state, state.selection.main, false)
  },
  update(decos, tr) {
    const focusChanged = tr.effects.some((e) => e.is(setEditorFocused))
    // The first parse is time-boxed; the rest of the tree arrives later on its own.
    const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState)
    if (tr.docChanged || tr.selection || focusChanged || treeChanged) {
      const focused = tr.state.field(editorFocusedField)
      return buildDecorations(tr.state, tr.state.selection.main, focused)
    }
    return decos.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

// Export as an array so callers add all required extensions at once
export const livePreviewPlugin = [editorFocusedField, focusTrackPlugin, livePreviewDecorations]
