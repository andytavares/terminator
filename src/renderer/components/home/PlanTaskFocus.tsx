import React from 'react'
import { ListTodo, Star } from 'lucide-react'
import { FOCUS_LIMIT } from '../../home/focus'
import { ColumnTitle } from './PlanTheDay'
import { toggleFocus } from './task-actions'
import type { WorkThread } from '../../home/work-threads'

const EMPTY_SLOT = 'pick one more, or leave it empty'

const isOpen = (thread: WorkThread): boolean => !thread.archived && thread.state !== 'done'

/** Every open task with its star; pressing one stars the task on Home and in ⌘J. */
function OpenTasks({ threads }: { threads: readonly WorkThread[] }): JSX.Element {
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
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The starred tasks in their slots, up to the limit. */
function TodaysFocus({ starred }: { starred: readonly WorkThread[] }): JSX.Element {
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
export function PlanTaskFocus({ threads }: { threads: readonly WorkThread[] }): JSX.Element {
  const open = threads.filter(isOpen)
  return (
    <>
      <OpenTasks threads={open} />
      <TodaysFocus starred={open.filter((thread) => thread.focus)} />
    </>
  )
}
