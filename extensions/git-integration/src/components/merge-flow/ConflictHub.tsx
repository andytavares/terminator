import React from 'react'
import { useMergeFlowStore } from '../../stores/merge-flow.store'
import type { ConflictFile } from '../../schemas/merge-flow.schema'

interface Props {
  onSelectFile: (fileIndex: number) => void
  onStartOver?: () => void
  onExit?: () => void
}

interface LangBadge {
  label: string
  bg: string
  text: string
}

function getLangBadge(filePath: string): LangBadge {
  const name = filePath.split('/').pop()?.toLowerCase() ?? ''
  if (name === 'dockerfile') return { label: 'DO', bg: '#0ea5e9', text: '#fff' }
  const ext = name.split('.').pop() ?? ''
  const map: Record<string, LangBadge> = {
    ts: { label: 'TS', bg: '#2563eb', text: '#fff' },
    tsx: { label: 'TS', bg: '#2563eb', text: '#fff' },
    js: { label: 'JS', bg: '#ca8a04', text: '#fff' },
    jsx: { label: 'JS', bg: '#ca8a04', text: '#fff' },
    mjs: { label: 'JS', bg: '#ca8a04', text: '#fff' },
    py: { label: 'PY', bg: '#3b82f6', text: '#fff' },
    rb: { label: 'RB', bg: '#dc2626', text: '#fff' },
    go: { label: 'GO', bg: '#06b6d4', text: '#fff' },
    rs: { label: 'RS', bg: '#ea580c', text: '#fff' },
    java: { label: 'JV', bg: '#f97316', text: '#fff' },
    json: { label: '{ }', bg: '#0891b2', text: '#fff' },
    css: { label: 'CSS', bg: '#db2777', text: '#fff' },
    scss: { label: 'CSS', bg: '#db2777', text: '#fff' },
    md: { label: 'MD', bg: '#6b7280', text: '#fff' },
    yaml: { label: 'YML', bg: '#7c3aed', text: '#fff' },
    yml: { label: 'YML', bg: '#7c3aed', text: '#fff' },
    sh: { label: 'SH', bg: '#374151', text: '#fff' },
    sql: { label: 'SQL', bg: '#0f766e', text: '#fff' },
    html: { label: 'HTML', bg: '#e25822', text: '#fff' },
  }
  return map[ext] ?? { label: ext.slice(0, 3).toUpperCase() || '?', bg: '#4b5563', text: '#fff' }
}

function getDotColor(file: ConflictFile): string {
  if (file.resolvedCount >= file.conflictCount) return 'var(--tm-success)'
  if (file.conflictCount >= 4) return '#ef4444'
  if (file.conflictCount >= 2) return '#f59e0b'
  return '#6b7280'
}

function formatFilePath(filePath: string): { dir: string; name: string } {
  const idx = filePath.lastIndexOf('/')
  return idx === -1
    ? { dir: '', name: filePath }
    : { dir: filePath.slice(0, idx + 1), name: filePath.slice(idx + 1) }
}

