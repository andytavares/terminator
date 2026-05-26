import React, { useState } from 'react'
import { useMergeFlowStore } from '../../stores/merge-flow.store'
import { mergeFlowAPI } from '../../api/merge-flow'
import { useToastStore } from '../../../../../src/renderer/stores/toast.store'
import type { ConflictFile } from '../../schemas/merge-flow.schema'

interface Props {
  repoRoot: string
  onBack: () => void
  onExit: () => void
}

interface StrategyCount {
  mine: number
  theirs: number
  both: number
  manual: number
}

function countStrategies(files: ConflictFile[]): StrategyCount {
  const counts = { mine: 0, theirs: 0, both: 0, manual: 0 }
  for (const file of files) {
    for (const block of file.blocks) {
      if (!block.isResolved || !block.strategy) continue
      const s = block.strategy
      if (s === 'ours') counts.mine++
      else if (s === 'theirs') counts.theirs++
      else if (s === 'both-ours-first' || s === 'both-theirs-first') counts.both++
      else if (s === 'manual') counts.manual++
    }
  }
  return counts
}

function fileStrategyCounts(file: ConflictFile): { label: string; cls: string; count: number }[] {
  const c = countStrategies([file])
  const tags: { label: string; cls: string; count: number }[] = []
  if (c.mine) tags.push({ label: 'mine', cls: 'strategy-tag--mine', count: c.mine })
  if (c.theirs) tags.push({ label: 'theirs', cls: 'strategy-tag--theirs', count: c.theirs })
  if (c.both) tags.push({ label: 'both', cls: 'strategy-tag--both', count: c.both })
  if (c.manual) tags.push({ label: 'manual edit', cls: 'strategy-tag--manual', count: c.manual })
  return tags
}

function formatDuration(startedAt: string): string {
  if (!startedAt) return ''
  const ms = Date.now() - new Date(startedAt).getTime()
  const min = Math.round(ms / 60000)
  return min < 1 ? 'under a minute' : `${min} minute${min !== 1 ? 's' : ''}`
}

function getLangBadge(filePath: string): { label: string; bg: string } {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, { label: string; bg: string }> = {
    ts: { label: 'TS', bg: '#2563eb' },
    tsx: { label: 'TS', bg: '#2563eb' },
    js: { label: 'JS', bg: '#ca8a04' },
    jsx: { label: 'JS', bg: '#ca8a04' },
    py: { label: 'PY', bg: '#3b82f6' },
    json: { label: '{ }', bg: '#0891b2' },
    css: { label: 'CSS', bg: '#db2777' },
    scss: { label: 'CSS', bg: '#db2777' },
    md: { label: 'MD', bg: '#6b7280' },
  }
  return map[ext] ?? { label: ext.slice(0, 3).toUpperCase() || '?', bg: '#4b5563' }
}

