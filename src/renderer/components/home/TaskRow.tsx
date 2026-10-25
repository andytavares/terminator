import React, { useState } from 'react'
import { Star } from 'lucide-react'
import { compactAge } from './thread-format'
import { useDeskSelection } from './desk-selection'
import { InFlightMenu, useWorkMenu, type WorkMenuState } from './InFlightMenu'
import { RenameField } from './InFlightRow'
import { StateGlyph } from './StateGlyph'
import { canStoreTask, renameThread, toggleFocus } from './task-actions'
import { useMergeDrop } from './thread-drag'
import { laneLabels } from '../../sidebar/lane-labels'
import type { ThreadLane } from './lane-details'
import type { WorkThread } from '../../home/work-threads'
import './InFlight.css'
import './Tasks.css'

interface TaskRowProps {
  thread: WorkThread
  now: number
  selected: boolean
}

interface LaneChipProps {
  lane: ThreadLane
  label: string
  taskState: WorkThread['state']
}

/** A repo the task touches: its colour and name, and the lane's own state when it differs. */
function LaneChip({ lane, label, taskState }: LaneChipProps) {
  return (
    <span className="task-lane">
      <i className="task-lane__colour" style={{ background: lane.repoColor ?? undefined }} />
      {label}
      {lane.state !== taskState && <StateGlyph state={lane.state} />}
    </span>
  )
}

/** Today's focus: pressing it stores the task if it is only a branch, then flips its focus. */
function FocusStar({ thread }: { thread: WorkThread }): JSX.Element | null {
  if (!canStoreTask(thread)) return null
  return (
    <button
      type="button"
      className="task-row__star"
      aria-label={`Focus on ${thread.title}`}
      aria-pressed={thread.focus}
      onClick={(event) => {
        event.stopPropagation()
        void toggleFocus(thread)
      }}
    >
      <Star aria-hidden="true" fill={thread.focus ? 'currentColor' : 'none'} />
    </button>
  )
}

interface TitleProps {
  thread: WorkThread
  rename: CellsProps['rename']
}

function TaskTitle({ thread, rename }: TitleProps): JSX.Element {
  return (
    <div className="task-row__title">
      <FocusStar thread={thread} />
      {rename.renaming ? (
        <RenameField thread={thread} onRename={rename.finish} onCancelRename={rename.cancel} />
      ) : (
        <span className="task-row__name">{thread.title}</span>
      )}
      {thread.ticketKey && <span className="task-row__ticket">{thread.ticketKey}</span>}
    </div>
  )
}

interface CellsProps {
  thread: WorkThread
  now: number
  rename: {
    renaming: boolean
    begin: () => void
    finish: (text: string) => void
    cancel: () => void
  }
  /** The row's context menu, which the row itself opens on a right click. */
  workMenu: WorkMenuState
}

type CellsInput = Pick<CellsProps, 'thread' | 'now'> & {
  controls: Pick<CellsProps, 'rename' | 'workMenu'>
}

/** The row's cells: state, title, repos, what is happening now, last activity, and the menu. */
function TaskRowCells({ thread, now, controls }: CellsInput): JSX.Element {
  const { rename, workMenu } = controls
  const labels = laneLabels(thread.lanes)
  return (
    <>
      <StateGlyph state={thread.state} inferred={thread.inferred} />
      <TaskTitle thread={thread} rename={rename} />
      <div className="task-row__lanes">
        {thread.lanes.map((lane, i) => (
          <LaneChip
            key={`${lane.repoRoot}#${lane.branch}`}
            lane={lane}
            label={labels[i]}
            taskState={thread.state}
          />
        ))}
      </div>
      <div className="task-row__now">{thread.nowLine}</div>
      <span className="task-row__last">{compactAge(now - thread.lastActivity)}</span>
      <InFlightMenu thread={thread} onStartRename={rename.begin} workMenu={workMenu} />
    </>
  )
}

/** The row's rename mode: on, off without saving, and off saving the typed title. */
function useTaskRename(thread: WorkThread): CellsProps['rename'] {
  const [renaming, setRenaming] = useState(false)
  return {
    renaming,
    begin: () => setRenaming(true),
    cancel: () => setRenaming(false),
    finish: (text) => {
      setRenaming(false)
      renameThread(thread, text)
    },
  }
}

function rowClass(selected: boolean, dropTarget: boolean): string {
  return ['task-row', selected && 'task-row--selected', dropTarget && 'task-row--drop']
    .filter(Boolean)
    .join(' ')
}

/** One task on Home; pressing it, or Enter, opens its drawer. Drop another row on it to merge. */
export function TaskRow({ thread, now, selected }: TaskRowProps): JSX.Element {
  const openThread = useDeskSelection((s) => s.openThread)
  const workMenu = useWorkMenu()
  const rename = useTaskRename(thread)
  const drop = useMergeDrop(thread)
  return (
    <div
      {...drop.props}
      role="button"
      tabIndex={0}
      aria-label={thread.title}
      aria-current={selected || undefined}
      data-thread-key={thread.key}
      className={rowClass(selected, drop.over)}
      onClick={() => openThread(thread.key)}
      onContextMenu={workMenu.openWorkMenu}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) openThread(thread.key)
      }}
    >
      <TaskRowCells thread={thread} now={now} controls={{ rename, workMenu }} />
    </div>
  )
}
