import React, { useRef, useState } from 'react'
import { Button, EmptyState, IconButton } from '@terminator/extension-ui'
import { ChevronDown, ChevronLeft, ChevronRight, CornerUpLeft, X } from 'lucide-react'
import type { DailyLog as DailyLogData, IndexedTask } from '../vault/types'
import { SmartTaskInput } from './SmartTaskInput'
import { TaskRow } from './DailyLogTaskRow'
import type { DragHandlers } from './DailyLogTaskRow'
import { GhostAddSubtaskRow, SubtaskRow } from './DailyLogSubtasks'
import { BacklogSection } from './DailyLogBacklog'
import {
  bindId,
  definedFields,
  formatDate,
  invokeVault,
  isStaleSince,
  modifier,
} from './daily-log-format'

interface DailyLogProps {
  log: DailyLogData
  rolledOverTaskIds?: string[]
  selectedContexts?: string[]
  selectedTaskId?: string | null
  onSelectTask?: (taskId: string | null) => void
  onTaskComplete: (taskId: string) => Promise<void>
  onTaskMigrate: (taskId: string, targetDate: string) => Promise<void>
  onRefresh: () => Promise<void>
  onPrevDay?: () => void
  onNextDay?: () => void
  onGoToToday?: () => void
  isToday?: boolean
  somedayTasks?: IndexedTask[]
  /** Opens the inbox — the other place work comes from on an empty day. */
  onOpenInbox?: () => void
  onPickUpToday?: (taskId: string) => Promise<void>
  onDeleteBacklogTask?: (taskId: string) => Promise<void>
  onRefreshBacklog?: () => Promise<void>
  staleDaysThreshold?: number
}

interface AddTaskRowProps {
  onAdd: (text: string) => Promise<void>
  startOpen: boolean
}

interface EmptyDayProps {
  onAdd: () => void
  onOpenInbox?: () => void
}

interface DayProps {
  day: Day
}

interface PartsProps {
  parts: DayParts
  list: ListContext
}

interface TaskItemProps {
  task: IndexedTask
  list: ListContext
  draggable?: boolean
}

interface RolledOverProps {
  tasks: IndexedTask[]
  list: ListContext
  expanded: Toggle
}

interface ListContext {
  day: Day
  drag: TaskDrag
}

type Day = ReturnType<typeof withDefaults>

type DayParts = ReturnType<typeof partitionDay>

type TaskDrag = ReturnType<typeof useTaskDrag>

type Toggle = ReturnType<typeof useToggle>

const TERMINAL_STATUSES = new Set<string>(['done', 'migrated', 'cancelled'])

const DEFAULTS = {
  rolledOverTaskIds: [] as string[],
  selectedContexts: [] as string[],
  selectedTaskId: null as string | null,
  isToday: false,
  somedayTasks: [] as IndexedTask[],
}

/** The props with their defaults filled in. */
function withDefaults(props: DailyLogProps): DailyLogProps & typeof DEFAULTS {
  return { ...DEFAULTS, ...definedFields(props) } as DailyLogProps & typeof DEFAULTS
}

/** The day's tasks in the context filter: rolled over, then today's active before its finished.
 *  One empty state, not three: the day is empty only when it and the backlog under it are. */
function partitionDay(day: Day) {
  const { selectedContexts } = day
  const matches = (t: IndexedTask) =>
    selectedContexts.length === 0 || selectedContexts.includes(t.context ?? '')
  const rolled = new Set(day.rolledOverTaskIds)
  const visible = day.log.tasks.filter(matches)
  const today = visible.filter((t) => !rolled.has(t.id))
  return {
    rolledOver: visible.filter((t) => rolled.has(t.id)),
    active: today.filter((t) => !TERMINAL_STATUSES.has(t.status)),
    terminal: today.filter((t) => TERMINAL_STATUSES.has(t.status)),
    done: visible.filter((t) => t.status === 'done').length,
    total: visible.length,
    isEmptyDay: visible.length === 0 && day.somedayTasks.length === 0,
  }
}

/** The ids with the source moved to the target's place, or null if either is not listed. */
function reorderedIds(tasks: IndexedTask[], sourceId: string, targetId: string): string[] | null {
  const from = tasks.findIndex((t) => t.id === sourceId)
  const to = tasks.findIndex((t) => t.id === targetId)
  if (from === -1 || to === -1) return null
  const ids = tasks.map((t) => t.id)
  const [moved] = ids.splice(from, 1)
  ids.splice(to, 0, moved)
  return ids
}

