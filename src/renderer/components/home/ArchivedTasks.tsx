import React, { useState } from 'react'
import { Button, Popover } from '@terminator/extension-ui'
import { useWorkThreads } from './useWorkThreads'
import { toggleArchived } from './thread-actions'
import { toggleDone } from './task-actions'
import type { WorkThread } from '../../home/work-threads'
import './Tasks.css'

/** What is kept out of the lists: archived work, and tasks marked done that can still be reopened. */
const isKeptAside = (thread: WorkThread): boolean =>
  thread.archived || (thread.state === 'done' && thread.taskId !== null)

function ArchivedRow({ thread }: { thread: WorkThread }): JSX.Element {
  const [verb, undo] = thread.archived
    ? ['Restore', () => toggleArchived(thread)]
    : ['Undo done', () => void toggleDone(thread)]
  return (
    <li className="archived-tasks__row">
      <span className="archived-tasks__title">{thread.title}</span>
      <Button size="sm" variant="ghost" aria-label={`${verb} ${thread.title}`} onClick={undo}>
        {verb}
      </Button>
    </li>
  )
}

/** The Home footer's "Archived tasks (N)" button and the list it opens. */
export function ArchivedTasks(): JSX.Element {
  const { threads } = useWorkThreads()
  const [open, setOpen] = useState(false)
  const kept = threads.filter(isKeptAside)
  return (
    <span className="archived-tasks">
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
        {`Archived tasks (${kept.length})`}
      </Button>
      {open && (
        <Popover
          label="Archived tasks"
          onDismiss={() => setOpen(false)}
          align="end"
          className="archived-tasks__panel"
        >
          {kept.length === 0 ? (
            <p className="archived-tasks__empty">No archived or finished tasks.</p>
          ) : (
            <ul className="archived-tasks__list">
              {kept.map((thread) => (
                <ArchivedRow key={thread.key} thread={thread} />
              ))}
            </ul>
          )}
        </Popover>
      )}
    </span>
  )
}
