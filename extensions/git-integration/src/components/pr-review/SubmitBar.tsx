import React, { useState } from 'react'
import { githubAPI } from '../../api/github'
import { usePrReviewStore } from '../../stores/pr-review.store'
import type { DraftComment } from '../../schemas/pr-review.schema'

interface Props {
  repoRoot: string
  prNumber: number
  headSHA: string
  drafts: DraftComment[]
  onReviewDrafts: () => void
}

type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

/** S5: pinned bar for drafts collected instead of posted comment-by-comment. */
export function SubmitBar({ repoRoot, prNumber, headSHA, drafts, onReviewDrafts }: Props) {
  const clearDrafts = usePrReviewStore((s) => s.clearDrafts)
  const [event, setEvent] = useState<ReviewEvent>('APPROVE')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (drafts.length === 0) return null

  const fileCount = new Set(drafts.map((d) => d.path)).size
  const fromFindingCount = drafts.filter((d) => d.fromFindingId).length

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const result = await githubAPI.prReviewSubmit({
        repoRoot,
        prNumber,
        event,
        body: '',
        comments: drafts.map((d) => ({
          path: d.path,
          line: d.line,
          startLine: d.startLine,
          side: d.side,
          body: d.body,
        })),
      })
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error((result as { error: string }).error)
      }
      clearDrafts(repoRoot, prNumber, headSHA)
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rc-submit">
      <span className="rc-pip">{drafts.length}</span>
      <span>
        {drafts.length} draft comment{drafts.length === 1 ? '' : 's'} on {fileCount} file
        {fileCount === 1 ? '' : 's'}
      </span>
      {fromFindingCount > 0 && (
        <span className="rc-note">{fromFindingCount} from an agent finding</span>
      )}
      <span className="rc-sp" style={{ flex: 1 }} />
      {error && <span className="rc-submit-error">{error}</span>}
      <button type="button" className="rc-btn" onClick={onReviewDrafts}>
        Review drafts
      </button>
      <div className="rc-seg" role="group" aria-label="Verdict">
        {(
          [
            ['COMMENT', 'Comment'],
            ['APPROVE', 'Approve'],
            ['REQUEST_CHANGES', 'Request changes'],
          ] as const
        ).map(([val, label]) => (
          <button
            key={val}
            type="button"
            aria-pressed={event === val}
            onClick={() => setEvent(val)}
          >
            {label}
          </button>
        ))}
      </div>
      <button type="button" className="rc-btn rc-pri" onClick={handleSubmit} disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit review'}
      </button>
    </div>
  )
}
