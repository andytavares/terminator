import React, { useState } from 'react'
import type { HistoryEntry, PhaseId, PhaseState } from '../types/speckit.types.js'

interface ApprovalPanelProps {
  phase: PhaseId
  phaseState: PhaseState
  phaseLabel: string
  phaseCommand: string
  recentHistory: HistoryEntry[]
  onApprove: (note?: string) => Promise<void>
  onReject: (reason: string) => Promise<void>
  onRevoke: (note?: string) => Promise<void>
  onOpenDiff: () => void
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const ACTION_ICONS: Record<string, string> = {
  approved: '●',
  rejected: '●',
  revoked: '●',
  run_start: '●',
  run_complete: '●',
  run_failed: '●',
  modified: '●',
  stale: '●',
  file_approved: '●',
  file_skipped: '●',
}

const ACTION_COLORS: Record<string, string> = {
  approved: 'var(--tm-success)',
  run_complete: 'var(--tm-success)',
  file_approved: 'var(--tm-success)',
  rejected: 'var(--tm-danger)',
  run_failed: 'var(--tm-danger)',
  revoked: 'var(--tm-warning)',
  modified: 'var(--tm-warning)',
  stale: 'var(--tm-warning)',
  run_start: 'var(--tm-accent)',
  file_skipped: 'var(--tm-text-secondary)',
}

function activityDescription(entry: HistoryEntry): { title: string; sub: string } {
  const phase = entry.phase.charAt(0).toUpperCase() + entry.phase.slice(1)
  switch (entry.action) {
    case 'approved':
      return {
        title: `${phase} approved by ${entry.actor}`,
        sub: entry.note ?? (entry.hash ? `Hash ${entry.hash.slice(0, 7)}` : ''),
      }
    case 'rejected':
      return {
        title: `${phase} rejected`,
        sub: entry.note ?? 'Artifact deleted, phase reset to ready',
      }
    case 'revoked':
      return {
        title: `${phase} approval revoked`,
        sub: entry.note ?? 'Downstream phases marked stale',
      }
    case 'run_start':
      return {
        title: `/${entry.phase} started`,
        sub: entry.note ?? '',
      }
    case 'run_complete':
      return {
        title: `/${entry.phase} completed`,
        sub: entry.note ?? '',
      }
    case 'run_failed':
      return {
        title: `/${entry.phase} failed`,
        sub: entry.note ?? '',
      }
    case 'modified':
      return { title: `${phase} artifact modified`, sub: entry.note ?? '' }
    case 'stale':
      return { title: `${phase} marked stale`, sub: entry.note ?? '' }
    case 'file_approved':
      return { title: `File write approved`, sub: entry.filePath ?? '' }
    case 'file_skipped':
      return { title: `File write skipped`, sub: entry.filePath ?? '' }
    default:
      return { title: phase, sub: entry.note ?? '' }
  }
}

export function ApprovalPanel({
  phase,
  phaseState,
  phaseLabel,
  phaseCommand,
  recentHistory,
  onApprove,
  onReject,
  onRevoke,
  onOpenDiff,
}: ApprovalPanelProps) {
  const [note, setNote] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false)
  const [autoUnlock, setAutoUnlock] = useState(true)
  const [busy, setBusy] = useState(false)

  const isAwaiting = phaseState.status === 'awaiting_review'
  const isApproved = phaseState.status === 'approved'
  const isModified = phaseState.status === 'modified'

  const handleApprove = async () => {
    setBusy(true)
    try {
      await onApprove(note || undefined)
      setNote('')
    } finally {
      setBusy(false)
    }
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return
    setBusy(true)
    try {
      await onReject(rejectReason)
      setRejectReason('')
      setShowRejectForm(false)
    } finally {
      setBusy(false)
    }
  }

  const handleRevoke = async () => {
    setBusy(true)
    try {
      await onRevoke(note || undefined)
      setNote('')
      setShowRevokeConfirm(false)
    } finally {
      setBusy(false)
    }
  }

  const generatedAgo = phaseState.lastRunAt ? relativeTime(phaseState.lastRunAt) : null

  const inputHashes: string[] = []
  if (phaseState.approvedHash) {
    inputHashes.push(
      `${phase === 'plan' ? 'spec.md' : 'artifact'}@${phaseState.approvedHash.slice(0, 7)}`
    )
  }

