import React, { useMemo, useState } from 'react'
import hljs from 'highlight.js'
import type { FileDiff, DiffLine, DiffHunk } from '../schemas/git.schema'

type ViewMode = 'unified' | 'split'

interface FileDiffViewProps {
  diff: FileDiff | null
  isStale?: boolean
  onRefresh?: () => void
}

// ── Language detection ────────────────────────────────────────────────────────

function detectLanguage(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
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
  return ext ? map[ext] : undefined
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlight(content: string, lang: string | undefined): string {
  if (!lang) return escapeHtml(content)
  try {
    return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(content)
  }
}

// ── Unified view ──────────────────────────────────────────────────────────────

function UnifiedRow({ line, lang }: { line: DiffLine; lang: string | undefined }): JSX.Element {
  const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
  const html = useMemo(() => highlight(line.content, lang), [line.content, lang])
  return (
    <tr className={`diff-line diff-line--${line.type}`}>
      <td className="diff-line__old-num">{line.oldLineNumber ?? ''}</td>
      <td className="diff-line__new-num">{line.newLineNumber ?? ''}</td>
      <td className="diff-line__prefix">{prefix}</td>
      <td className="diff-line__content">
        <pre dangerouslySetInnerHTML={{ __html: html }} />
      </td>
    </tr>
  )
}

function UnifiedTable({
  hunks,
  lang,
}: {
  hunks: DiffHunk[]
  lang: string | undefined
}): JSX.Element {
  return (
    <table className="diff-table">
      <tbody>
        {hunks.map((hunk, hi) => (
          <React.Fragment key={hi}>
            <tr>
              <td colSpan={4} className="diff-hunk-header">
                {hunk.header}
              </td>
            </tr>
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

type SplitRow =
  | { kind: 'context'; line: DiffLine }
  | { kind: 'change'; oldLine: DiffLine | null; newLine: DiffLine | null }

function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].type === 'context') {
      rows.push({ kind: 'context', line: lines[i++] })
      continue
    }
    const removes: DiffLine[] = []
    const adds: DiffLine[] = []
    while (i < lines.length && lines[i].type === 'remove') removes.push(lines[i++])
    while (i < lines.length && lines[i].type === 'add') adds.push(lines[i++])
    const pairs = Math.min(removes.length, adds.length)
    for (let j = 0; j < pairs; j++) {
      rows.push({ kind: 'change', oldLine: removes[j], newLine: adds[j] })
    }
    for (let j = pairs; j < removes.length; j++) {
      rows.push({ kind: 'change', oldLine: removes[j], newLine: null })
    }
    for (let j = pairs; j < adds.length; j++) {
      rows.push({ kind: 'change', oldLine: null, newLine: adds[j] })
    }
  }
  return rows
}

function SplitCell({
  line,
  side,
  lang,
}: {
  line: DiffLine | null
  side: 'old' | 'new'
  lang: string | undefined
}): JSX.Element {
  const html = useMemo(() => (line ? highlight(line.content, lang) : ''), [line, lang])
  if (!line) {
    return (
      <>
        <td className="diff-line__old-num" />
        <td className="diff-line__content diff-line__content--empty" />
      </>
    )
  }
  const lineNum = side === 'old' ? line.oldLineNumber : line.newLineNumber
  const cls =
    line.type === 'remove'
      ? 'diff-line__content diff-line__content--remove'
      : line.type === 'add'
        ? 'diff-line__content diff-line__content--add'
        : 'diff-line__content'
  return (
    <>
      <td className="diff-line__old-num">{lineNum ?? ''}</td>
      <td className={cls}>
        <pre dangerouslySetInnerHTML={{ __html: html }} />
      </td>
    </>
  )
}

function SplitTable({ hunks, lang }: { hunks: DiffHunk[]; lang: string | undefined }): JSX.Element {
  return (
    <table className="diff-table diff-table--split">
      <tbody>
        {hunks.map((hunk, hi) => {
          const rows = buildSplitRows(hunk.lines)
          return (
            <React.Fragment key={hi}>
              <tr>
                <td colSpan={4} className="diff-hunk-header">
                  {hunk.header}
                </td>
              </tr>
              {rows.map((row, ri) => {
                if (row.kind === 'context') {
                  return (
                    <tr key={ri} className="diff-line diff-line--context">
                      <SplitCell line={row.line} side="old" lang={lang} />
                      <td className="diff-table__split-divider" />
                      <SplitCell line={row.line} side="new" lang={lang} />
                    </tr>
                  )
                }
                return (
                  <tr key={ri} className="diff-line">
                    <SplitCell line={row.oldLine} side="old" lang={lang} />
                    <td className="diff-table__split-divider" />
                    <SplitCell line={row.newLine} side="new" lang={lang} />
                  </tr>
                )
              })}
            </React.Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

// ── FileDiffView ──────────────────────────────────────────────────────────────

export function FileDiffView({ diff, isStale, onRefresh }: FileDiffViewProps): JSX.Element {
  const [viewMode, setViewMode] = useState<ViewMode>('unified')

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

  const lang = detectLanguage(diff.path)

  return (
    <div className="file-diff-view">
      <div className="file-diff-view__toolbar">
        <span className="file-diff-view__filename">
          {diff.oldPath ? `${diff.oldPath} → ${diff.path}` : diff.path}
        </span>
        <div className="file-diff-view__view-toggle">
          <button
            className={`file-diff-view__toggle-btn${viewMode === 'unified' ? ' file-diff-view__toggle-btn--active' : ''}`}
            onClick={() => setViewMode('unified')}
          >
            Unified
          </button>
          <button
            className={`file-diff-view__toggle-btn${viewMode === 'split' ? ' file-diff-view__toggle-btn--active' : ''}`}
            onClick={() => setViewMode('split')}
          >
            Split
          </button>
        </div>
      </div>

      {isStale && (
        <div className="file-diff-view__stale-banner">
          File changed while viewing.{' '}
          {onRefresh && (
            <button className="file-diff-view__refresh-btn" onClick={onRefresh}>
              Refresh
            </button>
          )}
        </div>
      )}
      {diff.truncated && (
        <div className="file-diff-view__truncation-notice">Diff truncated at 500 KB.</div>
      )}

      <div className="file-diff-view__scroll">
        {viewMode === 'unified' ? (
          <UnifiedTable hunks={diff.hunks} lang={lang} />
        ) : (
          <SplitTable hunks={diff.hunks} lang={lang} />
        )}
      </div>
    </div>
  )
}
