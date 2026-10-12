import React, { useState } from 'react'
import { Check } from 'lucide-react'
import { logReviewAction } from '../utils/review-log'
import { Button } from '@terminator/extension-ui'

interface Props {
  onComplete: () => void
  reviewId: string | null
}

interface Capture {
  text: string
  setText: (text: string) => void
  adding: boolean
  captured: string[]
  add: () => Promise<void>
}

/** Sends typed text to the inbox, remembering what this step captured. */
function useCapture(reviewId: string | null): Capture {
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [captured, setCaptured] = useState<string[]>([])

  async function add() {
    const item = text.trim()
    if (!item) return
    setAdding(true)
    try {
      const result = (await window.electronAPI.extensionBridge.invoke('task-vault:vault:add-task', {
        filePath: 'inbox.md',
        text: item,
      })) as { error?: string }
      if (result?.error) return
      logReviewAction(reviewId, {
        step: 1,
        action: 'captured',
        entityType: 'task',
        entityLabel: item,
      })
      setCaptured((prev) => [...prev, item])
      setText('')
    } finally {
      setAdding(false)
    }
  }

  return { text, setText, adding, captured, add }
}

function CaptureRow({ capture }: { capture: Capture }): React.JSX.Element {
  const { text, setText, adding, add } = capture
  return (
    <div className="wr-step__capture-row">
      <input
        className="wr-step__capture-input"
        placeholder="Add to inbox…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void add()
        }}
        disabled={adding}
        autoFocus
      />
      <Button variant="primary" onClick={() => void add()} disabled={adding || !text.trim()}>
        Add
      </Button>
    </div>
  )
}

function CapturedList({ items }: { items: string[] }): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <ul className="wr-step__captured-list">
      {items.map((item, i) => (
        <li key={i} className="wr-step__captured-item">
          <Check aria-hidden="true" /> {item}
        </li>
      ))}
    </ul>
  )
}

/**
 * The filled button always advances. It used to read "Nothing to add — Next",
 * which made the loudest control on every step of a six-step wizard the one
 * that skips it. Skipping stays available, as a link.
 */
function StepActions(props: { canSkip: boolean; onComplete: () => void }): React.JSX.Element {
  const { canSkip, onComplete } = props
  return (
    <div className="wr-step__actions">
      {canSkip && (
        <Button variant="ghost" className="wr-step__skip" onClick={onComplete}>
          Nothing loose — skip
        </Button>
      )}
      <span className="wr-step__actions-spacer" />
      <Button variant="primary" onClick={onComplete}>
        Next: inbox
      </Button>
    </div>
  )
}

export function WeeklyReviewStep1GetClear({ onComplete, reviewId }: Props): React.JSX.Element {
  const capture = useCapture(reviewId)
  return (
    <div className="wr-step wr-step-1">
      <h3>Step 1: Get Clear</h3>
      <p>
        Capture any loose items not yet in your inbox — physical papers, email, sticky notes, open
        browser tabs.
      </p>
      <CaptureRow capture={capture} />
      <CapturedList items={capture.captured} />
      <StepActions canSkip={capture.captured.length === 0} onComplete={onComplete} />
    </div>
  )
}
