import React, { useEffect, useRef, useState } from 'react'
import { Button, IconButton } from '@terminator/extension-ui'
import {
  Archive,
  ArrowRight,
  GripVertical,
  ListPlus,
  OctagonAlert,
  Repeat,
  RotateCcw,
  Sunset,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import type { IndexedTask, TaskStatus } from '../vault/types'
import { DateTimePicker } from './DateTimePicker'
import { TaskTextEditor, draftOf } from './inline-edits'
import { StatusIcon } from './DailyLogStatusIcon'
import { SessionPicker } from './DailyLogSessionPicker'
import type { SessionChoice } from './DailyLogSessionPicker'
import { BlockModal, RecurrenceModal } from './DailyLogDialogs'
import { SubtaskDraftRow, useSubtaskDraft } from './DailyLogSubtasks'
import { notify } from '../utils/notify'
import type { ToastType } from '../utils/notify'
import {
  draftRule,
  existingRecurrence,
  formatCheckInterval,
  formatRecurrenceRule,
  invokeVault,
  makeTaskNavHandler,
  modifier,
  pointerWhen,
  rawTaskText,
  recurrenceTitle,
} from './daily-log-format'
import type { RecurrenceDraft } from './daily-log-format'

/** The drag handlers a reorderable row carries. */
export interface DragHandlers {
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

export interface TaskRowProps {
  task: IndexedTask
  isSelected?: boolean
  onSelect?: () => void
  onComplete: (id: string) => Promise<void>
  onMigrate: (id: string, date: string) => Promise<void>
  onRefresh: () => Promise<void>
  /** Present when the row can be dragged to reorder. */
  drag?: DragHandlers
  isDragOver?: boolean
  hasSubtasks?: boolean
  isStale?: boolean
}

interface RowProps {
  row: Row
}

type Row = ReturnType<typeof useTaskRow>

const SELECT_DELAY_MS = 220

/** The recurrence channel's payload: only the end detail the end type uses. */
function recurrencePayload(taskId: string, draft: RecurrenceDraft) {
  return {
    taskId,
    interval: draft.interval,
    days: draft.days.length > 0 ? draft.days : undefined,
    time: draft.time || undefined,
    endType: draft.endType,
    endDate: draft.endType === 'on_date' ? draft.endDate : undefined,
    endCount: draft.endType === 'after_count' ? draft.endCount : undefined,
  }
}

/** Runs a vault call for the task, then its notice, then a refresh. */
function taskRunner(task: IndexedTask, onRefresh: () => Promise<void>) {
  return async (channel: string, payload: object, after: () => void) => {
    await invokeVault(channel, { taskId: task.id, ...payload })
    after()
    await onRefresh()
  }
}

/** A notice naming the task that leads back to it when clicked. */
function navNotice(task: IndexedTask) {
  return (type: ToastType, verb: string, key: string) => () =>
    notify(type, `${verb}: ${task.text}`, { key, onClick: makeTaskNavHandler(task.id) })
}

/** Archiving, restoring, blocking and removing the task. */
function statusCommands(task: IndexedTask, onRefresh: () => Promise<void>) {
  const run = taskRunner(task, onRefresh)
  const told = navNotice(task)
  return {
    archive: () =>
      run('task-vault:vault:cancel-task', {}, told('info', 'Archived', 'taskArchived')),
    restore: () =>
      run('task-vault:vault:reopen-task', {}, told('info', 'Reopened', 'taskReopened')),
    unblock: () =>
      run('task-vault:vault:unblock-task', {}, told('success', 'Unblocked', 'taskUnblocked')),
    block: (reason: string, checkInterval: string) =>
      run(
        'task-vault:vault:block-task',
        { reason, checkInterval },
        told('warning', 'Blocked', 'taskBlocked')
      ),
    remove: () => run('task-vault:vault:delete-task', {}, () => {}),
    resetStale: () => run('task-vault:vault:reset-today-since', {}, () => {}),
  }
}

/** Sending the task to the backlog, and setting or clearing its recurrence. */
function scheduleCommands(task: IndexedTask, onRefresh: () => Promise<void>) {
  const run = taskRunner(task, onRefresh)
  return {
    sendToBacklog: () =>
      run('task-vault:vault:process-inbox-item', { action: 'someday' }, () =>
        notify('info', `Moved to backlog: ${task.text}`, 'taskMovedToBacklog')
      ),
    setRecurrence: (draft: RecurrenceDraft) =>
      run('task-vault:vault:set-recurrence', recurrencePayload(task.id, draft), () =>
        notify('success', `Recurrence set: ${formatRecurrenceRule(draftRule(draft))}`, {
          key: 'recurrenceSet',
          onClick: makeTaskNavHandler(task.id),
        })
      ),
    clearRecurrence: () =>
      run('task-vault:vault:clear-recurrence', {}, () =>
        notify('info', `Recurrence removed: ${task.text}`, 'recurrenceRemoved')
      ),
  }
}

/** Editing the task in place, starting from its raw text. */
function useTaskEdit(task: IndexedTask, onRefresh: () => Promise<void>) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const start = () => {
    setEditText(rawTaskText(task))
    setEditing(true)
  }
  async function save() {
    if (!editText.trim()) return
    await invokeVault('task-vault:vault:edit-task', { taskId: task.id, text: editText.trim() })
    setEditing(false)
    await onRefresh()
  }
  return { editing, setEditing, editText, setEditText, start, save }
}

/**
 * A click selects after a short wait, so a second click can turn it into an edit;
 * a task that cannot be edited selects at once.
 */
function useClickToSelect(canEdit: boolean, onSelect: (() => void) | undefined, edit: () => void) {
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current)
    }
  }, [])
  return () => {
    if (!canEdit) return onSelect?.()
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
      return edit()
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null
      onSelect?.()
    }, SELECT_DELAY_MS)
  }
}

