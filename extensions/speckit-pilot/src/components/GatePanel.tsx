import React, { useState } from 'react'
import { CheckCircle, RotateCcw, Undo2, MessageSquare, Edit2 } from 'lucide-react'
import type { PhaseId, PhaseState } from '../types/speckit.types.js'

interface GatePanelProps {
  featureDir: string
  phase: PhaseId
  phaseState: PhaseState
  artifactContent: string | null
  stalePhases?: PhaseId[]
  comments?: Array<{ note: string; ts: string }>
  onApprove(): Promise<void> | void
  onRequestChanges(note: string): Promise<void> | void
  onRevoke?(): Promise<void> | void
  onComment?(note: string): Promise<void> | void
  onInlineEdit?(content: string): Promise<void> | void
}

type ActivePanel = 'none' | 'request-changes' | 'comment' | 'inline-edit'

export function GatePanel({
  artifactContent,
  onApprove,
  onRequestChanges,
  onRevoke,
  onComment,
  onInlineEdit,
  stalePhases,
  comments,
}: GatePanelProps) {
  const [activePanel, setActivePanel] = useState<ActivePanel>('none')
  const [feedbackNote, setFeedbackNote] = useState('')
  const [commentNote, setCommentNote] = useState('')
  const [editContent, setEditContent] = useState('')
  const [approving, setApproving] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleApprove() {
    setApproving(true)
    try {
      await onApprove()
    } finally {
      setApproving(false)
    }
  }

  async function handleSubmitFeedback() {
    if (!feedbackNote.trim()) return
    setSubmitting(true)
    try {
      await onRequestChanges(feedbackNote.trim())
      setActivePanel('none')
      setFeedbackNote('')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmitComment() {
    if (!commentNote.trim() || !onComment) return
    setSubmitting(true)
    try {
      await onComment(commentNote.trim())
      setActivePanel('none')
      setCommentNote('')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSaveEdit() {
    if (!onInlineEdit) return
    setSubmitting(true)
    try {
      await onInlineEdit(editContent)
      setActivePanel('none')
    } finally {
      setSubmitting(false)
    }
  }

  function openInlineEdit() {
    setEditContent(artifactContent ?? '')
    setActivePanel('inline-edit')
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        background: 'var(--tm-bg-elevated)',
        borderRadius: 8,
      }}
    >
      {/* Stale propagation banner */}
      {stalePhases && stalePhases.length > 0 && (
        <div
          style={{
            padding: '6px 10px',
            background: 'var(--tm-warning-bg, #422006)',
            color: 'var(--tm-warning, #f59e0b)',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          Revoking will mark stale: {stalePhases.join(', ')}
        </div>
      )}

      {/* Artifact preview */}
      {activePanel !== 'inline-edit' && (
        <div
          style={{
            background: 'var(--tm-surface, #111827)',
            borderRadius: 6,
            padding: '8px 12px',
            minHeight: 80,
            maxHeight: 240,
            overflowY: 'auto',
            fontFamily: 'var(--tm-font-mono, monospace)',
            fontSize: 12,
            color: 'var(--tm-text-primary)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {artifactContent ?? (
            <span style={{ color: 'var(--tm-text-secondary)' }}>No artifact to preview.</span>
          )}
        </div>
      )}

      {/* Inline editor */}
      {activePanel === 'inline-edit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            aria-label="inline editor"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={10}
            style={{
              width: '100%',
              padding: '6px 10px',
              background: 'var(--tm-surface, #111827)',
              color: 'var(--tm-text-primary)',
              border: '1px solid var(--tm-border, #374151)',
              borderRadius: 6,
              fontFamily: 'var(--tm-font-mono, monospace)',
              fontSize: 12,
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSaveEdit}
              disabled={submitting}
              className="sk-btn sk-btn--primary"
              style={{ flex: 1 }}
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setActivePanel('none')}
              className="sk-btn sk-btn--secondary"
              style={{ flex: 1 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Request-changes form */}
      {activePanel === 'request-changes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={feedbackNote}
            onChange={(e) => setFeedbackNote(e.target.value)}
            placeholder="Describe what needs to change…"
            rows={4}
            style={{
              width: '100%',
              padding: '6px 10px',
              background: 'var(--tm-surface, #111827)',
              color: 'var(--tm-text-primary)',
              border: '1px solid var(--tm-border, #374151)',
              borderRadius: 6,
              fontFamily: 'inherit',
              fontSize: 13,
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSubmitFeedback}
              disabled={submitting || !feedbackNote.trim()}
              className="sk-btn sk-btn--primary"
              style={{ flex: 1 }}
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
            <button
              onClick={() => {
                setActivePanel('none')
                setFeedbackNote('')
              }}
              className="sk-btn sk-btn--secondary"
              style={{ flex: 1 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Comment form */}
      {activePanel === 'comment' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={commentNote}
            onChange={(e) => setCommentNote(e.target.value)}
            placeholder="Leave a comment…"
            rows={3}
            style={{
              width: '100%',
              padding: '6px 10px',
              background: 'var(--tm-surface, #111827)',
              color: 'var(--tm-text-primary)',
              border: '1px solid var(--tm-border, #374151)',
              borderRadius: 6,
              fontFamily: 'inherit',
              fontSize: 13,
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSubmitComment}
              disabled={submitting || !commentNote.trim()}
              className="sk-btn sk-btn--primary"
              style={{ flex: 1 }}
            >
              {submitting ? 'Posting…' : 'Post comment'}
            </button>
            <button
              onClick={() => {
                setActivePanel('none')
                setCommentNote('')
              }}
              className="sk-btn sk-btn--secondary"
              style={{ flex: 1 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Comment thread */}
      {comments && comments.length > 0 && activePanel === 'none' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-secondary)' }}>
            Comments
          </div>
          {comments.map((c, i) => (
            <div
              key={i}
              style={{
                padding: '6px 10px',
                background: 'var(--tm-surface, #111827)',
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <div style={{ color: 'var(--tm-text-secondary)', fontSize: 10, marginBottom: 2 }}>
                {new Date(c.ts).toLocaleString()}
              </div>
              <div style={{ color: 'var(--tm-text-primary)', whiteSpace: 'pre-wrap' }}>
                {c.note}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      {activePanel === 'none' && (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleApprove}
              disabled={approving}
              className="sk-btn sk-btn--primary"
              style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}
              aria-label="Approve"
            >
              <CheckCircle size={14} />
              {approving ? 'Approving…' : 'Approve'}
            </button>
            <button
              onClick={() => setActivePanel('request-changes')}
              className="sk-btn sk-btn--secondary"
              style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}
              aria-label="Request changes"
            >
              <RotateCcw size={14} />
              Request changes
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {onRevoke && (
              <button
                onClick={() => {
                  void onRevoke()
                }}
                className="sk-btn sk-btn--danger-outline"
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}
                aria-label="Revoke"
              >
                <Undo2 size={14} />
                Revoke
              </button>
            )}
            {onComment && (
              <button
                onClick={() => setActivePanel('comment')}
                className="sk-btn sk-btn--ghost"
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}
                aria-label="Comment"
              >
                <MessageSquare size={14} />
                Comment
              </button>
            )}
            {onInlineEdit && artifactContent !== null && (
              <button
                onClick={openInlineEdit}
                className="sk-btn sk-btn--ghost"
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}
                aria-label="Edit"
              >
                <Edit2 size={14} />
                Edit
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
