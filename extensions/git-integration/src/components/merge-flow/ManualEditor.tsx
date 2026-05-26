import React, { useEffect, useRef, useState } from 'react'
import { EditorView, lineNumbers, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import type { ConflictBlock } from '../../schemas/merge-flow.schema'

interface Props {
  block: ConflictBlock
  onSave: (text: string) => void
  onCancel: () => void
  suggestedText?: string | null
}

const CONFLICT_MARKER_RE = /^(<{7}.*|={7}|>{7}.*)\n?/gm

function stripConflictMarkers(text: string): string {
  return text.replace(CONFLICT_MARKER_RE, '')
}

function pickInitialText(block: ConflictBlock): string {
  if (block.isResolved && block.resolvedText) return block.resolvedText
  const cleanOurs = stripConflictMarkers(block.oursText)
  const cleanTheirs = stripConflictMarkers(block.theirsText)
  return cleanOurs.length > cleanTheirs.length ? cleanOurs : cleanTheirs
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

export function ManualEditor({ block, onSave, onCancel, suggestedText }: Props) {
  const initialText = pickInitialText(block)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [lineCount, setLineCount] = useState(initialText.split('\n').length)
  const [isEmpty, setIsEmpty] = useState(!initialText.trim())

  useEffect(() => {
    if (!containerRef.current) return

    const extensions = [
      oneDark,
      editorTheme,
      lineNumbers(),
      history(),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const content = update.state.doc.toString()
          setLineCount(update.state.doc.lines)
          setIsEmpty(!content.trim())
        }
      }),
    ]

    if (isJsLike(block.blockId)) {
      const isTsx = block.blockId.includes('.tsx') || block.blockId.includes('.jsx')
      extensions.push(javascript({ typescript: true, jsx: isTsx }))
    }

    const view = new EditorView({
      state: EditorState.create({ doc: initialText, extensions }),
      parent: containerRef.current,
    })

    viewRef.current = view
    view.focus()

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When the user picks "Keep mine" or "Keep theirs" while in edit mode, push the
  // new text into CodeMirror by replacing the whole document.
  useEffect(() => {
    const view = viewRef.current
    if (!view || suggestedText == null) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: suggestedText },
    })
    view.focus()
  }, [suggestedText])

  function handleSave() {
    const content = viewRef.current?.state.doc.toString() ?? ''
    onSave(content)
  }

  return (
    <div className="manual-editor">
      <div className="manual-editor__header">
        <span className="manual-editor__title">Edit manually</span>
        <span className="manual-editor__lang-badge">
          {isJsLike(block.blockId)
            ? block.blockId.includes('.ts') || block.blockId.includes('.tsx')
              ? 'TYPESCRIPT'
              : 'JAVASCRIPT'
            : 'TEXT'}
        </span>
        <span className="manual-editor__line-count">{lineCount} lines</span>
        <button className="manual-editor__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="manual-editor__body">
        <div ref={containerRef} className="manual-editor__cm-container" />
      </div>
      <div className="manual-editor__actions">
        <span className="manual-editor__hint">Tab inserts 2 spaces</span>
        <button className="manual-editor__save" onClick={handleSave} disabled={isEmpty}>
          Save &amp; confirm
        </button>
      </div>
    </div>
  )
}
