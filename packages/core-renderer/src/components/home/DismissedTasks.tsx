import React, { useState } from 'react'
import { Button, Popover } from '@terminator/extension-ui'
import { useWorkThreads } from './useWorkThreads'
import { useDismissedThreads } from './dismissed-threads'
import { recordUse } from '../../usage/record'
import type { WorkThread } from '../../home/work-threads'
import './Tasks.css'

function DismissedRow({ thread }: { thread: WorkThread }): React.JSX.Element {
  const restore = useDismissedThreads((s) => s.restore)
  return (
    <li className="archived-tasks__row">
      <span className="archived-tasks__title">{thread.title}</span>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Restore ${thread.title}`}
        onClick={() => restore(thread.key)}
      >
        Restore
      </Button>
    </li>
  )
}

function DismissedPanel({ rows, onDismiss }: { rows: WorkThread[]; onDismiss: () => void }) {
  return (
    <Popover label="Dismissed" onDismiss={onDismiss} align="end" className="archived-tasks__panel">
      {rows.length === 0 ? (
        <p className="archived-tasks__empty">No dismissed tasks.</p>
      ) : (
        <ul className="archived-tasks__list">
          {rows.map((thread) => (
            <DismissedRow key={thread.key} thread={thread} />
          ))}
        </ul>
      )}
    </Popover>
  )
}

/** The Home footer's "Dismissed (N)" button: the rows the operator dismissed, each with Restore. */
export function DismissedTasks(): React.JSX.Element {
  const rows = useWorkThreads().dismissedThreads
  const [open, setOpen] = useState(false)
  return (
    <span className="archived-tasks">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          if (!open) recordUse('core.home.dismissed')
          setOpen(!open)
        }}
      >
        {`Dismissed (${rows.length})`}
      </Button>
      {open && <DismissedPanel rows={rows} onDismiss={() => setOpen(false)} />}
    </span>
  )
}