function FileCard({
  file,
  index,
  isFirst,
  isResolved,
  oursBranch,
  theirsBranch,
  onSelectFile,
}: {
  file: ConflictFile
  index: number
  isFirst: boolean
  isResolved: boolean
  oursBranch?: string
  theirsBranch?: string
  onSelectFile: (i: number) => void
}) {
  const badge = getLangBadge(file.filePath)
  const { dir, name } = formatFilePath(file.filePath)
  const remaining = file.conflictCount - file.resolvedCount
  const dotColor = getDotColor(file)

  const oursLabel = oursBranch ? `${file.oursAuthor.name} (${oursBranch})` : file.oursAuthor.name
  const theirsLabel = theirsBranch
    ? `${file.theirsAuthor.name} (${theirsBranch})`
    : file.theirsAuthor.name

  return (
    <div
      className={`conflict-hub__file-card${isFirst && !isResolved ? ' conflict-hub__file-card--highlighted' : ''}${isResolved ? ' conflict-hub__file-card--resolved' : ''}`}
      data-testid="conflict-file-row"
      role="button"
      tabIndex={0}
      onClick={() => onSelectFile(index)}
      onKeyDown={(e) => e.key === 'Enter' && onSelectFile(index)}
    >
      <span
        className="conflict-hub__file-dot"
        style={{ background: isResolved ? 'var(--tm-success)' : dotColor }}
      >
        {isResolved ? '✓' : ''}
      </span>

      <span
        className="conflict-hub__lang-badge"
        style={{ background: badge.bg, color: badge.text }}
      >
        {badge.label}
      </span>

      <div className="conflict-hub__file-info">
        <span className="conflict-hub__file-path">
          <span className="conflict-hub__file-dir">{dir}</span>
          <span className="conflict-hub__file-name">{name}</span>
        </span>
        <span className="conflict-hub__file-authors">
          Modified by {oursLabel} · {theirsLabel}
        </span>
        {file.conflictDescription && (
          <span className="conflict-hub__file-desc">{file.conflictDescription}</span>
        )}
      </div>

      {isResolved ? (
        <span className="conflict-hub__resolved-tag">
          {file.conflictCount} conflict{file.conflictCount !== 1 ? 's' : ''} · resolved
        </span>
      ) : (
        <span
          className={`conflict-hub__conflict-badge${file.conflictCount >= 4 ? ' conflict-hub__conflict-badge--high' : file.conflictCount >= 2 ? ' conflict-hub__conflict-badge--med' : ''}`}
        >
          {remaining} conflict{remaining !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  )
}

export function ConflictHub({ onSelectFile, onStartOver, onExit }: Props) {
  const session = useMergeFlowStore((s) => s.session)

  if (!session) return null

  const totalRemaining = session.totalConflicts - session.totalResolved
  const progressPct =
    session.totalConflicts > 0
      ? Math.round((session.totalResolved / session.totalConflicts) * 100)
      : 0
  const estimatedMin = Math.max(1, Math.ceil(session.totalConflicts * 0.75))

  const unresolvedFiles = session.files.filter((f) => f.resolvedCount < f.conflictCount)
  const resolvedFiles = session.files.filter((f) => f.resolvedCount >= f.conflictCount)

  const theirsBranchDisplay = session.theirsBranch ?? (session.isRebase ? 'upstream' : 'incoming')
  const oursBranchDisplay = session.oursBranch ?? 'HEAD'

  return (
    <div className="conflict-hub">
      {/* Header */}
      <div className="conflict-hub__topbar">
        <div className="conflict-hub__brand">
          <span className="conflict-hub__brand-name">Conflict Solver</span>
        </div>
        <div className="conflict-hub__branch-crumb">
          <span className="conflict-hub__branch">{oursBranchDisplay}</span>
          <span className="conflict-hub__branch-arrow">→</span>
          <span className="conflict-hub__branch">{theirsBranchDisplay}</span>
        </div>
        {session.isRebase && <span className="conflict-hub__rebase-badge">rebase</span>}
        {onStartOver && session.totalResolved > 0 && (
          <button
            className="conflict-hub__start-over"
            onClick={onStartOver}
            title="Reset all resolutions and start over"
          >
            ↺ Start over
          </button>
        )}
        {onExit && (
          <button
            className="conflict-hub__exit"
            onClick={onExit}
            aria-label="Exit merge flow"
            title="Exit merge flow"
          >
            ✕
          </button>
        )}
      </div>

      {/* Stats hero card */}
      <div className="conflict-hub__hero">
        <h2 className="conflict-hub__hero-title">Merge conflicts need resolving</h2>
        <p className="conflict-hub__hero-subtitle">
          {theirsBranchDisplay} cannot be merged into {oursBranchDisplay} until these are resolved
        </p>
        <div className="conflict-hub__stats">
          <div className="conflict-hub__stat">
            <span className="conflict-hub__stat-value">{session.files.length}</span>
            <span className="conflict-hub__stat-label">FILES CONFLICTED</span>
          </div>
          <div className="conflict-hub__stat">
            <span className="conflict-hub__stat-value conflict-hub__stat-value--accent">
              {session.totalConflicts}
            </span>
            <span className="conflict-hub__stat-label">TOTAL CONFLICTS</span>
          </div>
          <div className="conflict-hub__stat">
            <span className="conflict-hub__stat-value conflict-hub__stat-value--muted">
              ~{estimatedMin} min
            </span>
            <span className="conflict-hub__stat-label">ESTIMATED TIME</span>
          </div>
        </div>
        <div className="conflict-hub__progress">
          <span className="conflict-hub__progress-label">Progress</span>
          <div className="conflict-hub__progress-bar">
            <div className="conflict-hub__progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="conflict-hub__progress-count">
            {session.totalResolved} of {session.totalConflicts} resolved
          </span>
        </div>
      </div>

      {/* Hint */}
      {unresolvedFiles.length > 0 && (
        <div className="conflict-hub__hint">
          <span className="conflict-hub__hint-icon">ℹ</span>
          <span>
            <strong>Start with the highlighted file.</strong> MergeFlow orders by complexity —
            hardest first while you&apos;re fresh. You can jump to any file at any time.
          </span>
        </div>
      )}

      {/* Unresolved files */}
      {unresolvedFiles.length > 0 && (
        <div className="conflict-hub__section">
          <div className="conflict-hub__section-label">NEEDS YOUR ATTENTION</div>
          {unresolvedFiles.map((file) => {
            const idx = session.files.indexOf(file)
            return (
              <FileCard
                key={file.filePath}
                file={file}
                index={idx}
                isFirst={file === unresolvedFiles[0]}
                isResolved={false}
                oursBranch={session.oursBranch}
                theirsBranch={session.theirsBranch}
                onSelectFile={onSelectFile}
              />
            )
          })}
        </div>
      )}

      {/* Resolved files */}
      {resolvedFiles.length > 0 && (
        <div className="conflict-hub__section">
          <div className="conflict-hub__section-label">RESOLVED</div>
          {resolvedFiles.map((file) => {
            const idx = session.files.indexOf(file)
            return (
              <FileCard
                key={file.filePath}
                file={file}
                index={idx}
                isFirst={false}
                isResolved={true}
                oursBranch={session.oursBranch}
                theirsBranch={session.theirsBranch}
                onSelectFile={onSelectFile}
              />
            )
          })}
        </div>
      )}

      {totalRemaining === 0 && session.totalConflicts > 0 && (
        <div className="conflict-hub__all-done">All conflicts resolved — ready to commit.</div>
      )}
    </div>
  )
}
