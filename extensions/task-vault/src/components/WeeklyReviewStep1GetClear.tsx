import React from 'react'
import type { IndexedTask } from '../vault/types'

interface Props {
  inboxItems: IndexedTask[]
  onItemFiled: (taskId: string) => void
  onComplete: () => void
}

export function WeeklyReviewStep1GetClear({
  inboxItems,
  onItemFiled,
  onComplete,
}: Props): React.JSX.Element {
  const remaining = inboxItems.filter((t) => t.status === 'open')

  async function fileToInbox(taskId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:process-inbox-item', {
      taskId,
      action: 'someday',
    })
    onItemFiled(taskId)
  }

  return (
    <div className="wr-step wr-step-1">
      <h3>Step 1: Get Clear</h3>
      <p>Capture any loose items not yet in your inbox.</p>

      {remaining.length === 0 ? (
        <p className="wr-step__done">All items captured!</p>
      ) : (
        <ul className="wr-step__list">
          {remaining.map((item) => (
            <li key={item.id} className="wr-step__item">
              <span>{item.text}</span>
              <button onClick={() => fileToInbox(item.id)}>File to inbox</button>
            </li>
          ))}
        </ul>
      )}

      <button className="wr-step__next" onClick={onComplete}>
        Next
      </button>
    </div>
  )
}
