import React, { useEffect, useRef } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { python } from '@codemirror/lang-python'
import { java } from '@codemirror/lang-java'
import { json } from '@codemirror/lang-json'
import { cpp } from '@codemirror/lang-cpp'
import { yaml } from '@codemirror/lang-yaml'
import { go } from '@codemirror/legacy-modes/mode/go'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { StreamLanguage } from '@codemirror/language'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { livePreviewPlugin } from './livePreview'
import { highlightOverlayPlugin } from './highlightOverlay'
import {
  commentAnchorField,
  commentAnchorDecorations,
  hoveredAnchorField,
  setAnchors,
  setHoveredAnchor,
  type CommentAnchor,
} from './commentField'

export interface SelectionAnchor {
  from: number
  to: number
  quote: string
  prefix: string
  suffix: string
  lineTop: number
}

interface NoteEditorProps {
  initialDoc: string
  onChange: (doc: string) => void
  onAnchorsReady?: (getView: () => EditorView | null) => void
  onSelectionChange?: (sel: SelectionAnchor | null) => void
  readOnly?: boolean
}

export function NoteEditor({
  initialDoc,
  onChange,
  onAnchorsReady,
  onSelectionChange,
  readOnly,
}: NoteEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const readOnlyCompartment = useRef(new Compartment())
  const onSelectionChangeRef = useRef(onSelectionChange)
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    /* v8 ignore next */
    if (!containerRef.current) return

    const view = new EditorView({
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          history(),
          markdown({
            extensions: [GFM],
            codeLanguages: [
              LanguageDescription.of({
                name: 'JavaScript',
                alias: ['js', 'javascript', 'jsx', 'ts', 'tsx', 'typescript'],
                /* v8 ignore next */ load: async () => javascript(),
              }),
              LanguageDescription.of({
                name: 'CSS',
                alias: ['css'],
                /* v8 ignore next */ load: async () => css(),
              }),
              LanguageDescription.of({
                name: 'HTML',
                alias: ['html'],
                /* v8 ignore next */ load: async () => html(),
              }),
              LanguageDescription.of({
                name: 'Python',
                alias: ['python', 'py'],
                /* v8 ignore next */ load: async () => python(),
              }),
              LanguageDescription.of({
                name: 'Java',
                alias: ['java'],
                /* v8 ignore next */ load: async () => java(),
              }),
              LanguageDescription.of({
                name: 'JSON',
                alias: ['json'],
                /* v8 ignore next */ load: async () => json(),
              }),
              LanguageDescription.of({
                name: 'C++',
                alias: ['c', 'cpp', 'c++', 'cxx', 'cc'],
                /* v8 ignore next */ load: async () => cpp(),
              }),
              LanguageDescription.of({
                name: 'YAML',
                alias: ['yaml', 'yml'],
                /* v8 ignore next */ load: async () => yaml(),
              }),
              LanguageDescription.of({
                name: 'Go',
                alias: ['go', 'golang'],
                /* v8 ignore next */ load: async () => StreamLanguage.define(go),
              }),
              LanguageDescription.of({
                name: 'Shell',
                alias: ['sh', 'bash', 'shell', 'zsh'],
                /* v8 ignore next */ load: async () => StreamLanguage.define(shell),
              }),
            ],
          }),
          syntaxHighlighting(oneDarkHighlightStyle),
          livePreviewPlugin,
          highlightOverlayPlugin,
          commentAnchorField,
          hoveredAnchorField,
          commentAnchorDecorations,
          readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly ?? false)),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          /* v8 ignore next 3 */
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChange(update.state.doc.toString())

            /* v8 ignore next 20 */
            if (update.docChanged || update.selectionSet) {
              const sel = update.state.selection.main
              const cb = onSelectionChangeRef.current
              if (!cb) return
              if (sel.empty) {
                cb(null)
                return
              }
              const doc = update.state.doc.toString()
              const from = sel.from
              const to = sel.to
              const coords = update.view.coordsAtPos(from)
              const containerRect = update.view.dom.getBoundingClientRect()
              const lineTop = coords ? coords.top - containerRect.top : 0
              cb({
                from,
                to,
                quote: doc.slice(from, to),
                prefix: doc.slice(Math.max(0, from - 32), from),
                suffix: doc.slice(to, Math.min(doc.length, to + 32)),
                lineTop,
              })
            }
          }),
          EditorView.theme({
            '&': { height: '100%', fontFamily: 'inherit', caretColor: 'rgba(255,255,255,0.9)' },
            '.cm-content': {
              padding: '16px',
              minHeight: '100%',
              caretColor: 'rgba(255,255,255,0.9)',
            },
            '.cm-focused': { outline: 'none' },
            '.cm-cursor, .cm-dropCursor': {
              borderLeftWidth: '2px',
              borderLeftColor: 'rgba(255,255,255,0.9)',
              marginLeft: '-1px',
            },
            '.notepad-heading': { fontWeight: '600' },
            '.notepad-h1': { fontSize: '1.8em' },
            '.notepad-h2': { fontSize: '1.5em' },
            '.notepad-h3': { fontSize: '1.25em' },
            '.notepad-bold': { fontWeight: '700' },
            '.notepad-italic': { fontStyle: 'italic' },
            '.notepad-code': {
              fontFamily: 'monospace',
              background: 'rgba(128,128,128,0.1)',
              padding: '0 2px',
            },
            '.notepad-link': { textDecoration: 'underline', opacity: '0.8' },
            '.notepad-comment-anchor': {},
            '.notepad-comment-anchor--hover': {
              textDecoration: 'underline',
              textDecorationColor: 'rgba(120,200,255,0.9)',
              textDecorationThickness: '2px',
              textUnderlineOffset: '2px',
            },
            '.notepad-list-item-line': {
              paddingLeft: '4px',
            },
            '.notepad-strikethrough': {
              textDecoration: 'line-through',
              opacity: '0.6',
            },
            '.notepad-fence-hidden': {
              maxHeight: '0px',
              overflow: 'hidden',
              paddingTop: '0px',
              paddingBottom: '0px',
              fontSize: '0px',
              lineHeight: '0px',
            },
            '.notepad-code-block-line': {
              fontFamily: 'monospace',
              background: 'rgba(128,128,128,0.18)',
              borderLeft: '2px solid rgba(255,255,255,0.15)',
              padding: '0 8px',
            },
            '.notepad-blockquote-line': {
              borderLeft: '3px solid rgba(255,255,255,0.25)',
              paddingLeft: '12px',
              opacity: '0.75',
            },
            '.notepad-hr': {
              border: 'none',
              borderTop: '1px solid rgba(255,255,255,0.2)',
              margin: '0',
              display: 'block',
              width: '100%',
            },
            '.notepad-image-widget': {
              maxWidth: '100%',
              maxHeight: '300px',
              display: 'block',
              margin: '4px 0',
            },
          }),
        ],
      }),
      parent: containerRef.current,
    })

    viewRef.current = view
    onAnchorsReady?.(() => viewRef.current)

    /* v8 ignore next 4 */
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const view = viewRef.current
    /* v8 ignore next */
    if (!view) return
    const current = view.state.doc.toString()
    /* v8 ignore next 3 */
    if (current !== initialDoc) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: initialDoc } })
    }
  }, [initialDoc])

  useEffect(() => {
    const view = viewRef.current
    /* v8 ignore next 3 */
    if (!view) return
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly ?? false)),
    })
  }, [readOnly])

  return <div ref={containerRef} className="notepad-editor-cm" style={{ height: '100%' }} />
}

export function applyAnchors(view: EditorView | null, anchors: CommentAnchor[]): void {
  /* v8 ignore next */
  if (!view) return
  view.dispatch({ effects: [setAnchors.of(anchors)] })
}

export function setEditorHoverAnchor(view: EditorView | null, id: string | null): void {
  /* v8 ignore next */
  if (!view) return
  view.dispatch({ effects: [setHoveredAnchor.of(id)] })
}

export function scrollToAnchor(view: EditorView | null, from: number, to: number): void {
  /* v8 ignore next */
  if (!view) return
  view.dispatch({
    selection: { anchor: from, head: to },
    scrollIntoView: true,
  })
  view.focus()
}