/** The session the task is linked to, following the links the task arrives with. */
function useLinkedSession(task: IndexedTask) {
  const links = task.terminatorLinks
  const [linked, setLinked] = useState(links.length > 0)
  const [linkedSessionId, setLinkedSessionId] = useState<string | null>(links[0] ?? null)
  const [linksSeen, setLinksSeen] = useState(links)
  if (linksSeen !== links) {
    setLinksSeen(links)
    setLinked(links.length > 0)
    if (links[0]) setLinkedSessionId(links[0])
  }
  const markLinked = (sessionId: string) => {
    setLinkedSessionId(sessionId)
    setLinked(true)
  }
  return { linked: linked || links.length > 0, linkedSessionId, markLinked }
}

/** Jumps to the session when it is still open; otherwise asks for another. */
function jumpToSession(sessionId: string | null, relink: () => void): void {
  if (!sessionId) return relink()
  void window.electronAPI.terminal
    .listSessions()
    .then((sessions) => {
      const meta = sessions.find((s) => s.sessionId === sessionId)
      if (!meta) return relink()
      return invokeVault('task-vault:navigate-to-terminal', {
        sessionId: meta.sessionId,
        projectId: meta.projectId,
      })
    })
    .catch(relink)
}

/** Linking the task to a terminal session, and jumping to the one it has. */
function useTerminalLink(task: IndexedTask, onRefresh: () => Promise<void>) {
  const [linking, setLinking] = useState(false)
  const session = useLinkedSession(task)
  async function link(choice: SessionChoice) {
    const result = await invokeVault('task-vault:links:create', {
      taskId: task.id,
      targetId: choice.sessionId,
    })
    setLinking(false)
    if (result && typeof result === 'object' && 'error' in result) {
      const { error } = result as { error: string }
      return notify('error', `Could not save terminal link: ${error}`, 'terminalLinkSaveFailed')
    }
    session.markLinked(choice.sessionId)
    await onRefresh()
  }
  const jump = () => jumpToSession(session.linkedSessionId, () => setLinking(true))
  return { linking, setLinking, linked: session.linked, link, jump }
}

