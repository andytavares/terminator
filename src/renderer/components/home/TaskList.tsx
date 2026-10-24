import React, { Suspense, lazy } from 'react'
import { StateGlyph } from './StateGlyph'
import { TaskRow } from './TaskRow'
import { DeskGroupMenu } from './DeskGroupMenu'
import { useNow } from '../session/useNow'
import { useDeskSelection } from './desk-selection'
import { useWorkThreads } from './useWorkThreads'
import { useDeskFilter } from './desk-filter'
import { filterThreads, taskGroups, type DeskGroup } from './desk-groups'
import { TASK_STATES, type TaskState } from '../../home/task-state'
import './Tasks.css'

const ThreadDrawer = lazy(() => import('./ThreadDrawer').then((m) => ({ default: m.ThreadDrawer })))

const MINUTE_MS = 60_000

const isState = (id: string): id is TaskState => (TASK_STATES as readonly string[]).includes(id)

/** The group's name and count, with Show or Hide when the group folds to one line. */
function GroupHeading({ group }: { group: DeskGroup }): JSX.Element {
  const expanded = useDeskSelection((s) => s.expandedGroupIds.includes(group.id))
  const toggleGroup = useDeskSelection((s) => s.toggleGroup)
  return (
    <div className="task-group">
      {isState(group.id) && <StateGlyph state={group.id} />}
      <h3>{`${group.label} · ${group.threads.length}`}</h3>
      {group.collapsible && (
        <button
          type="button"
          className="task-group__toggle"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} ${group.label}`}
          onClick={() => toggleGroup(group.id)}
        >
          {expanded ? 'Hide ▾' : 'Show ▸'}
        </button>
      )}
    </div>
  )
}

function GroupRows({ group, now }: { group: DeskGroup; now: number }): JSX.Element | null {
  const selectedKey = useDeskSelection((s) => s.selectedThreadKey)
  const expanded = useDeskSelection((s) => s.expandedGroupIds.includes(group.id))
  if (group.collapsible && !expanded) return null
  return (
    <>
      {group.threads.map((thread) => (
        <TaskRow key={thread.key} thread={thread} now={now} selected={thread.key === selectedKey} />
      ))}
    </>
  )
}

/** The drawer of the task that is open; its code loads the first time one opens. */
function OpenTaskDrawer(): JSX.Element | null {
  const openThreadKey = useDeskSelection((s) => s.openThreadKey)
  if (openThreadKey === null) return null
  return (
    <Suspense fallback={null}>
      <ThreadDrawer />
    </Suspense>
  )
}

/** Home's list of tasks, one row each, grouped by state in the order they are read. */
export function TaskList(): JSX.Element {
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
