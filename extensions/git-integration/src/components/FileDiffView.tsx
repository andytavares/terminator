import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import hljs from '../utils/hljs'
import { Button, SegmentedControl } from '@terminator/extension-ui'
import type { FileDiff, DiffLine, DiffHunk } from '../schemas/git.schema'
import { choose } from './text'

type ViewMode = 'unified' | 'split'

interface FileDiffViewProps {
  diff: FileDiff | null
  isStale?: boolean
  onRefresh?: () => void
}

// ── Language detection ────────────────────────────────────────────────────────

const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
}

export function detectLanguage(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  if (!ext) return undefined
  return LANGUAGES[ext]
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

function escapeHtml(s: string): string {
  return s.replace(new RegExp('[&<>]', 'g'), (ch) => HTML_ESCAPES[ch])
}

export function highlight(content: string, lang: string | undefined): string {
  if (!lang) return escapeHtml(content)
  try {
    return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(content)
  }
}

// ── Unified view ──────────────────────────────────────────────────────────────

const LINE_PREFIX: Record<DiffLine['type'], string> = { add: '+', remove: '-', context: ' ' }

function UnifiedRow({ line, lang }: { line: DiffLine; lang: string | undefined }): JSX.Element {
  const html = useMemo(() => highlight(line.content, lang), [line.content, lang])
  return (
    <tr className={`diff-line diff-line--${line.type}`}>
      <td className="diff-line__old-num">{line.oldLineNumber ?? ''}</td>
      <td className="diff-line__new-num">{line.newLineNumber ?? ''}</td>
      <td className="diff-line__prefix">{LINE_PREFIX[line.type]}</td>
      <td className="diff-line__content">
        <pre dangerouslySetInnerHTML={{ __html: html }} />
      </td>
    </tr>
  )
}

interface TableProps {
  hunks: DiffHunk[]
  lang: string | undefined
}

function HunkHeader(props: { header: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={props.colSpan} className="diff-hunk-header">
        {props.header}
      </td>
    </tr>
  )
}

function UnifiedTable({ hunks, lang }: TableProps): JSX.Element {
  return (
    <table className="diff-table">
      <tbody>
        {hunks.map((hunk, hi) => (
          <React.Fragment key={hi}>
            <HunkHeader header={hunk.header} colSpan={4} />
            {hunk.lines.map((line, li) => (
              <UnifiedRow key={`${hi}-${li}`} line={line} lang={lang} />
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  )
}

// ── Split view ────────────────────────────────────────────────────────────────

export type SplitRow =
  | { kind: 'context'; line: DiffLine }
  | { kind: 'change'; oldLine: DiffLine | null; newLine: DiffLine | null }

/** The lines of `type` starting at `start`. */
function runOf(lines: DiffLine[], start: number, type: DiffLine['type']): DiffLine[] {
  const run: DiffLine[] = []
  while (start + run.length < lines.length && lines[start + run.length].type === type) {
    run.push(lines[start + run.length])
  }
  return run
}

/** Removed and added lines side by side, row by row; the longer side runs on alone. */
function pairChanges(removes: DiffLine[], adds: DiffLine[]): SplitRow[] {
  const count = Math.max(removes.length, adds.length)
  return Array.from({ length: count }, (_, j) => ({
    kind: 'change' as const,
    oldLine: removes[j] ?? null,
    newLine: adds[j] ?? null,
  }))
}

export function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].type === 'context') {
      rows.push({ kind: 'context', line: lines[i++] })
      continue
    }
    const removes = runOf(lines, i, 'remove')
    const adds = runOf(lines, i + removes.length, 'add')
    rows.push(...pairChanges(removes, adds))
    i += removes.length + adds.length
  }
  return rows
}

type SplitSide = 'old' | 'new'

const CONTENT_CLASS: Record<DiffLine['type'], string> = {
  remove: 'diff-line__content diff-line__content--remove',
  add: 'diff-line__content diff-line__content--add',
  context: 'diff-line__content',
}

function sideClassOf(side: SplitSide): string {
  return choose(side === 'old', ' diff-line__content--old-side', ' diff-line__content--new-side')
}

function sideLineNumber(line: DiffLine, side: SplitSide): number | null | undefined {
  if (side === 'old') return line.oldLineNumber
  return line.newLineNumber
}

function SplitCode(props: { line: DiffLine; side: SplitSide; lang: string | undefined }) {
  const { line, side, lang } = props
  const html = useMemo(() => highlight(line.content, lang), [line, lang])
  return (
    <>
      <td className="diff-line__old-num">{sideLineNumber(line, side) ?? ''}</td>
      <td className={`${CONTENT_CLASS[line.type]}${sideClassOf(side)}`}>
        <pre dangerouslySetInnerHTML={{ __html: html }} />
      </td>
    </>
  )
}

function SplitCell(props: { line: DiffLine | null; side: SplitSide; lang: string | undefined }) {
  if (props.line) return <SplitCode line={props.line} side={props.side} lang={props.lang} />
  return (
    <>
      <td className="diff-line__old-num" />
      <td className={`diff-line__content diff-line__content--empty${sideClassOf(props.side)}`} />
    </>
  )
}

interface SplitTableProps extends TableProps {
  onDividerMouseDown: (e: React.MouseEvent) => void
}

function rowSides(row: SplitRow): {
  oldLine: DiffLine | null
  newLine: DiffLine | null
  cls: string
} {
  if (row.kind === 'context') {
    return { oldLine: row.line, newLine: row.line, cls: 'diff-line diff-line--context' }
  }
  return { oldLine: row.oldLine, newLine: row.newLine, cls: 'diff-line' }
}

function SplitTableRow(props: {
  row: SplitRow
  lang: string | undefined
  onDividerMouseDown: SplitTableProps['onDividerMouseDown']
}) {
  const { oldLine, newLine, cls } = rowSides(props.row)
  return (
    <tr className={cls}>
      <SplitCell line={oldLine} side="old" lang={props.lang} />
      <td className="diff-table__split-divider" onMouseDown={props.onDividerMouseDown} />
      <SplitCell line={newLine} side="new" lang={props.lang} />
    </tr>
  )
}

function SplitTable({ hunks, lang, onDividerMouseDown }: SplitTableProps) {
  return (
    <table className="diff-table diff-table--split">
      <tbody>
        {hunks.map((hunk, hi) => (
          <React.Fragment key={hi}>
            <HunkHeader header={hunk.header} colSpan={5} />
            {buildSplitRows(hunk.lines).map((row, ri) => (
              <SplitTableRow
                key={ri}
                row={row}
                lang={lang}
                onDividerMouseDown={onDividerMouseDown}
              />
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  )
}

// ── FileDiffView ──────────────────────────────────────────────────────────────

interface SplitDrag {
  active: boolean
  startX: number
  startPct: number
  containerWidth: number
}

/** Follows the mouse while the split divider is held, keeping the left side between 20% and 80%. */
function useSplitDragListeners(dragRef: { current: SplitDrag }, setPct: (pct: number) => void) {
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragRef.current
      if (!s.active || s.containerWidth === 0) return
      const deltaPct = ((e.clientX - s.startX) / s.containerWidth) * 100
      setPct(Math.max(20, Math.min(80, s.startPct + deltaPct)))
    }
    const onUp = () => {
      dragRef.current.active = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragRef, setPct])
}

function useSplitDivider() {
  const [splitLeftPct, setSplitLeftPct] = useState(50)
  const dragRef = useRef<SplitDrag>({ active: false, startX: 0, startPct: 50, containerWidth: 0 })
  const scrollRef = useRef<HTMLDivElement>(null)
  useSplitDragListeners(dragRef, setSplitLeftPct)
  const onDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const container = scrollRef.current
      if (!container) return
      const containerWidth = container.getBoundingClientRect().width
      dragRef.current = { active: true, startX: e.clientX, startPct: splitLeftPct, containerWidth }
      e.preventDefault()
    },
    [splitLeftPct]
  )
  return { splitLeftPct, scrollRef, onDividerMouseDown }
}

const LAYOUT_OPTIONS = [
  { value: 'unified', label: 'Unified' },
  { value: 'split', label: 'Split' },
] as const

function fileTitle(diff: FileDiff): string {
  if (diff.oldPath) return `${diff.oldPath} → ${diff.path}`
  return diff.path
}

function DiffToolbar(props: {
  diff: FileDiff
  viewMode: ViewMode
  setViewMode: (m: ViewMode) => void
}) {
  return (
    <div className="file-diff-view__toolbar">
      <span className="file-diff-view__filename">{fileTitle(props.diff)}</span>
      <SegmentedControl
        label="Diff layout"
        size="sm"
        options={[...LAYOUT_OPTIONS]}
        value={props.viewMode}
        onChange={props.setViewMode}
      />
    </div>
  )
}

function DiffNotices({ props }: { props: FileDiffViewProps & { diff: FileDiff } }) {
  return (
    <>
      {props.isStale && (
        <div className="file-diff-view__stale-banner">
          File changed while viewing.{' '}
          {props.onRefresh && (
            <Button size="sm" onClick={props.onRefresh}>
              Refresh
            </Button>
          )}
        </div>
      )}
      {props.diff.truncated && (
        <div className="file-diff-view__truncation-notice">Diff truncated at 500 KB.</div>
      )}
    </>
  )
}

type SplitDivider = ReturnType<typeof useSplitDivider>

interface ViewState {
  viewMode: ViewMode
  setViewMode: (m: ViewMode) => void
  divider: SplitDivider
}

function DiffBody({ diff, view }: { diff: FileDiff; view: ViewState }) {
  const { splitLeftPct, scrollRef, onDividerMouseDown } = view.divider
  const { viewMode } = view
  const lang = detectLanguage(diff.path)
  const splitStyle = { '--split-left': `${splitLeftPct}%` } as React.CSSProperties
  return (
    <div
      className="file-diff-view__scroll"
      ref={scrollRef}
      style={choose(viewMode === 'split', splitStyle, undefined)}
    >
      {viewMode === 'unified' && <UnifiedTable hunks={diff.hunks} lang={lang} />}
      {viewMode === 'split' && (
        <SplitTable hunks={diff.hunks} lang={lang} onDividerMouseDown={onDividerMouseDown} />
      )}
    </div>
  )
}

function LoadedDiff(props: FileDiffViewProps & { diff: FileDiff; view: ViewState }) {
  const { view } = props
  return (
    <div className="file-diff-view">
      <DiffToolbar diff={props.diff} viewMode={view.viewMode} setViewMode={view.setViewMode} />
      <DiffNotices props={props} />
      <DiffBody diff={props.diff} view={view} />
    </div>
  )
}

export function FileDiffView(props: FileDiffViewProps): JSX.Element {
  const { diff } = props
  // The layout and divider position outlive the file shown, so they stay as files change.
  const [viewMode, setViewMode] = useState<ViewMode>('unified')
  const divider = useSplitDivider()
  if (!diff) {
    return (
      <div className="file-diff-view file-diff-view--empty">Select a file to view its diff.</div>
    )
  }
  if (diff.isBinary) {
    return (
      <div className="file-diff-view file-diff-view--binary">Binary file — no diff available.</div>
    )
  }
  const view = { viewMode, setViewMode, divider }
  return <LoadedDiff diff={diff} isStale={props.isStale} onRefresh={props.onRefresh} view={view} />
}