/** Moving the task to another day. */
function useMigrate(task: IndexedTask, onMigrate: TaskRowProps['onMigrate']) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState('')
  async function migrate() {
    if (!date) return
    await onMigrate(task.id, date)
    setOpen(false)
    setDate('')
  }
  return { open, setOpen, date, setDate, migrate }
}

function statusFlags(status: TaskStatus) {
  return {
    isOpen: status === 'open' || status === 'in-progress',
    isBlocked: status === 'blocked',
  }
}

/** Everything a task row shows and does. */
function useTaskRow(props: TaskRowProps) {
  const { task, onRefresh } = props
  const flags = statusFlags(task.status)
  const edit = useTaskEdit(task, onRefresh)
  const onTextClick = useClickToSelect(flags.isOpen || flags.isBlocked, props.onSelect, edit.start)
  const commands = { ...statusCommands(task, onRefresh), ...scheduleCommands(task, onRefresh) }
  const link = useTerminalLink(task, onRefresh)
  const migrate = useMigrate(task, props.onMigrate)
  const subtask = useSubtaskDraft(task.id, onRefresh)
  const [blockOpen, setBlockOpen] = useState(false)
  const [recurrenceOpen, setRecurrenceOpen] = useState(false)
  const dialogs = { blockOpen, setBlockOpen, recurrenceOpen, setRecurrenceOpen }
  return { props, task, ...flags, edit, onTextClick, commands, link, migrate, subtask, dialogs }
}

function statusClass(status: TaskStatus): string {
  if (status === 'done') return ' daily-log__task--done'
  if (status === 'cancelled') return ' daily-log__task--cancelled'
  if (status === 'blocked') return ' daily-log__task--blocked'
  return ''
}

function rowClass({ row }: RowProps): string {
  const { props } = row
  return [
    'daily-log__task',
    statusClass(row.task.status),
    modifier(props.isSelected, 'daily-log__task--selected'),
    modifier(props.isDragOver, 'daily-log__task--drag-over'),
    modifier(props.isStale && row.isOpen, 'daily-log__task--stale'),
  ].join('')
}

function textClass(status: TaskStatus): string {
  if (status === 'done' || status === 'migrated') {
    return 'daily-log__task-text daily-log__task-text--strikethrough'
  }
  if (status === 'cancelled') return 'daily-log__task-text daily-log__task-text--cancelled'
  return 'daily-log__task-text'
}

function TaskMarker({ row }: RowProps): React.JSX.Element {
  if (!row.isOpen) {
    return (
      <span className="daily-log__task-marker">
        <StatusIcon status={row.task.status} />
      </span>
    )
  }
  return (
    <button
      className="daily-log__task-checkbox"
      onClick={() => void row.props.onComplete(row.task.id)}
      title="Complete task"
    >
      <StatusIcon status={row.task.status} />
    </button>
  )
}

function TaskEditor({ row }: RowProps): React.JSX.Element {
  return <TaskTextEditor draft={draftOf(row.edit)} className="daily-log__task-edit" />
}

function textTitle(row: Row): string {
  if (row.isOpen || row.isBlocked) return 'Click to open detail · Double-click to edit'
  return 'Click to open detail'
}

function TaskText({ row }: RowProps): React.JSX.Element {
  return (
    <span
      className={textClass(row.task.status)}
      onClick={row.onTextClick}
      title={textTitle(row)}
      style={pointerWhen(row.props.onSelect)}
    >
      {row.task.text}
    </span>
  )
}

function LinkButton({ row }: RowProps): React.JSX.Element {
  if (!row.link.linked) {
    return (
      <IconButton
        icon={Zap}
        label="Link to terminal session"
        onClick={() => row.link.setLinking(true)}
      />
    )
  }
  return <IconButton icon={Zap} label="Jump to linked terminal" onClick={row.link.jump} />
}

