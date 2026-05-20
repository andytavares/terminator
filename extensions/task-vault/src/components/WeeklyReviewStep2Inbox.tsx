import React, { useState } from 'react'
import type { IndexedTask } from '../vault/types'
import { InboxProcessor } from './InboxProcessor'

interface Props {
  inboxItems: IndexedTask[]
  onComplete: () => void
}

export function WeeklyReviewStep2Inbox({ inboxItems, onComplete }: Props): React.JSX.Element {
  const [skipped, setSkipped] = useState(false)
  const [items, setItems] = useState(inboxItems)

  if (skipped || items.length === 0) {
    return (
      <div className="wr-step wr-step-2">
        <h3>Step 2: Process Inbox</h3>
        <p className="wr-step__done">Inbox cleared!</p>
        <button className="wr-step__next" onClick={onComplete}>
          Next
        </button>
      </div>
    )
  }

  return (
    <div className="wr-step wr-step-2">
      <h3>Step 2: Process Inbox</h3>
      <InboxProcessor items={items} onDone={() => setItems([])} />
      <button className="wr-step__skip" onClick={() => setSkipped(true)}>
        Skip — process later
      </button>
    </div>
  )
}
