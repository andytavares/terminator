import React, { useState } from 'react'
import { logReviewAction } from '../utils/review-log'

interface Props {
  onComplete: () => void
  reviewId: string | null
}

export function WeeklyReviewStep1GetClear({ onComplete, reviewId }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [captured, setCaptured] = useState<string[]>([])

  async function handleAdd() {
    if (!text.trim()) return
    setAdding(true)
    try {
      const result = (await window.electronAPI.extensionBridge.invoke('task-vault:vault:add-task', {
        filePath: 'inbox.md',
        text: text.trim(),
      })) as { error?: string }
      if (result?.error) return
      logReviewAction(reviewId, {
        step: 1,
        action: 'captured',
        entityType: 'task',
        entityLabel: text.trim(),
      })
      setCaptured((prev) => [...prev, text.trim()])
      setText('')
    } finally {
      setAdding(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') void handleAdd()
  }

  return (
    <div className="wr-step wr-step-1">
      <h3>Step 1: Get Clear</h3>
      <p>
        Capture any loose items not yet in your inbox — physical papers, email, sticky notes, open
        browser tabs.
      </p>

      <div className="wr-step__capture-row">
        <input
          className="wr-step__capture-input"
          placeholder="Add to inbox…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          disabled={adding}
          autoFocus
        />
        <button
          className="tv-btn tv-btn--primary"
          onClick={() => void handleAdd()}
          disabled={adding || !text.trim()}
        >
          Add
        </button>
      </div>

      {captured.length > 0 && (
        <ul className="wr-step__captured-list">
          {captured.map((item, i) => (
            <li key={i} className="wr-step__captured-item">
              ✓ {item}
            </li>
          ))}
        </ul>
      )}

      {/* The filled button always advances. It used to read "Nothing to add —
          Next", which made the loudest control on every step of a six-step
          wizard the one that skips it. Skipping stays available, as a link. */}
      <div className="wr-step__actions">
        {captured.length === 0 && (
          <button type="button" className="wr-step__skip" onClick={onComplete}>
            Nothing loose — skip
          </button>
        )}
        <span className="wr-step__actions-spacer" />
        <button type="button" className="tv-btn tv-btn--primary" onClick={onComplete}>
          Next: inbox
        </button>
      </div>
    </div>
  )
}