/** Saves a dragged task's new place; a drop on itself, or off the list, saves nothing. */
async function persistMove(
  tasks: IndexedTask[],
  move: { from: string | null; to: string },
  onRefresh: () => Promise<void>
): Promise<void> {
  if (!move.from || move.from === move.to) return
  const orderedIds = reorderedIds(tasks, move.from, move.to)
  if (!orderedIds) return
  await invokeVault('task-vault:vault:reorder-tasks', { orderedIds })
  await onRefresh()
}

/** Drag-and-drop reordering of the day's active tasks. */
function useTaskDrag(active: IndexedTask[], onRefresh: () => Promise<void>) {
  const draggingId = useRef<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  async function drop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    setDragOverId(null)
    const move = { from: draggingId.current, to: targetId }
    draggingId.current = null
    await persistMove(active, move, onRefresh)
  }
  const handlersFor = (taskId: string): DragHandlers => ({
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move'
      draggingId.current = taskId
    },
    onDragEnd: () => {
      draggingId.current = null
      setDragOverId(null)
    },
    onDragOver: (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOverId(taskId)
    },
    onDrop: (e) => void drop(e, taskId),
  })
  return { dragOverId, handlersFor }
}

function useAddTask(onAdd: AddTaskRowProps['onAdd'], startOpen: boolean) {
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState(startOpen)
  async function submit() {
    if (!text.trim()) return
    setAdding(true)
    try {
      await onAdd(text.trim())
      setText('')
      setOpen(false)
    } finally {
      setAdding(false)
    }
  }
  return { text, setText, adding, open, setOpen, submit }
}