  return (
    <div className="sk-approval">
      {/* Review card */}
      {(isAwaiting || isModified) && (
        <div className="sk-approval__card">
          <div className="sk-approval__card-header">
            <div>
              <div className="sk-approval__card-title">
                {phaseLabel} — {isModified ? 'modified' : 'awaiting review'}
              </div>
              {generatedAgo && (
                <div className="sk-approval__card-sub">
                  Generated {generatedAgo}
                  {inputHashes.length > 0 && (
                    <>
                      {' '}
                      from <code>{inputHashes.join(' and ')}</code>
                    </>
                  )}
                  . No downstream phases will run until you approve or reject this artifact.
                </div>
              )}
              {!generatedAgo && (
                <div className="sk-approval__card-sub">
                  No downstream phases will run until you approve or reject this artifact.
                </div>
              )}
            </div>
            <span className="sk-badge sk-badge--review">Review required</span>
          </div>

          {!showRejectForm && !showRevokeConfirm && (
            <div className="sk-approval__actions">
              <button className="sk-btn sk-btn--ghost" onClick={onOpenDiff}>
                Open artifact diff
              </button>
              <button
                className="sk-btn sk-btn--primary"
                onClick={() => void handleApprove()}
                disabled={busy}
              >
                Approve &amp; continue
              </button>
              <button className="sk-btn sk-btn--secondary" onClick={() => setShowRejectForm(true)}>
                Request changes
              </button>
              <button
                className="sk-btn sk-btn--danger-outline"
                onClick={() => setShowRejectForm(true)}
              >
                Reject &amp; rerun
              </button>
            </div>
          )}

          {showRejectForm && (
            <div className="sk-approval__reject-form">
              <div className="sk-form-label">Reason for rejection (required)</div>
              <textarea
                className="sk-textarea"
                placeholder="Describe what needs to change before rerun…"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
              />
              <div className="sk-approval__actions">
                <button
                  className="sk-btn sk-btn--danger"
                  onClick={() => void handleReject()}
                  disabled={!rejectReason.trim() || busy}
                >
                  Reject &amp; rerun
                </button>
                <button
                  className="sk-btn sk-btn--ghost"
                  onClick={() => {
                    setShowRejectForm(false)
                    setRejectReason('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Gate decision panel */}
          {!showRejectForm && !showRevokeConfirm && (
            <div className="sk-approval__gate">
              <div className="sk-gate__title">Gate decision</div>
              <div className="sk-gate__row">
                <div className="sk-form-label">Note (optional, written to history)</div>
                <textarea
                  className="sk-textarea"
                  placeholder="e.g. Approved with P-2 deviation noted; will revisit if router adds complexity."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="sk-gate__row">
                <label className="sk-checkbox-label">
                  <input
                    type="checkbox"
                    checked={autoUnlock}
                    onChange={(e) => setAutoUnlock(e.target.checked)}
                  />
                  Auto-unlock next phase on approve
                </label>
              </div>
              <div className="sk-gate__actions">
                <button
                  className="sk-btn sk-btn--primary"
                  onClick={() => void handleApprove()}
                  disabled={busy}
                >
                  Approve
                </button>
                <button
                  className="sk-btn sk-btn--secondary"
                  onClick={() => {
                    setNote('')
                    setAutoUnlock(true)
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Provenance */}
          {phaseState.lastRunAt && (
            <div className="sk-approval__provenance">
              <div className="sk-gate__title">Provenance</div>
              <div className="sk-provenance__grid">
                {inputHashes.length > 0 && (
                  <>
                    <span className="sk-provenance__key">Inputs</span>
                    <span className="sk-provenance__val">
                      {inputHashes.map((h) => (
                        <code key={h} style={{ marginRight: 8 }}>
                          {h}
                        </code>
                      ))}
                    </span>
                  </>
                )}
                <span className="sk-provenance__key">Command</span>
                <span className="sk-provenance__val">
                  <code>{phaseCommand}</code>
                </span>
                {phaseState.lastRunId && (
                  <>
                    <span className="sk-provenance__key">Run id</span>
                    <span className="sk-provenance__val">
                      <code>{phaseState.lastRunId}</code>
                    </span>
                  </>
                )}
                <span className="sk-provenance__key">Phase</span>
                <span className="sk-provenance__val">{phaseLabel}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Approved phase — show revoke option */}
      {isApproved && (
        <div className="sk-approval__card sk-approval__card--approved">
          <div className="sk-approval__card-header">
            <div>
              <div className="sk-approval__card-title">{phaseLabel} — approved</div>
              {phaseState.approvedAt && (
                <div className="sk-approval__card-sub">
                  Approved {relativeTime(phaseState.approvedAt)} by{' '}
                  {phaseState.approvedBy ?? 'user'}
                  {phaseState.approvedHash && (
                    <>
                      {' '}
                      · hash <code>{phaseState.approvedHash.slice(0, 7)}</code>
                    </>
                  )}
                </div>
              )}
            </div>
            <span className="sk-badge sk-badge--approved">Approved</span>
          </div>
          {!showRevokeConfirm && (
            <div className="sk-approval__actions">
              <button className="sk-btn sk-btn--ghost" onClick={onOpenDiff}>
                Open artifact diff
              </button>
              <button
                className="sk-btn sk-btn--secondary"
                onClick={() => setShowRevokeConfirm(true)}
              >
                Revoke approval
              </button>
            </div>
          )}
          {showRevokeConfirm && (
            <div className="sk-approval__reject-form">
              <div className="sk-form-label">
                Revoke approval? Downstream approved phases will be marked stale.
              </div>
              <textarea
                className="sk-textarea"
                placeholder="Optional note…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
              <div className="sk-approval__actions">
                <button
                  className="sk-btn sk-btn--danger"
                  onClick={() => void handleRevoke()}
                  disabled={busy}
                >
                  Revoke approval
                </button>
                <button
                  className="sk-btn sk-btn--ghost"
                  onClick={() => {
                    setShowRevokeConfirm(false)
                    setNote('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent activity */}
      {recentHistory.length > 0 && (
        <div className="sk-activity">
          <div className="sk-activity__title">Recent activity</div>
          {recentHistory
            .slice()
            .reverse()
            .slice(0, 6)
            .map((entry, i) => {
              const { title, sub } = activityDescription(entry)
              const color = ACTION_COLORS[entry.action] ?? 'var(--tm-text-secondary)'
              return (
                <div key={i} className="sk-activity__row">
                  <span className="sk-activity__dot" style={{ color }}>
                    {ACTION_ICONS[entry.action] ?? '●'}
                  </span>
                  <div className="sk-activity__body">
                    <div className="sk-activity__title-text">{title}</div>
                    {sub && <div className="sk-activity__sub">{sub}</div>}
                  </div>
                  <span className="sk-activity__time">{relativeTime(entry.ts)}</span>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
