import React, { useState } from 'react'
import type { IndexedTask } from '../vault/types'
import { InboxProcessor } from './InboxProcessor'
import { Button } from '@terminator/extension-ui'

interface Props {
  inboxItems: IndexedTask[]
  onComplete: () => void
  reviewId: string | null
}

export function WeeklyReviewStep2Inbox(props: Props): React.JSX.Element {
  const { inboxItems, onComplete, reviewId } = props
  const [skipped, setSkipped] = useState(false)
  const [items, setItems] = useState(inboxItems)

  if (skipped || items.length === 0) {
    return (
      <div className="wr-step wr-step-2">
        <h3>Step 2: Process Inbox</h3>
        <p className="wr-step__done">Inbox cleared!</p>
        <Button variant="primary" onClick={onComplete}>
          Next: projects
        </Button>
      </div>
    )
  }

  return (
    <div className="wr-step wr-step-2">
      <h3>Step 2: Process Inbox</h3>
      <InboxProcessor items={items} onDone={() => setItems([])} reviewId={reviewId} />
      <Button variant="ghost" className="wr-step__skip" onClick={() => setSkipped(true)}>
        Skip — process later
      </Button>
    </div>
  )
}