function AddTaskOpener({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  return (
    <button className="daily-log__add-btn" onClick={onOpen}>
      + Add task
    </button>
  )
}

function AddTaskRow(props: AddTaskRowProps): React.JSX.Element {
  const add = useAddTask(props.onAdd, props.startOpen)
  if (!add.open) return <AddTaskOpener onOpen={() => add.setOpen(true)} />
  return (
    <div className="daily-log__add-row">
      <SmartTaskInput
        autoFocus
        value={add.text}
        onChange={add.setText}
        onSubmit={add.submit}
        onCancel={() => add.setOpen(false)}
        disabled={add.adding}
      />
      <Button
        variant="primary"
        size="sm"
        onClick={() => void add.submit()}
        disabled={add.adding || !add.text.trim()}
      >
        Add
      </Button>
      <IconButton icon={X} label="Cancel" size="sm" onClick={() => add.setOpen(false)} />
    </div>
  )
}

function isTaskStale(task: IndexedTask, day: Day): boolean {
  return day.isToday && isStaleSince(task.todaySince, day.staleDaysThreshold)
}

function Subtasks({ task, list }: TaskItemProps): React.JSX.Element {
  const { onRefresh } = list.day
  const canAddSubtask = task.status === 'open' || task.status === 'blocked'
  return (
    <div className="daily-log__subtasks">
      {(task.subtasks ?? []).map((st) => (
        <SubtaskRow key={st.id} subtask={st} onRefresh={onRefresh} />
      ))}
      {canAddSubtask && <GhostAddSubtaskRow taskId={task.id} onRefresh={onRefresh} />}
    </div>
  )
}

function TaskWithSubtasks(props: TaskItemProps): React.JSX.Element {
  const { task, list } = props
  const { day, drag } = list
  const hasSubtasks = (task.subtasks ?? []).length > 0
  return (
    <div>
      <TaskRow
        task={task}
        isSelected={day.selectedTaskId === task.id}
        onSelect={bindId(day.onSelectTask, task.id)}
        onComplete={day.onTaskComplete}
        onMigrate={day.onTaskMigrate}
        onRefresh={day.onRefresh}
        drag={props.draggable ? drag.handlersFor(task.id) : undefined}
        isDragOver={drag.dragOverId === task.id}
        hasSubtasks={hasSubtasks}
        isStale={isTaskStale(task, day)}
      />
      {hasSubtasks && <Subtasks task={task} list={list} />}
    </div>
  )
}

function DayTitle({ day }: DayProps): React.JSX.Element {
  const { weekday, detail } = formatDate(day.log.date)
  return (
    <div className="daily-log__date-text">
      <span className="daily-log__date-weekday">
        {weekday}
        {day.isToday && <span className="daily-log__today-badge">Today</span>}
      </span>
      <span className="daily-log__date-detail">{detail}</span>
    </div>
  )
}

function DayHeader({ day }: DayProps): React.JSX.Element {
  return (
    <div className="daily-log__date">
      <IconButton
        icon={ChevronLeft}
        label="Previous day"
        size="sm"
        className="daily-log__date-nav"
        onClick={() => day.onPrevDay?.()}
        disabled={!day.onPrevDay}
      />
      <DayTitle day={day} />
      {!day.isToday && day.onGoToToday && (
        <Button size="sm" icon={CornerUpLeft} onClick={day.onGoToToday} title="Back to today">
          Today
        </Button>
      )}
      <IconButton
        icon={ChevronRight}
        label="Next day"
        size="sm"
        className="daily-log__date-nav"
        onClick={() => day.onNextDay?.()}
        disabled={!day.onNextDay}
      />
    </div>
  )
}

function TasksHeading({ parts }: { parts: DayParts }): React.JSX.Element {
  const { done, total } = parts
  const fill = `daily-log__progress-fill${modifier(total > 0 && done === total, 'daily-log__progress-fill--complete')}`
  return (
    <>
      <div className="daily-log__section-header">
        <h3>Tasks</h3>
        {total > 0 && (
          <span className="daily-log__task-count">
            {done}/{total}
          </span>
        )}
      </div>
      {total > 0 && (
        <div className="daily-log__progress-bar">
          <div className={fill} style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}
    </>
  )
}

/** An open-or-closed flag, open to start. Kept by the log so a section keeps it across remounts. */
function useToggle() {
  const [on, setOn] = useState(true)
  return { on, toggle: () => setOn((v) => !v) }
}

function RolledOver({ tasks, list, expanded: toggle }: RolledOverProps): React.JSX.Element {
  const expanded = toggle.on
  return (
    <>
      <button className="daily-log__rollover-header" onClick={toggle.toggle}>
        <span className="daily-log__rollover-header-label">
          ↩ From previous days ({tasks.length})
        </span>
        {expanded ? (
          <ChevronDown className="tm-icon-sm" />
        ) : (
          <ChevronRight className="tm-icon-sm" />
        )}
      </button>
      {expanded && tasks.map((task) => <TaskWithSubtasks key={task.id} task={task} list={list} />)}
      <div className="daily-log__rollover-divider" />
      <div className="daily-log__today-label">Today</div>
    </>
  )
}

function TodayTasks({ parts, list }: PartsProps): React.JSX.Element {
  return (
    <>
      {parts.active.map((task) => (
        <TaskWithSubtasks key={task.id} task={task} list={list} draggable />
      ))}
      {parts.terminal.length > 0 && parts.active.length > 0 && (
        <div className="daily-log__done-divider" />
      )}
      {parts.terminal.map((task) => (
        <TaskWithSubtasks key={task.id} task={task} list={list} />
      ))}
    </>
  )
}

function EmptyDay(props: EmptyDayProps): React.JSX.Element {
  return (
    <EmptyState
      heading="Nothing logged today"
      description="Write what you are working on, or pull something across from the inbox."
      actions={[
        { label: 'Add task', tone: 'primary', onSelect: props.onAdd },
        { label: 'Open inbox', onSelect: () => props.onOpenInbox?.() },
      ]}
    />
  )
}

async function addTask(day: Day, text: string): Promise<void> {
  await invokeVault('task-vault:vault:add-task', { filePath: day.log.filePath, text })
  await day.onRefresh()
}

function backlogActionsOf(day: Day) {
  return {
    onPickUpToday: day.onPickUpToday,
    onDelete: day.onDeleteBacklogTask,
    onRefreshBacklog: day.onRefreshBacklog,
    onSelect: day.onSelectTask,
  }
}

/** Today's tasks, the empty state, and the add row the empty state can open. */
function DayTasks({ parts, list }: PartsProps): React.JSX.Element {
  const { day } = list
  const [forceAddOpen, setForceAddOpen] = useState(false)
  const addTaskToDay = (text: string) => addTask(day, text)
  const showAdd = !parts.isEmptyDay || forceAddOpen
  return (
    <>
      {parts.isEmptyDay && (
        <EmptyDay onAdd={() => setForceAddOpen(true)} onOpenInbox={day.onOpenInbox} />
      )}
      <TodayTasks parts={parts} list={list} />
      {showAdd && <AddTaskRow onAdd={addTaskToDay} startOpen={forceAddOpen} />}
    </>
  )
}

export function DailyLog(props: DailyLogProps): React.JSX.Element {
  const day = withDefaults(props)
  const parts = partitionDay(day)
  const list = { day, drag: useTaskDrag(parts.active, day.onRefresh) }
  const rolloverExpanded = useToggle()
  return (
    <div className="daily-log">
      <DayHeader day={day} />
      <section className="daily-log__tasks">
        <TasksHeading parts={parts} />
        {parts.rolledOver.length > 0 && (
          <RolledOver tasks={parts.rolledOver} list={list} expanded={rolloverExpanded} />
        )}
        <DayTasks parts={parts} list={list} />
        <BacklogSection
          tasks={day.somedayTasks}
          isEmptyDay={parts.isEmptyDay}
          actions={backlogActionsOf(day)}
        />
      </section>
    </div>
  )
}
