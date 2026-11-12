import React, { useState } from 'react'
import { Button, Popover } from '@terminator/extension-ui'
import { useWorkThreads } from './useWorkThreads'
import { useWorkMarks } from '../../home/work-marks'
import { recordUse } from '../../usage/record'
import type { WorkThread } from '../../home/work-threads'
import './Tasks.css'

function SettledRow({ thread }: { thread: WorkThread }): React.JSX.Element {
  const restore = useWorkMarks((s) => s.restore)
  return (
    <li className="archived-tasks__row">
      <span className="archived-tasks__title">{thread.title}</span>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Restore ${thread.title}`}
        onClick={() => restore(thread.key, Date.now())}
      >
        Restore
      </Button>
    </li>
  )
}

function SettledPanel({ rows, onDismiss }: { rows: WorkThread[]; onDismiss: () => void }) {
  return (
    <Popover label="Settled" onDismiss={onDismiss} align="end" className="archived-tasks__panel">
      {rows.length === 0 ? (
        <p className="archived-tasks__empty">No settled tasks.</p>
      ) : (
        <ul className="archived-tasks__list">
          {rows.map((thread) => (
            <SettledRow key={thread.key} thread={thread} />
          ))}
        </ul>
      )}
    </Popover>
  )
}

/** The Home footer's "Settled (N)" button: the rows the Inbox settles, each with Restore. */
export function SettledTasks(): React.JSX.Element {
  const rows = useWorkThreads().settledThreads
  const [open, setOpen] = useState(false)
  return (
    <span className="archived-tasks">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          if (!open) recordUse('core.home.settled')
          setOpen(!open)
        }}
      >
        {`Settled (${rows.length})`}
      </Button>
      {open && <SettledPanel rows={rows} onDismiss={() => setOpen(false)} />}
    </span>
  )
}