export function CompletionScreen({ repoRoot, onBack, onExit }: Props) {
  const session = useMergeFlowStore((s) => s.session)
  const clearSession = useMergeFlowStore((s) => s.clearSession)
  const { addToast } = useToastStore()

  const theirsBranch = session?.theirsBranch
  const oursBranch = session?.oursBranch

  const defaultMessage =
    theirsBranch && oursBranch
      ? `Merge ${theirsBranch} into ${oursBranch} — resolve ${session?.totalConflicts ?? 0} conflict${(session?.totalConflicts ?? 0) !== 1 ? 's' : ''}`
      : `Merge conflict resolution`

  const [commitMessage, setCommitMessage] = useState(defaultMessage)
  const [isCommitting, setIsCommitting] = useState(false)

  if (!session) return null

  const totals = countStrategies(session.files)
  const duration = formatDuration(session.startedAt)
  const fileCount = session.files.length

  async function handleCommit() {
    if (!session) return
    setIsCommitting(true)
    try {
      const resolvedPaths = session.files.map((f) => f.filePath)
      const result = await mergeFlowAPI.mergeCommit(repoRoot, resolvedPaths, commitMessage)
      if ('error' in result) {
        addToast({ type: 'error', message: `Commit failed: ${result.error}` })
        return
      }
      if (result.pushError) {
        addToast({
          type: 'warning',
          message: `Committed but push failed — push manually: ${result.pushError}`,
        })
      }
      await mergeFlowAPI.clearSession(repoRoot)
      clearSession()
      onExit()
    } catch (e) {
      addToast({ type: 'error', message: `Commit failed: ${String(e)}` })
    } finally {
      setIsCommitting(false)
    }
  }

  return (
    <div className="completion-screen">
      <div className="completion-screen__topbar">
        <div className="completion-screen__brand">
          <span className="completion-screen__brand-name">Conflict Solver</span>
        </div>
        {oursBranch && theirsBranch && (
          <div className="completion-screen__branch-crumb">
            <span className="completion-screen__branch">{oursBranch}</span>
            <span className="completion-screen__branch-arrow">→</span>
            <span className="completion-screen__branch">{theirsBranch}</span>
          </div>
        )}
      </div>

      <div className="completion-screen__body">
        {/* Success icon */}
        <div className="completion-screen__check-wrap">
          <div className="completion-screen__check">✓</div>
        </div>

        <h2 className="completion-screen__title">All conflicts resolved</h2>
        <p className="completion-screen__subtitle">
          You resolved {session.totalConflicts} conflict{session.totalConflicts !== 1 ? 's' : ''}{' '}
          across {fileCount} file{fileCount !== 1 ? 's' : ''}
          {duration ? ` in ${duration}` : ''}. Ready to commit.
        </p>

        {/* Resolution summary */}
        <div className="completion-screen__card">
          <div className="completion-screen__card-label">RESOLUTION SUMMARY</div>
          <div className="completion-screen__summary-stats">
            {totals.mine > 0 && (
              <div className="completion-screen__summary-stat">
                <span className="completion-screen__summary-num completion-screen__summary-num--mine">
                  {totals.mine}
                </span>
                <span className="completion-screen__summary-desc">Kept yours</span>
              </div>
            )}
            {totals.theirs > 0 && (
              <div className="completion-screen__summary-stat">
                <span className="completion-screen__summary-num completion-screen__summary-num--theirs">
                  {totals.theirs}
                </span>
                <span className="completion-screen__summary-desc">Kept theirs</span>
              </div>
            )}
            {totals.both > 0 && (
              <div className="completion-screen__summary-stat">
                <span className="completion-screen__summary-num completion-screen__summary-num--both">
                  {totals.both}
                </span>
                <span className="completion-screen__summary-desc">Kept both</span>
              </div>
            )}
            {totals.manual > 0 && (
              <div className="completion-screen__summary-stat">
                <span className="completion-screen__summary-num completion-screen__summary-num--manual">
                  {totals.manual}
                </span>
                <span className="completion-screen__summary-desc">Manual edit</span>
              </div>
            )}
          </div>

          {/* Per-file breakdown */}
          <div className="completion-screen__file-list">
            {session.files.map((file) => {
              const badge = getLangBadge(file.filePath)
              const tags = fileStrategyCounts(file)
              const { dir, name } = (() => {
                const idx = file.filePath.lastIndexOf('/')
                return idx === -1
                  ? { dir: '', name: file.filePath }
                  : { dir: file.filePath.slice(0, idx + 1), name: file.filePath.slice(idx + 1) }
              })()
              return (
                <div key={file.filePath} className="completion-screen__file-row">
                  <span className="completion-screen__file-badge" style={{ background: badge.bg }}>
                    {badge.label}
                  </span>
                  <span className="completion-screen__file-path">
                    <span className="completion-screen__file-dir">{dir}</span>
                    <span className="completion-screen__file-name">{name}</span>
                  </span>
                  <div className="completion-screen__file-tags">
                    {tags.map((t) => (
                      <span key={t.label} className={`strategy-tag ${t.cls}`}>
                        {t.count}× {t.label}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Commit card */}
        <div className="completion-screen__card">
          <div className="completion-screen__card-label">COMMIT MESSAGE</div>
          <textarea
            className="completion-screen__commit-message"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            rows={2}
          />
          <div className="completion-screen__actions">
            <button className="completion-screen__review-btn" onClick={onBack}>
              Review changes
            </button>
            <button
              className="completion-screen__commit-btn"
              onClick={handleCommit}
              disabled={isCommitting || !commitMessage.trim()}
            >
              {isCommitting ? 'Committing…' : 'Commit merge →'}
            </button>
          </div>
        </div>

        <p className="completion-screen__footer">
          Conflict history saved. You can undo individual decisions from the review view.
        </p>
      </div>
    </div>
  )
}