function AddSubtaskButton({ row }: RowProps): React.JSX.Element | null {
  if (row.props.hasSubtasks) return null
  return (
    <IconButton icon={ListPlus} label="Add subtask" onClick={() => row.subtask.setActive(true)} />
  )
}

function ArchiveButton({ row }: RowProps): React.JSX.Element {
  return (
    <IconButton icon={Archive} label="Archive task" onClick={() => void row.commands.archive()} />
  )
}

function recurrenceLabel(task: IndexedTask): string {
  if (!task.recurrenceRule) return 'Set recurrence'
  return `Recurrence: ${formatRecurrenceRule(task.recurrenceRule)}`
}

function OpenActions({ row }: RowProps): React.JSX.Element {
  return (
    <span className="daily-log__task-actions">
      <IconButton
        icon={ArrowRight}
        label="Migrate to another day"
        onClick={() => row.migrate.setOpen(true)}
      />
      <IconButton
        icon={Sunset}
        label="Send to backlog"
        onClick={() => void row.commands.sendToBacklog()}
      />
      <LinkButton row={row} />
      <AddSubtaskButton row={row} />
      <IconButton
        icon={Repeat}
        label={recurrenceLabel(row.task)}
        onClick={() => row.dialogs.setRecurrenceOpen(true)}
      />
      <IconButton
        icon={OctagonAlert}
        label="Mark as blocked"
        onClick={() => row.dialogs.setBlockOpen(true)}
      />
      <ArchiveButton row={row} />
    </span>
  )
}

function BlockedActions({ row }: RowProps): React.JSX.Element {
  return (
    <span className="daily-log__task-actions">
      <AddSubtaskButton row={row} />
      <Button size="sm" onClick={() => void row.commands.unblock()} title="Unblock task">
        Unblock
      </Button>
      <ArchiveButton row={row} />
    </span>
  )
}

function FinishedActions({ row }: RowProps): React.JSX.Element {
  const { status } = row.task
  const removable = status === 'migrated' || status === 'cancelled'
  return (
    <span className="daily-log__task-actions">
      {(status === 'done' || removable) && (
        <IconButton
          icon={RotateCcw}
          label="Restore to open"
          onClick={() => void row.commands.restore()}
        />
      )}
      {removable && (
        <IconButton icon={Trash2} label="Remove" onClick={() => void row.commands.remove()} />
      )}
    </span>
  )
}

function TaskLine({ row }: RowProps): React.JSX.Element {
  return (
    <div className="daily-log__task-line1">
      <TaskText row={row} />
      {row.isOpen && <OpenActions row={row} />}
      {row.isBlocked && <BlockedActions row={row} />}
      {!row.isOpen && !row.isBlocked && <FinishedActions row={row} />}
    </div>
  )
}

