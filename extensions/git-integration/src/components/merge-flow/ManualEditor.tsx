import React, { useEffect, useRef, useState } from 'react'
import { Button } from '@terminator/extension-ui'
import { EditorView, lineNumbers, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import type { ConflictBlock } from '../../schemas/merge-flow.schema'
import { stripConflictMarkers } from '../../utils/conflict-markers'

interface Props {
  block: ConflictBlock
  onSave: (text: string) => void
  onCancel: () => void
  suggestedText?: string | null
}

function pickInitialText(block: ConflictBlock): string {
  if (block.isResolved && block.resolvedText) return block.resolvedText
  const cleanOurs = stripConflictMarkers(block.oursText)
  const cleanTheirs = stripConflictMarkers(block.theirsText)
  if (cleanOurs.length > cleanTheirs.length) return cleanOurs
  return cleanTheirs
}

function isJsLike(blockId: string): boolean {
  const path = blockId.slice(0, blockId.lastIndexOf('#'))
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)
}

const editorTheme = EditorView.theme(
  {
    '&': { height: '100%' },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'var(--tm-font-mono, monospace)',
      fontSize: '13px',
    },
    '.cm-content': { padding: '8px 0' },
    '.cm-gutters': {
      borderRight: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(0,0,0,0.2)',
      minWidth: '40px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 12px 0 8px',
      color: 'rgba(255,255,255,0.3)',
      fontSize: '12px',
    },
    '.cm-activeLine': { background: 'rgba(255,255,255,0.04)' },
    '.cm-activeLineGutter': { background: 'rgba(255,255,255,0.06)' },
    '.cm-cursor': { borderLeftColor: '#fff' },
  },
  { dark: true }
)

function languageLabel(blockId: string): string {
  if (!isJsLike(blockId)) return 'Plain text'
  if (blockId.includes('.ts') || blockId.includes('.tsx')) return 'TypeScript'
  return 'JavaScript'
}

/** The editor's extensions; JS and TS files get highlighting, with JSX for .tsx and .jsx. */
function editorExtensions(blockId: string, onDocChange: (doc: EditorState['doc']) => void) {
  const extensions = [
    oneDark,
    editorTheme,
    lineNumbers(),
    history(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onDocChange(update.state.doc)
    }),
  ]
  if (isJsLike(blockId)) {
    const isTsx = blockId.includes('.tsx') || blockId.includes('.jsx')
    extensions.push(javascript({ typescript: true, jsx: isTsx }))
  }
  return extensions
}

/** A CodeMirror editor in `containerRef`, created once with `initialText`. */
function useCodeMirror(
  containerRef: React.RefObject<HTMLDivElement | null>,
  setup: { blockId: string; initialText: string },
  onDocChange: (doc: EditorState['doc']) => void
) {
  const viewRef = useRef<EditorView | null>(null)
  useEffect(() => {
    if (!containerRef.current) return
    const extensions = editorExtensions(setup.blockId, onDocChange)
    const view = new EditorView({
      state: EditorState.create({ doc: setup.initialText, extensions }),
      parent: containerRef.current,
    })
    viewRef.current = view
    view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return viewRef
}

/** Replaces the whole document with `text`: "Keep mine" or "Keep theirs" picked while editing. */
function useSuggestedText(
  viewRef: React.RefObject<EditorView | null>,
  text: string | null | undefined
) {
  useEffect(() => {
    const view = viewRef.current
    if (!view || text == null) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    view.focus()
  }, [viewRef, text])
}

function EditorHeader(props: { blockId: string; lineCount: number; onCancel: () => void }) {
  return (
    <div className="manual-editor__header">
      <span className="manual-editor__title">Edit manually</span>
      <span className="manual-editor__lang-badge">{languageLabel(props.blockId)}</span>
      <span className="manual-editor__line-count">{props.lineCount} lines</span>
      <Button size="sm" onClick={props.onCancel}>
        Cancel
      </Button>
    </div>
  )
}

export function ManualEditor(props: Props) {
  const { block, onSave, onCancel } = props
  const initialText = pickInitialText(block)
  const containerRef = useRef<HTMLDivElement>(null)
  const [lineCount, setLineCount] = useState(initialText.split('\n').length)
  const [isEmpty, setIsEmpty] = useState(!initialText.trim())
  const viewRef = useCodeMirror(containerRef, { blockId: block.blockId, initialText }, (doc) => {
    setLineCount(doc.lines)
    setIsEmpty(!doc.toString().trim())
  })
  useSuggestedText(viewRef, props.suggestedText)
  const saveEditorText = () => onSave(viewRef.current?.state.doc.toString() ?? '')
  return (
    <div className="manual-editor">
      <EditorHeader blockId={block.blockId} lineCount={lineCount} onCancel={onCancel} />
      <div className="manual-editor__body">
        <div ref={containerRef} className="manual-editor__cm-container" />
      </div>
      <div className="manual-editor__actions">
        <span className="manual-editor__hint">Tab inserts 2 spaces</span>
        <Button variant="primary" size="sm" onClick={saveEditorText} disabled={isEmpty}>
          Save &amp; confirm
        </Button>
      </div>
    </div>
  )
}
