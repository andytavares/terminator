import React, { Suspense, lazy } from 'react'
import { StateGlyph } from './StateGlyph'
import { TaskRow } from './TaskRow'
import { DeskGroupMenu } from './DeskGroupMenu'
import { useNow } from '../session/useNow'
import { useDeskSelection, useShownRows } from './desk-selection'
import { useWorkThreads } from './useWorkThreads'
import { useDeskFilter } from './desk-filter'
import { filterThreads, taskGroups, type DeskGroup } from './desk-groups'
import { TASK_STATES, type TaskState } from '../../home/task-state'
import './Tasks.css'

const ThreadDrawer = lazy(() => import('./ThreadDrawer').then((m) => ({ default: m.ThreadDrawer })))

const MINUTE_MS = 60_000

const isState = (id: string): id is TaskState => (TASK_STATES as readonly string[]).includes(id)

/** The group's name and count, with Show or Hide when the group folds to one line: then the
 *  whole header is the one button that folds it, by click, Enter or Space. */
function GroupHeading({ group }: { group: DeskGroup }): React.JSX.Element {
  const expanded = useDeskSelection((s) => s.expandedGroupIds.includes(group.id))
  const toggleGroup = useDeskSelection((s) => s.toggleGroup)
  const toggle = group.collapsible && {
    role: 'button',
    tabIndex: 0,
    'aria-expanded': expanded,
    'aria-label': `${expanded ? 'Hide' : 'Show'} ${group.label}`,
    onClick: () => toggleGroup(group.id),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      toggleGroup(group.id)
    },
  }
  return (
    <div className={toggle ? 'task-group task-group--toggle' : 'task-group'} {...toggle}>
      {isState(group.id) && <StateGlyph state={group.id} />}
      <h3>{`${group.label} · ${group.threads.length}`}</h3>
      {toggle && (
        <span className="task-group__toggle" aria-hidden="true">
          {expanded ? 'Hide ▾' : 'Show ▸'}
        </span>
      )}
    </div>
  )
}

function GroupRows({ group, now }: { group: DeskGroup; now: number }): React.JSX.Element {
  const { selectedKey, threads } = useShownRows(group)
  return (
    <>
      {threads.map((thread) => (
        <TaskRow key={thread.key} thread={thread} now={now} selected={thread.key === selectedKey} />
      ))}
    </>
  )
}

/** The drawer of the task that is open; its code loads the first time one opens. */
function OpenTaskDrawer(): React.JSX.Element | null {
  const openThreadKey = useDeskSelection((s) => s.openThreadKey)
  if (openThreadKey === null) return null
  return (
    <Suspense fallback={null}>
      <ThreadDrawer />
    </Suspense>
  )
}

/** Home's list of tasks, one row each, grouped by state in the order they are read. */
export function TaskList(): React.JSX.Element {
  const { threads } = useWorkThreads()
  const groupBy = useDeskSelection((s) => s.groupBy)
  const now = useNow(MINUTE_MS)
  const { text, count, taskState } = useDeskFilter()
  const shown = filterThreads(threads, { text, count, taskState })
  const groups = taskGroups(shown, groupBy)
  return (
    <section aria-label="Tasks" className="task-list">
      <div className="task-list__head">
        <h2>{`Tasks · ${groups.reduce((total, g) => total + g.threads.length, 0)}`}</h2>
        <DeskGroupMenu />
      </div>
      {groups.map((group) => (
        <React.Fragment key={group.id}>
          {group.id !== 'all' && <GroupHeading group={group} />}
          <GroupRows group={group} now={now} />
        </React.Fragment>
      ))}
      <OpenTaskDrawer />
    </section>
  )
}
