import React, { useState } from 'react'
import { Button } from '@terminator/extension-ui'

interface Props {
  onComplete: () => void
  reviewId: string | null
}

interface FieldProps {
  label: string
  value: string
  onChange: (value: string) => void
}

function ReflectionField({ label, value, onChange }: FieldProps): React.JSX.Element {
  return (
    <label className="wr-step__label">
      {label}
      <textarea
        className="wr-step__textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
      />
    </label>
  )
}

/** The reflection is stored on the review record, not flattened into an inbox task as it once
 *  was, which made the review unreadable afterwards and cluttered the inbox. */
async function completeReview(reviewId: string | null, answers: Record<string, string>) {
  if (!reviewId) return
  await window.electronAPI.extensionBridge
    .invoke('task-vault:review:complete', { reviewId, ...answers })
    .catch((err) => console.error('[task-vault] failed to complete review', err))
}

export function WeeklyReviewStep6Reflect({ onComplete, reviewId }: Props): React.JSX.Element {
  const [worked, setWorked] = useState('')
  const [didnt, setDidnt] = useState('')
  const [tryNext, setTryNext] = useState('')
  const [saving, setSaving] = useState(false)

  async function finishReview() {
    setSaving(true)
    await completeReview(reviewId, { worked, didntWork: didnt, tryNext })
    setSaving(false)
    onComplete()
  }

  return (
    <div className="wr-step wr-step-6">
      <h3>Step 6: Reflect</h3>
      <ReflectionField label="What worked well?" value={worked} onChange={setWorked} />
      <ReflectionField label="What didn't work?" value={didnt} onChange={setDidnt} />
      <ReflectionField label="What will you try next week?" value={tryNext} onChange={setTryNext} />
      <Button variant="primary" onClick={finishReview} disabled={saving}>
        {saving ? 'Saving…' : 'Finish review'}
      </Button>
    </div>
  )
}
