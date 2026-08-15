import React, { useState } from 'react'

interface Props {
  onComplete: () => void
  reviewId: string | null
}

export function WeeklyReviewStep6Reflect({ onComplete, reviewId }: Props): React.JSX.Element {
  const [worked, setWorked] = useState('')
  const [didnt, setDidnt] = useState('')
  const [tryNext, setTryNext] = useState('')
  const [saving, setSaving] = useState(false)

  async function finishReview() {
    setSaving(true)
    // The reflection is stored on the review record itself. It used to be
    // flattened into a single inbox task, which made the review unreadable
    // afterwards and cluttered the inbox.
    if (reviewId) {
      await window.electronAPI.extensionBridge
        .invoke('task-vault:review:complete', {
          reviewId,
          worked,
          didntWork: didnt,
          tryNext,
        })
        .catch((err) => console.error('[task-vault] failed to complete review', err))
    }
    setSaving(false)
    onComplete()
  }

  return (
    <div className="wr-step wr-step-6">
      <h3>Step 6: Reflect</h3>

      <label className="wr-step__label">
        What worked well?
        <textarea
          className="wr-step__textarea"
          value={worked}
          onChange={(e) => setWorked(e.target.value)}
          rows={3}
        />
      </label>

      <label className="wr-step__label">
        What didn&apos;t work?
        <textarea
          className="wr-step__textarea"
          value={didnt}
          onChange={(e) => setDidnt(e.target.value)}
          rows={3}
        />
      </label>

      <label className="wr-step__label">
        What will you try next week?
        <textarea
          className="wr-step__textarea"
          value={tryNext}
          onChange={(e) => setTryNext(e.target.value)}
          rows={3}
        />
      </label>

      <button className="wr-step__finish" onClick={finishReview} disabled={saving}>
        {saving ? 'Saving…' : 'Finish review'}
      </button>
    </div>
  )
}
