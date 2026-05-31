import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, X } from 'lucide-react'
import hljs from 'highlight.js'
import 'highlight.js/styles/atom-one-dark.css'

// ── Language detection ────────────────────────────────────────────────────────

const EXT_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  md: 'markdown',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sql: 'sql',
  xml: 'xml',
  toml: 'ini',
  ini: 'ini',
  asm: 'x86asm',
  s: 'x86asm',
}

function detectLang(filePath?: string): string | undefined {
  if (!filePath) return undefined
  const name = filePath.split('/').pop()?.toLowerCase() ?? ''
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile' || name === 'gnumakefile') return 'makefile'
  const ext = name.split('.').pop() ?? ''
  return EXT_MAP[ext]
}

// ── Diff parsing ──────────────────────────────────────────────────────────────

export interface DiffLine {
  index: number
  type: 'add' | 'remove' | 'context' | 'meta'
  prefix: '+' | '-' | ' ' | ''
  content: string
  newLineNum?: number
  oldLineNum?: number
}

export function parseDiff(raw: string): DiffLine[] {
  const lines: DiffLine[] = []
  let idx = 0
  let newLine = 0
  let oldLine = 0

  for (const line of raw.split('\n')) {
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++')
    ) {
      lines.push({ index: idx++, type: 'meta', prefix: '', content: line })
    } else if (line.startsWith('@@')) {
      // Parse @@ -old,count +new,count @@
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (m) {
        oldLine = parseInt(m[1], 10)
        newLine = parseInt(m[2], 10)
      }
      lines.push({ index: idx++, type: 'meta', prefix: '', content: line })
    } else if (line.startsWith('+')) {
      lines.push({
        index: idx++,
        type: 'add',
        prefix: '+',
        content: line.slice(1),
        newLineNum: newLine++,
      })
    } else if (line.startsWith('-')) {
      lines.push({
        index: idx++,
        type: 'remove',
        prefix: '-',
        content: line.slice(1),
        oldLineNum: oldLine++,
      })
    } else {
      lines.push({
        index: idx++,
        type: 'context',
        prefix: ' ',
        content: line.slice(1) || line,
        newLineNum: newLine++,
        oldLineNum: oldLine++,
      })
    }
  }
  return lines
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlightLine(content: string, lang?: string): string {
  if (!content.trim()) return escapeHtml(content) || '&nbsp;'
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value
    }
    return escapeHtml(content)
  } catch {
    return escapeHtml(content)
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DiffAnnotation {
  id: string
  filePath: string
  lineIndices: number[]
  text: string
}

interface Props {
  diff: string
  filePath?: string
  /** When provided, enables line selection and annotation UI */
  annotations?: DiffAnnotation[]
  onAnnotate?: (lineIndices: number[], text: string) => void
  onRemoveAnnotation?: (id: string) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DiffViewer({
  diff,
  filePath,
  annotations = [],
  onAnnotate,
  onRemoveAnnotation,
}: Props) {
  const [dragAnchor, setDragAnchor] = useState<number | null>(null)
  const [dragCurrent, setDragCurrent] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [committed, setCommitted] = useState<Set<number>>(new Set())
  const [pendingText, setPendingText] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const lang = detectLang(filePath)
  const lines = parseDiff(diff)
  const selectable = !!onAnnotate

  // While dragging, selection is the live drag range; after release it stays
  const selectedLines = useMemo<Set<number>>(() => {
    if (dragAnchor === null || dragCurrent === null) return committed
    const lo = Math.min(dragAnchor, dragCurrent)
    const hi = Math.max(dragAnchor, dragCurrent)
    const s = new Set<number>()
    for (let i = lo; i <= hi; i++) s.add(i)
    return s
  }, [dragAnchor, dragCurrent, committed])

  const lastSelected = selectedLines.size > 0 ? Math.max(...selectedLines) : null

  // Release drag on mouseup anywhere in the document
  useEffect(() => {
    if (!selectable) return
    function onMouseUp() {
      if (isDragging) {
        setIsDragging(false)
        // Commit the current drag selection
        if (dragAnchor !== null && dragCurrent !== null) {
          const lo = Math.min(dragAnchor, dragCurrent)
          const hi = Math.max(dragAnchor, dragCurrent)
          const s = new Set<number>()
          for (let i = lo; i <= hi; i++) s.add(i)
          setCommitted(s)
        }
      }
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [isDragging, dragAnchor, dragCurrent, selectable])

  function handleMouseDown(idx: number, e: React.MouseEvent) {
    if (!selectable || e.button !== 0) return
    e.preventDefault()
    setDragAnchor(idx)
    setDragCurrent(idx)
    setIsDragging(true)
    setCommitted(new Set())
    setPendingText('')
  }

  function handleMouseEnter(idx: number) {
    if (!isDragging) return
    setDragCurrent(idx)
  }

  function clearSelection() {
    setDragAnchor(null)
    setDragCurrent(null)
    setCommitted(new Set())
    setPendingText('')
  }

  function submitAnnotation() {
    if (!pendingText.trim() || selectedLines.size === 0 || !onAnnotate) return
    onAnnotate(
      [...selectedLines].sort((a, b) => a - b),
      pendingText.trim()
    )
    clearSelection()
  }

  // Build annotation lookup maps
  const annotationTail = new Map<number, DiffAnnotation>()
  const annotatedLineSet = new Set<number>()
  for (const ann of annotations) {
    for (const li of ann.lineIndices) annotatedLineSet.add(li)
    const last = ann.lineIndices[ann.lineIndices.length - 1]
    if (last !== undefined) annotationTail.set(last, ann)
  }

  if (!diff) {
    return (
      <div style={{ padding: 12, color: 'var(--tm-text-muted)', fontSize: 11 }}>
        Select a file to view its diff.
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ fontFamily: 'var(--tm-font-mono)', fontSize: 11 }}>
      {lines.map((line) => {
        const isSelected = selectedLines.has(line.index)
        const isAnnotated = annotatedLineSet.has(line.index)
        const tailAnnotation = annotationTail.get(line.index)
        const isLastSelected = !isDragging && line.index === lastSelected

        const lineBg = isSelected
          ? 'rgba(99,102,241,0.2)'
          : line.type === 'add'
            ? 'rgba(74,222,128,0.07)'
            : line.type === 'remove'
              ? 'rgba(248,113,113,0.07)'
              : 'transparent'

        const prefixColor =
          line.type === 'add'
            ? 'var(--tm-success)'
            : line.type === 'remove'
              ? 'var(--tm-danger)'
              : line.type === 'meta'
                ? 'var(--tm-accent)'
                : 'var(--tm-text-muted)'

        const leftBorder = isSelected
          ? '2px solid var(--tm-accent)'
          : isAnnotated
            ? '2px solid var(--tm-warning)'
            : '2px solid transparent'

        const highlighted =
          line.type === 'meta'
            ? `<span style="color:var(--tm-text-muted);opacity:0.7">${escapeHtml(line.content)}</span>`
            : highlightLine(line.content, lang)

        const oldNum = line.oldLineNum !== undefined ? String(line.oldLineNum) : ''
        const newNum = line.newLineNum !== undefined ? String(line.newLineNum) : ''

        return (
          <React.Fragment key={line.index}>
            <div
              onMouseDown={(e) => handleMouseDown(line.index, e)}
              onMouseEnter={() => handleMouseEnter(line.index)}
              style={{
                display: 'flex',
                alignItems: 'stretch',
                background: lineBg,
                borderLeft: leftBorder,
                cursor: selectable && line.type !== 'meta' ? 'crosshair' : 'default',
                userSelect: 'none',
                minHeight: '1.5em',
                lineHeight: '1.5',
              }}
            >
              {/* Old line number */}
              <span
                style={{
                  width: 36,
                  flexShrink: 0,
                  textAlign: 'right',
                  paddingRight: 6,
                  color: 'var(--tm-text-muted)',
                  opacity: 0.4,
                  fontSize: 10,
                  paddingTop: 1,
                  borderRight: '1px solid var(--tm-border)',
                  marginRight: 6,
                  userSelect: 'none',
                }}
              >
                {oldNum}
              </span>
              {/* New line number */}
              <span
                style={{
                  width: 30,
                  flexShrink: 0,
                  textAlign: 'right',
                  paddingRight: 6,
                  color: 'var(--tm-text-muted)',
                  opacity: 0.4,
                  fontSize: 10,
                  paddingTop: 1,
                  borderRight: '1px solid var(--tm-border)',
                  marginRight: 4,
                  userSelect: 'none',
                }}
              >
                {newNum}
              </span>
              {/* +/- prefix */}
              <span
                style={{
                  color: prefixColor,
                  width: 14,
                  flexShrink: 0,
                  opacity: 0.8,
                  paddingTop: 1,
                }}
              >
                {line.prefix}
              </span>
              {/* Highlighted code */}
              <span
                style={{ flex: 1, padding: '0 8px 0 2px', whiteSpace: 'pre', overflowX: 'visible' }}
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            </div>

            {/* Inline annotation form — appears below the last selected line */}
            {isLastSelected && selectable && (
              <div
                style={{
                  background: 'var(--tm-bg-elevated)',
                  borderLeft: '2px solid var(--tm-accent)',
                  borderTop: '1px solid var(--tm-border)',
                  borderBottom: '1px solid var(--tm-border)',
                  padding: '6px 10px 6px 52px',
                  display: 'flex',
                  gap: 6,
                  alignItems: 'flex-start',
                }}
              >
                <textarea
                  autoFocus
                  value={pendingText}
                  onChange={(e) => setPendingText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      submitAnnotation()
                    }
                    if (e.key === 'Escape') clearSelection()
                  }}
                  placeholder={`Note on ${selectedLines.size} line${selectedLines.size > 1 ? 's' : ''} — Enter to save, Shift+Enter for newline, Esc to cancel`}
                  style={{
                    flex: 1,
                    background: 'var(--tm-bg-input)',
                    border: '1px solid var(--tm-border)',
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    color: 'var(--tm-text)',
                    resize: 'none',
                    minHeight: 48,
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button
                    className="fnd-btn fnd-btn--primary fnd-btn--sm"
                    onClick={submitAnnotation}
                    style={{ fontSize: 10 }}
                  >
                    Save
                  </button>
                  <button
                    className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                    style={{ fontSize: 10 }}
                    onClick={clearSelection}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Stored annotation block — appears after last annotated line */}
            {tailAnnotation && (
              <div
                style={{
                  background: 'rgba(251,191,36,0.07)',
                  borderLeft: '2px solid var(--tm-warning)',
                  borderBottom: '1px solid rgba(251,191,36,0.15)',
                  padding: '5px 10px 5px 52px',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                }}
              >
                <MessageSquare size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                <span
                  style={{
                    flex: 1,
                    fontSize: 11,
                    color: 'var(--tm-text-secondary)',
                    fontFamily: 'inherit',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.4,
                  }}
                >
                  {tailAnnotation.text}
                </span>
                {onRemoveAnnotation && (
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--tm-text-muted)',
                      cursor: 'pointer',
                      fontSize: 14,
                      lineHeight: 1,
                      padding: '0 2px',
                      flexShrink: 0,
                    }}
                    title="Remove annotation"
                    onClick={() => onRemoveAnnotation(tailAnnotation.id)}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