function TaskTags({ task }: { task: IndexedTask }): React.JSX.Element {
  return (
    <>
      {task.project && (
        <span className="daily-log__tag daily-log__tag--project">@{task.project}</span>
      )}
      {task.context && (
        <span className="daily-log__tag daily-log__tag--context">+{task.context}</span>
      )}
      {task.area && <span className="daily-log__tag daily-log__tag--area">#{task.area}</span>}
      {task.dueDate && (
        <span className="daily-log__tag daily-log__tag--due">due:{task.dueDate}</span>
      )}
    </>
  )
}

function BlockedReason({ task }: { task: IndexedTask }): React.JSX.Element {
  const interval = task.blockedCheckInterval
  return (
    <span
      className="daily-log__blocked-reason"
      title={interval ? `Check in: ${formatCheckInterval(interval)}` : undefined}
    >
      ⊘ {task.blockedReason}
    </span>
  )
}

function StaleBadge({ row }: RowProps): React.JSX.Element {
  return (
    <span
      className="daily-log__stale-badge"
      title="This task has been rolling over for a while. Keep it, send to backlog, or delete it."
    >
      stale
      <button
        className="daily-log__stale-dismiss"
        onClick={(e) => {
          e.stopPropagation()
          void row.commands.resetStale()
        }}
        title="Keep as-is (reset stale timer)"
      >
        keep
      </button>
    </span>
  )
}

function hasMeta(row: Row): boolean {
  const { task } = row
  const tagged = task.project || task.context || task.area || task.dueDate
  const reason = row.isBlocked && task.blockedReason
  return Boolean(tagged || reason || task.recurrenceRule || row.props.isStale)
}

function TaskMeta({ row }: RowProps): React.JSX.Element | null {
  const { task } = row
  if (!hasMeta(row)) return null
  return (
    <div className="daily-log__task-meta">
      <TaskTags task={task} />
      {row.isBlocked && task.blockedReason && <BlockedReason task={task} />}
      {task.recurrenceRule && (
        <span className="daily-log__recurrence-badge" title={recurrenceTitle(task)}>
          <Repeat className="tm-icon-sm" />
        </span>
      )}
      {row.props.isStale && row.isOpen && <StaleBadge row={row} />}
    </div>
  )
}

function MigratePicker({ row }: RowProps): React.JSX.Element {
  const { migrate } = row
  return (
    <span className="daily-log__migrate-picker">
      <DateTimePicker mode="date" value={migrate.date} onChange={migrate.setDate} />
      <Button variant="primary" onClick={() => void migrate.migrate()} disabled={!migrate.date}>
        Move
      </Button>
      <IconButton icon={X} label="Cancel move" size="sm" onClick={() => migrate.setOpen(false)} />
    </span>
  )
}

function TaskBody({ row }: RowProps): React.JSX.Element {
  return (
    <div className="daily-log__task-body">
      {row.edit.editing ? (
        <TaskEditor row={row} />
      ) : (
        <>
          <TaskLine row={row} />
          <TaskMeta row={row} />
        </>
      )}
      {row.migrate.open && <MigratePicker row={row} />}
      {row.link.linking && (
        <SessionPicker
          onSelect={(session) => void row.link.link(session)}
          onClose={() => row.link.setLinking(false)}
        />
      )}
    </div>
  )
}

function BlockDialog({ row }: RowProps): React.JSX.Element | null {
  const { dialogs, commands } = row
  if (!dialogs.blockOpen) return null
  return (
    <BlockModal
      onConfirm={(reason, checkInterval) => {
        dialogs.setBlockOpen(false)
        void commands.block(reason, checkInterval)
      }}
      onClose={() => dialogs.setBlockOpen(false)}
    />
  )
}

function RecurrenceDialog({ row }: RowProps): React.JSX.Element | null {
  const { dialogs, commands } = row
  if (!dialogs.recurrenceOpen) return null
  return (
    <RecurrenceModal
      existing={existingRecurrence(row.task)}
      onConfirm={(draft) => {
        dialogs.setRecurrenceOpen(false)
        void commands.setRecurrence(draft)
      }}
      onClear={() => {
        dialogs.setRecurrenceOpen(false)
        void commands.clearRecurrence()
      }}
      onClose={() => dialogs.setRecurrenceOpen(false)}
    />
  )
}

function DragHandle(): React.JSX.Element {
  return (
    <span className="daily-log__drag-handle" title="Drag to reorder">
      <GripVertical className="tm-icon" />
    </span>
  )
}

export function TaskRow(props: TaskRowProps): React.JSX.Element {
  const row = useTaskRow(props)
  const { drag } = props
  return (
    <>
      <div
        className={rowClass({ row })}
        draggable={drag ? true : undefined}
        onDragStart={drag?.onDragStart}
        onDragEnd={drag?.onDragEnd}
        onDragOver={drag?.onDragOver}
        onDrop={drag?.onDrop}
      >
        {drag && <DragHandle />}
        <TaskMarker row={row} />
        <TaskBody row={row} />
      </div>
      {row.subtask.active && (
        <SubtaskDraftRow
          draft={row.subtask}
          className="daily-log__subtask-add-row daily-log__subtask-add-row--inline"
        />
      )}
      <BlockDialog row={row} />
      <RecurrenceDialog row={row} />
    </>
  )
}
