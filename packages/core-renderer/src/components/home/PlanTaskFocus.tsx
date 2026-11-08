import React from 'react'
import { ListTodo, Star } from 'lucide-react'
import { FOCUS_LIMIT } from '../../home/focus'
import { ColumnTitle } from './PlanTheDay'
import { toggleFocus } from './task-actions'
import { toggleArchived } from './thread-actions'
import type { WorkThread } from '../../home/work-threads'

const EMPTY_SLOT = 'pick one more, or leave it empty'
const DAY_MS = 24 * 60 * 60_000
/** Quiet this long, a task is offered for archiving; you decide, nothing archives itself. */
const QUIET_DAYS_TO_OFFER = 3

/** Whole days a quiet task has been quiet, or null when it is not quiet or not long enough. */
function quietDays(thread: WorkThread, now: number): number | null {
  const days = Math.floor((now - thread.lastActivity) / DAY_MS)
  return thread.state === 'quiet' && days >= QUIET_DAYS_TO_OFFER ? days : null
}

/** "quiet 3 days" and an Archive button, for a task quiet long enough to ask about. */
function ArchiveOffer({
  thread,
  now,
}: {
  thread: WorkThread
  now: number
}): React.JSX.Element | null {
  const days = quietDays(thread, now)
  if (days === null) return null
  return (
    <span className="plan__offer">
      <span>{`quiet ${days} days`}</span>
      <button
        type="button"
        className="plan__archive"
        aria-label={`Archive ${thread.title}`}
        onClick={() => toggleArchived(thread)}
      >
        Archive
      </button>
    </span>
  )
}

const isOpenTask = (thread: WorkThread): boolean => !thread.archived && thread.state !== 'done'

/** Every open task with its star; pressing one stars the task on Home and in ⌘J. */
function OpenTasks({
  threads,
  now,
}: {
  threads: readonly WorkThread[]
  now: number
}): React.JSX.Element {
  return (
    <div className="plan__column">
      <ColumnTitle icon={<ListTodo aria-hidden="true" />}>OPEN TASKS</ColumnTitle>
      <ul className="plan__list" aria-label="Open tasks">
        {threads.map((thread) => (
          <li key={thread.key}>
            <button
              type="button"
              className="plan__pick"
              aria-pressed={thread.focus}
              onClick={() => void toggleFocus(thread)}
            >
              <Star aria-hidden="true" />
              {thread.title}
            </button>
            <ArchiveOffer thread={thread} now={now} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The starred tasks in their slots, up to the limit. */
function TodaysFocus({ starred }: { starred: readonly WorkThread[] }): React.JSX.Element {
  const slots = Array.from({ length: FOCUS_LIMIT }, (_, index) => starred[index])
  return (
    <div className="plan__column">
      <ColumnTitle
        icon={<Star aria-hidden="true" />}
      >{`TODAY'S FOCUS · PICK UP TO ${FOCUS_LIMIT}`}</ColumnTitle>
      <ol className="plan__list" aria-label="Today's focus">
        {slots.map((thread, index) => (
          <li
            className="plan__slot"
            data-filled={thread ? '' : undefined}
            key={thread?.key ?? index}
          >
            <span className="plan__slot-number">{index + 1}</span>
            <span>{thread ? thread.title : EMPTY_SLOT}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The Tasks layout's focus: stars on tasks, not a separate list of items. */
export function PlanTaskFocus(props: {
  threads: readonly WorkThread[]
  now: number
}): React.JSX.Element {
  const open = props.threads.filter(isOpenTask)
  return (
    <>
      <OpenTasks threads={open} now={props.now} />
      <TodaysFocus starred={open.filter((thread) => thread.focus)} />
    </>
  )
}
