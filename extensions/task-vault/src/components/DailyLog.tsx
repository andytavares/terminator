import React, { useState, useEffect, useRef } from 'react'
import { DateTimePicker } from './DateTimePicker'
import {
  Trash2,
  Pencil,
  X,
  Archive,
  ArrowRight,
  ListPlus,
  Zap,
  Circle,
  CheckCircle2,
  MinusCircle,
  ArrowRightCircle,
  ChevronDown,
  ChevronRight,
  OctagonAlert,
  GripVertical,
  CornerUpLeft,
  Repeat,
  CalendarCheck,
  Sunset,
} from 'lucide-react'
import type { DailyLog as DailyLogData, IndexedTask } from '../vault/types'
import { SmartTaskInput } from './SmartTaskInput'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { notify } from '../utils/notify'
import { useVaultNavStore } from '../stores/vault-nav.store'

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
  onPickUpToday?: (taskId: string) => Promise<void>
  onDeleteBacklogTask?: (taskId: string) => Promise<void>
  onRefreshBacklog?: () => Promise<void>
}

function StatusIcon({
  status,
  size = 15,
}: {
  status: IndexedTask['status']
  size?: number
}): React.JSX.Element {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={size} className="task-status task-status--done" />
    case 'cancelled':
      return <MinusCircle size={size} className="task-status task-status--cancelled" />
    case 'migrated':
      return <ArrowRightCircle size={size} className="task-status task-status--migrated" />
    case 'in-progress':
      return <Circle size={size} className="task-status task-status--in-progress" />
    case 'blocked':
      return <OctagonAlert size={size} className="task-status task-status--blocked" />
    default:
      return <Circle size={size} className="task-status task-status--open" />
  }
}

function formatDate(iso: string): { weekday: string; detail: string } {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return {
    weekday: dt.toLocaleDateString('en-US', { weekday: 'long' }),
    detail: dt.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
  }
}

function SessionPicker({
  onSelect,
  onClose,
}: {
  onSelect: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const sessions = useSessionStore((s) => Array.from(s.sessions.values()))
  const activeSessions = sessions.filter((s) => s.status !== 'closed')
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const projectsByWs = useWorkspaceStore((s) => s.projectsByWorkspaceId)

  function sessionLabel(s: { id: string; tabTitle?: string; projectId: string }): string {
    let project: { name: string; workspaceId: string } | undefined
    for (const [, projects] of projectsByWs) {
      project = projects.find((p) => p.id === s.projectId)
      if (project) break
    }
    const workspace = project ? workspaces.find((w) => w.id === project!.workspaceId) : undefined
    const parts: string[] = []
    if (workspace) parts.push(workspace.name)
    if (project) parts.push(project.name)
    if (s.tabTitle) parts.push(s.tabTitle)
    return parts.length ? parts.join(' › ') : s.id.slice(0, 8)
  }

  if (activeSessions.length === 0) {
    return (
      <span className="daily-log__link-picker">
        <span className="tv-text-muted-sm">No active terminal sessions.</span>
        <button className="tv-btn tv-btn--icon" onClick={onClose}>
          <X size={14} />
        </button>
      </span>
    )
  }

  return (
    <span className="daily-log__link-picker">
      <select
        onChange={(e) => {
          if (e.target.value) onSelect(e.target.value)
        }}
        defaultValue=""
      >
        <option value="" disabled>
          Select a terminal session…
        </option>
        {activeSessions.map((s) => (
          <option key={s.id} value={s.id}>
            {sessionLabel(s)}
          </option>
        ))}
      </select>
      <button className="tv-btn tv-btn--icon" onClick={onClose}>
        <X size={14} />
      </button>
    </span>
  )
}

function makeTaskNavHandler(taskId: string): () => void {
  return () => {
    useExtensionRegistry.getState().setActiveGlobalTab('task-vault')
    useVaultNavStore.getState().navigateToTask(taskId)
  }
}

function SubtaskRow({
  subtask,
  onRefresh,
}: {
  subtask: IndexedTask
  onRefresh: () => Promise<void>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(subtask.text)

  async function saveEdit() {
    if (!editText.trim()) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:edit-task', {
      taskId: subtask.id,
      text: editText.trim(),
    })
    setEditing(false)
    await onRefresh()
  }

  async function handleComplete() {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:complete-task', {
      taskId: subtask.id,
    })
    notify('success', `Completed: ${subtask.text}`, { onClick: makeTaskNavHandler(subtask.id) })
    await onRefresh()
  }

  async function handleDelete() {
    if (!confirm(`Delete subtask: "${subtask.text}"?`)) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:delete-task', {
      taskId: subtask.id,
    })
    await onRefresh()
  }

  const isOpen = subtask.status === 'open'

  return (
    <div
      className={`daily-log__subtask${subtask.status === 'done' ? ' daily-log__subtask--done' : ''}`}
    >
      {isOpen ? (
        <button
          className="daily-log__task-checkbox"
          onClick={() => void handleComplete()}
          title="Complete subtask"
        >
          <StatusIcon status={subtask.status} />
        </button>
      ) : (
        <span className="daily-log__task-marker">
          <StatusIcon status={subtask.status} />
        </span>
      )}

      {editing ? (
        <span className="daily-log__subtask-edit">
          <SmartTaskInput
            value={editText}
            onChange={setEditText}
            onSubmit={() => void saveEdit()}
            onCancel={() => setEditing(false)}
            autoFocus
          />
          <button className="tv-btn tv-btn--primary" onClick={() => void saveEdit()}>
            Save
          </button>
          <button className="tv-btn tv-btn--icon" onClick={() => setEditing(false)}>
            <X size={14} />
          </button>
        </span>
      ) : (
        <span
          className={`daily-log__subtask-text${subtask.status === 'done' || subtask.status === 'migrated' ? ' daily-log__task-text--strikethrough' : ''}`}
          onDoubleClick={isOpen ? () => setEditing(true) : undefined}
        >
          {subtask.text}
        </span>
      )}

      {isOpen && !editing && (
        <span className="daily-log__subtask-actions">
          <button className="tv-btn tv-btn--outline" onClick={() => setEditing(true)} title="Edit">
            <Pencil size={13} />
          </button>
          <button
            className="tv-btn tv-btn--outline"
            onClick={() => void handleDelete()}
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </span>
      )}

      {!isOpen && !editing && (
        <span className="daily-log__subtask-actions">
          <button
            className="tv-btn tv-btn--outline"
            onClick={() => void handleDelete()}
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </span>
      )}
    </div>
  )
}

function GhostAddSubtaskRow({
  taskId,
  onRefresh,
}: {
  taskId: string
  onRefresh: () => Promise<void>
}): React.JSX.Element {
  const [active, setActive] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!text.trim()) return
    setSaving(true)
    try {
      await window.electronAPI.extensionBridge.invoke('task-vault:vault:add-subtask', {
        taskId,
        text: text.trim(),
      })
      setText('')
      setActive(false)
      await onRefresh()
    } finally {
      setSaving(false)
    }
  }

  if (!active) {
    return (
      <button className="daily-log__ghost-subtask" onClick={() => setActive(true)}>
        · + Add subtask…
      </button>
    )
  }

  return (
    <div className="daily-log__subtask-add-row">
      <SmartTaskInput
        value={text}
        onChange={setText}
        onSubmit={() => void handleAdd()}
        onCancel={() => {
          setText('')
          setActive(false)
        }}
        placeholder="Subtask…"
        disabled={saving}
        autoFocus
      />
      <button
        className="tv-btn tv-btn--outline tv-btn--xs"
        onClick={() => void handleAdd()}
        disabled={saving || !text.trim()}
      >
        Add
      </button>
      <button
        className="tv-btn tv-btn--icon"
        onClick={() => {
          setText('')
          setActive(false)
        }}
      >
        <X size={13} />
      </button>
    </div>
  )
}

const QUICK_INTERVALS: { value: string; label: string }[] = [
  { value: '30-min', label: '30 min' },
  { value: '1-hour', label: '1 hr' },
  { value: '2-hour', label: '2 hrs' },
  { value: '4-hour', label: '4 hrs' },
  { value: '1-day', label: '1 day' },
  { value: '2-day', label: '2 days' },
  { value: '1-week', label: '1 week' },
  { value: '2-weeks', label: '2 weeks' },
  { value: '1-month', label: '1 month' },
]

const INTERVAL_LABELS: Record<string, string> = Object.fromEntries(
  QUICK_INTERVALS.map(({ value, label }) => [value, label])
)

function formatCheckInterval(value: string): string {
  if (INTERVAL_LABELS[value]) return INTERVAL_LABELS[value]
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

function localDateMin(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function defaultCustomDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function IntervalPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  const isCustom = !INTERVAL_LABELS[value]
  const [customDate, setCustomDate] = useState(defaultCustomDate)
  const [customTime, setCustomTime] = useState('09:00')

  function selectQuick(v: string) {
    onChange(v)
  }

  function selectCustom() {
    onChange(`${customDate}T${customTime}`)
  }

  function handleDateChange(d: string) {
    setCustomDate(d)
    onChange(`${d}T${customTime}`)
  }

  function handleTimeChange(t: string) {
    setCustomTime(t)
    onChange(`${customDate}T${t}`)
  }

  return (
    <div className="interval-picker">
      <div className="interval-picker__grid">
        {QUICK_INTERVALS.map(({ value: v, label }) => (
          <button
            key={v}
            type="button"
            className={`interval-picker__btn${!isCustom && value === v ? ' interval-picker__btn--active' : ''}`}
            onClick={() => selectQuick(v)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={`interval-picker__btn interval-picker__btn--custom${isCustom ? ' interval-picker__btn--active' : ''}`}
          onClick={selectCustom}
        >
          Custom…
        </button>
      </div>
      {isCustom && (
        <div className="interval-picker__custom-row">
          <DateTimePicker
            mode="date"
            value={customDate}
            min={localDateMin()}
            onChange={handleDateChange}
          />
          <DateTimePicker mode="time" value={customTime} onChange={handleTimeChange} />
        </div>
      )}
    </div>
  )
}

function BlockModal({
  onConfirm,
  onClose,
}: {
  onConfirm: (reason: string, checkInterval: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [reason, setReason] = useState('')
  const [checkInterval, setCheckInterval] = useState('1-day')

  const isCustom = !INTERVAL_LABELS[checkInterval]

  function handleSubmit() {
    if (!reason.trim()) return
    if (!checkInterval) return
    onConfirm(reason.trim(), checkInterval)
  }

  return (
    <div className="daily-log__block-modal-backdrop" onClick={onClose}>
      <div className="daily-log__block-modal" onClick={(e) => e.stopPropagation()}>
        <div className="daily-log__block-modal-header">
          <OctagonAlert size={15} className="task-status task-status--blocked" />
          <span>Mark as Blocked</span>
          <button className="tv-btn tv-btn--icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <label className="daily-log__block-modal-label">
          Why is this blocked?
          <textarea
            className="daily-log__block-modal-textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Waiting on design review, blocked by dependency…"
            rows={3}
            autoFocus
          />
        </label>
        <div className="daily-log__block-modal-label">
          Check back in
          <IntervalPicker value={checkInterval} onChange={setCheckInterval} />
        </div>
        <div className="daily-log__block-modal-actions">
          <button className="tv-btn tv-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="tv-btn tv-btn--warning"
            onClick={handleSubmit}
            disabled={!reason.trim() || (isCustom && !checkInterval)}
          >
            Mark Blocked
          </button>
        </div>
      </div>
    </div>
  )
}

const WEEKDAY_LABELS: { value: number; short: string }[] = [
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
  { value: 0, short: 'Sun' },
]

const RECURRENCE_INTERVALS: { value: string; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
]

function format12h(hhmm: string): string {
  const [hStr = '0', mStr = '00'] = hhmm.split(':')
  const h = parseInt(hStr, 10)
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${mStr} ${ampm}`
}

/** Format a recurrence_rule column value (e.g. 'weekly:1,3') for display. */
function formatRecurrenceRule(rule: string): string {
  if (rule.startsWith('weekly:')) {
    const dayNums = rule
      .slice('weekly:'.length)
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n))
    const weeklyLabel = RECURRENCE_INTERVALS.find((r) => r.value === 'weekly')?.label ?? 'Weekly'
    const dayLabels = dayNums
      .slice()
      .sort((a, b) => {
        const order = [1, 2, 3, 4, 5, 6, 0]
        return order.indexOf(a) - order.indexOf(b)
      })
      .map((d) => WEEKDAY_LABELS.find((w) => w.value === d)?.short ?? d)
      .join(', ')
    return dayLabels ? `${weeklyLabel} · ${dayLabels}` : weeklyLabel
  }
  return RECURRENCE_INTERVALS.find((r) => r.value === rule)?.label ?? rule
}

type EndType = 'none' | 'on_date' | 'after_count'

function RecurrenceModal({
  existing,
  onConfirm,
  onClear,
  onClose,
}: {
  existing?: {
    interval: string
    days?: number[]
    time?: string
    endType?: EndType
    endDate?: string
    endCount?: number
  }
  onConfirm: (
    interval: string,
    days: number[],
    time: string,
    endType: EndType,
    endDate: string,
    endCount: number
  ) => void
  onClear: () => void
  onClose: () => void
}): React.JSX.Element {
  const [interval, setInterval] = useState(existing?.interval ?? 'weekly')
  const [days, setDays] = useState<number[]>(existing?.days ?? [1, 3, 5])
  const [time, setTime] = useState(existing?.time ?? '09:00')
  const [endType, setEndType] = useState<EndType>(existing?.endType ?? 'none')
  const [endDate, setEndDate] = useState(existing?.endDate ?? '')
  const [endCount, setEndCount] = useState(existing?.endCount ?? 10)

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
  }

  function handleSubmit() {
    onConfirm(interval, interval === 'weekly' ? days : [], time, endType, endDate, endCount)
  }

  const canSubmit =
    (interval !== 'weekly' || days.length > 0) && (endType !== 'on_date' || endDate.length > 0)

  return (
    <div className="daily-log__block-modal-backdrop" onClick={onClose}>
      <div className="daily-log__block-modal" onClick={(e) => e.stopPropagation()}>
        <div className="daily-log__block-modal-header">
          <Repeat size={15} />
          <span>{existing ? 'Edit Recurrence' : 'Set Recurrence'}</span>
          <button className="tv-btn tv-btn--icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="daily-log__block-modal-label">
          Repeats
          <div className="recurrence-modal__interval-row">
            {RECURRENCE_INTERVALS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`interval-picker__btn${interval === value ? ' interval-picker__btn--active' : ''}`}
                onClick={() => setInterval(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {interval === 'weekly' && (
          <div className="daily-log__block-modal-label">
            On days
            <div className="recurrence-modal__days-row">
              {WEEKDAY_LABELS.map(({ value, short }) => (
                <button
                  key={value}
                  type="button"
                  className={`recurrence-modal__day-btn${days.includes(value) ? ' recurrence-modal__day-btn--active' : ''}`}
                  onClick={() => toggleDay(value)}
                >
                  {short}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="daily-log__block-modal-label">
          Notify at
          <DateTimePicker mode="time" value={time} onChange={setTime} />
        </div>

        <div className="daily-log__block-modal-label">
          Ends
          <div className="recurrence-modal__end-row">
            {(['none', 'on_date', 'after_count'] as EndType[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`interval-picker__btn${endType === t ? ' interval-picker__btn--active' : ''}`}
                onClick={() => setEndType(t)}
              >
                {t === 'none' ? 'Never' : t === 'on_date' ? 'On date' : 'After'}
              </button>
            ))}
          </div>
          {endType === 'on_date' && (
            <DateTimePicker mode="date" value={endDate} onChange={setEndDate} />
          )}
          {endType === 'after_count' && (
            <div className="recurrence-modal__count-row">
              <input
                type="number"
                className="recurrence-modal__count-input"
                min={1}
                max={999}
                value={endCount}
                onChange={(e) => setEndCount(Math.max(1, parseInt(e.target.value) || 1))}
              />
              <span className="recurrence-modal__count-label">completions</span>
            </div>
          )}
        </div>

        <div className="daily-log__block-modal-actions">
          {existing && (
            <button
              className="tv-btn tv-btn--ghost tv-btn--danger-text"
              onClick={onClear}
              style={{ marginRight: 'auto' }}
            >
              Remove
            </button>
          )}
          <button className="tv-btn tv-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="tv-btn tv-btn--primary" onClick={handleSubmit} disabled={!canSubmit}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function TaskRow({
  task,
  isSelected,
  onSelect,
  onComplete,
  onMigrate,
  onRefresh,
  draggable: isDraggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDragOver,
  hasSubtasks,
}: {
  task: IndexedTask
  isSelected?: boolean
  onSelect?: () => void
  onComplete: (id: string) => Promise<void>
  onMigrate: (id: string, date: string) => Promise<void>
  onRefresh: () => Promise<void>
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  isDragOver?: boolean
  hasSubtasks?: boolean
}): React.JSX.Element {
  const [migratingOpen, setMigratingOpen] = useState(false)
  const [migrateDate, setMigrateDate] = useState('')
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [linking, setLinking] = useState(false)
  const [linked, setLinked] = useState(task.terminatorLinks.length > 0)
  const [blockModalOpen, setBlockModalOpen] = useState(false)
  const [recurrenceModalOpen, setRecurrenceModalOpen] = useState(false)
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [subtaskText, setSubtaskText] = useState('')
  const [savingSubtask, setSavingSubtask] = useState(false)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLinked(task.terminatorLinks.length > 0)
  }, [task.terminatorLinks])

  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current)
    }
  }, [])

  function rawText(): string {
    const parts = [task.text]
    if (task.project) parts.push(`@${task.project.replace(/ /g, '-')}`)
    if (task.context) parts.push(`+${task.context.replace(/ /g, '-')}`)
    if (task.area) parts.push(`#${task.area.replace(/ /g, '-')}`)
    if (task.dueDate) parts.push(`due:${task.dueDate}`)
    return parts.join(' ')
  }

  function startEdit() {
    setEditText(rawText())
    setEditing(true)
  }

  async function saveEdit() {
    if (!editText.trim()) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:edit-task', {
      taskId: task.id,
      text: editText.trim(),
    })
    setEditing(false)
    await onRefresh()
  }

  async function handleCancel() {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:cancel-task', {
      taskId: task.id,
    })
    notify('info', `Archived: ${task.text}`, { onClick: makeTaskNavHandler(task.id) })
    await onRefresh()
  }

  async function handleMigrate() {
    if (!migrateDate) return
    await onMigrate(task.id, migrateDate)
    setMigratingOpen(false)
    setMigrateDate('')
  }

  async function handleLinkSession(sessionId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:links:create', {
      taskId: task.id,
      targetId: sessionId,
    })
    setLinked(true)
    setLinking(false)
  }

  async function handleRestore() {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:reopen-task', {
      taskId: task.id,
    })
    notify('info', `Reopened: ${task.text}`, { onClick: makeTaskNavHandler(task.id) })
    await onRefresh()
  }

  async function handleBlock(reason: string, checkInterval: string) {
    setBlockModalOpen(false)
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:block-task', {
      taskId: task.id,
      reason,
      checkInterval,
    })
    notify('warning', `Blocked: ${task.text}`, { onClick: makeTaskNavHandler(task.id) })
    await onRefresh()
  }

  async function handleUnblock() {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:unblock-task', {
      taskId: task.id,
    })
    notify('success', `Unblocked: ${task.text}`, { onClick: makeTaskNavHandler(task.id) })
    await onRefresh()
  }

  async function handleSetRecurrence(
    interval: string,
    days: number[],
    time: string,
    endType: 'none' | 'on_date' | 'after_count',
    endDate: string,
    endCount: number
  ) {
    setRecurrenceModalOpen(false)
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:set-recurrence', {
      taskId: task.id,
      interval,
      days: days.length > 0 ? days : undefined,
      time: time || undefined,
      endType,
      endDate: endType === 'on_date' ? endDate : undefined,
      endCount: endType === 'after_count' ? endCount : undefined,
    })
    notify(
      'success',
      `Recurrence set: ${formatRecurrenceRule(days && days.length > 0 ? `weekly:${days.sort((a, b) => a - b).join(',')}` : interval)}`,
      { onClick: makeTaskNavHandler(task.id) }
    )
    await onRefresh()
  }

  async function handleSendToBacklog() {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:process-inbox-item', {
      taskId: task.id,
      action: 'someday',
    })
    notify('info', `Moved to backlog: ${task.text}`)
    await onRefresh()
  }

  async function handleClearRecurrence() {
    setRecurrenceModalOpen(false)
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:clear-recurrence', {
      taskId: task.id,
    })
    notify('info', `Recurrence removed: ${task.text}`)
    await onRefresh()
  }

  async function handleDelete() {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:delete-task', {
      taskId: task.id,
    })
    await onRefresh()
  }

  async function handleAddFirstSubtask() {
    if (!subtaskText.trim()) return
    setSavingSubtask(true)
    try {
      await window.electronAPI.extensionBridge.invoke('task-vault:vault:add-subtask', {
        taskId: task.id,
        text: subtaskText.trim(),
      })
      setSubtaskText('')
      setAddingSubtask(false)
      await onRefresh()
    } finally {
      setSavingSubtask(false)
    }
  }

  const isOpen = task.status === 'open' || task.status === 'in-progress'
  const isDone = task.status === 'done'
  const isBlocked = task.status === 'blocked'

  return (
    <>
      <div
        className={`daily-log__task${isDone ? ' daily-log__task--done' : task.status === 'cancelled' ? ' daily-log__task--cancelled' : isBlocked ? ' daily-log__task--blocked' : ''}${isSelected ? ' daily-log__task--selected' : ''}${isDragOver ? ' daily-log__task--drag-over' : ''}`}
        draggable={isDraggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {isDraggable && (
          <span className="daily-log__drag-handle" title="Drag to reorder">
            <GripVertical size={14} />
          </span>
        )}
        {isOpen ? (
          <button
            className="daily-log__task-checkbox"
            onClick={() => void onComplete(task.id)}
            title="Complete task"
          >
            <StatusIcon status={task.status} />
          </button>
        ) : (
          <span className="daily-log__task-marker">
            <StatusIcon status={task.status} />
          </span>
        )}

        <div className="daily-log__task-body">
          {editing ? (
            <span className="daily-log__task-edit">
              <SmartTaskInput
                value={editText}
                onChange={setEditText}
                onSubmit={saveEdit}
                onCancel={() => setEditing(false)}
                autoFocus
              />
              <button className="tv-btn tv-btn--primary" onClick={() => void saveEdit()}>
                Save
              </button>
              <button className="tv-btn tv-btn--icon" onClick={() => setEditing(false)}>
                <X size={14} />
              </button>
            </span>
          ) : (
            <>
              <div className="daily-log__task-line1">
                <span
                  className={`daily-log__task-text${isDone || task.status === 'migrated' ? ' daily-log__task-text--strikethrough' : task.status === 'cancelled' ? ' daily-log__task-text--cancelled' : ''}`}
                  onClick={() => {
                    if (!(isOpen || isBlocked)) {
                      onSelect?.()
                      return
                    }
                    if (clickTimer.current) {
                      clearTimeout(clickTimer.current)
                      clickTimer.current = null
                      startEdit()
                    } else {
                      clickTimer.current = setTimeout(() => {
                        clickTimer.current = null
                        onSelect?.()
                      }, 220)
                    }
                  }}
                  title={
                    isOpen || isBlocked
                      ? 'Click to open detail · Double-click to edit'
                      : 'Click to open detail'
                  }
                  style={{ cursor: onSelect ? 'pointer' : undefined }}
                >
                  {task.text}
                </span>

                {isOpen && (
                  <span className="daily-log__task-actions">
                    <button
                      className="tv-btn tv-btn--outline tv-btn--action-icon"
                      onClick={() => setMigratingOpen(true)}
                      title="Migrate to another day"
                    >
                      <ArrowRight size={13} />
                    </button>
                    <button
                      className="tv-btn tv-btn--outline tv-btn--action-icon"
                      onClick={() => void handleSendToBacklog()}
                      title="Send to backlog"
                    >
                      <Sunset size={13} />
                    </button>
                    {linked || task.terminatorLinks.length > 0 ? (
                      <button
                        className="tv-btn tv-btn--outline tv-btn--action-icon"
                        title="Jump to linked terminal"
                        onClick={() => {
                          useExtensionRegistry.getState().setActiveGlobalTab(null)
                        }}
                      >
                        <Zap size={13} />
                      </button>
                    ) : (
                      <button
                        className="tv-btn tv-btn--outline tv-btn--action-icon"
                        onClick={() => setLinking(true)}
                        title="Link to terminal session"
                      >
                        <Zap size={13} />
                      </button>
                    )}
                    {!hasSubtasks && (
                      <button
                        className="tv-btn tv-btn--outline tv-btn--action-icon"
                        onClick={() => setAddingSubtask(true)}
                        title="Add subtask"
                      >
                        <ListPlus size={13} />
                      </button>
                    )}
                    <button
                      className={`tv-btn tv-btn--outline tv-btn--action-icon${task.recurrenceRule ? ' tv-btn--accent-active' : ''}`}
                      onClick={() => setRecurrenceModalOpen(true)}
                      title={
                        task.recurrenceRule
                          ? `Recurrence: ${formatRecurrenceRule(task.recurrenceRule)}`
                          : 'Set recurrence'
                      }
                    >
                      <Repeat size={13} />
                    </button>
                    <button
                      className="tv-btn tv-btn--outline tv-btn--action-icon tv-btn--warning-hover"
                      onClick={() => setBlockModalOpen(true)}
                      title="Mark as blocked"
                    >
                      <OctagonAlert size={13} />
                    </button>
                    <button
                      className="tv-btn tv-btn--outline tv-btn--action-icon tv-btn--danger-hover"
                      onClick={() => void handleCancel()}
                      title="Archive task"
                    >
                      <Archive size={13} />
                    </button>
                  </span>
                )}

                {isBlocked && (
                  <span className="daily-log__task-actions">
                    {!hasSubtasks && (
                      <button
                        className="tv-btn tv-btn--outline tv-btn--action-icon"
                        onClick={() => setAddingSubtask(true)}
                        title="Add subtask"
                      >
                        <ListPlus size={13} />
                      </button>
                    )}
                    <button
                      className="tv-btn tv-btn--outline tv-btn--action-icon tv-btn--success-hover"
                      onClick={() => void handleUnblock()}
                      title="Unblock task"
                    >
                      Unblock
                    </button>
                    <button
                      className="tv-btn tv-btn--outline tv-btn--action-icon tv-btn--danger-hover"
                      onClick={() => void handleCancel()}
                      title="Archive task"
                    >
                      <Archive size={13} />
                    </button>
                  </span>
                )}

                {!isOpen && !isBlocked && (
                  <span className="daily-log__task-actions">
                    {(task.status === 'done' ||
                      task.status === 'migrated' ||
                      task.status === 'cancelled') && (
                      <button
                        className="tv-btn tv-btn--outline tv-btn--action-icon"
                        onClick={() => void handleRestore()}
                        title="Restore to open"
                      >
                        ↩
                      </button>
                    )}
                    {(task.status === 'migrated' || task.status === 'cancelled') && (
                      <button
                        className="tv-btn tv-btn--outline tv-btn--action-icon tv-btn--danger-hover"
                        onClick={() => void handleDelete()}
                        title="Remove"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </span>
                )}
              </div>

              {(task.project ||
                task.context ||
                task.area ||
                task.dueDate ||
                (isBlocked && task.blockedReason) ||
                task.recurrenceRule) && (
                <div className="daily-log__task-meta">
                  {task.project && (
                    <span className="daily-log__tag daily-log__tag--project">@{task.project}</span>
                  )}
                  {task.context && (
                    <span className="daily-log__tag daily-log__tag--context">+{task.context}</span>
                  )}
                  {task.area && (
                    <span className="daily-log__tag daily-log__tag--area">#{task.area}</span>
                  )}
                  {task.dueDate && (
                    <span className="daily-log__tag daily-log__tag--due">due:{task.dueDate}</span>
                  )}
                  {isBlocked && task.blockedReason && (
                    <span
                      className="daily-log__blocked-reason"
                      title={
                        task.blockedCheckInterval
                          ? `Check in: ${formatCheckInterval(task.blockedCheckInterval)}`
                          : undefined
                      }
                    >
                      ⊘ {task.blockedReason}
                    </span>
                  )}
                  {task.recurrenceRule && (
                    <span
                      className="daily-log__recurrence-badge"
                      title={`Repeats: ${formatRecurrenceRule(task.recurrenceRule)}${task.recurrenceNotifyAt ? ` at ${format12h(task.recurrenceNotifyAt)}` : ''}`}
                    >
                      <Repeat size={11} />
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          {migratingOpen && (
            <span className="daily-log__migrate-picker">
              <DateTimePicker mode="date" value={migrateDate} onChange={setMigrateDate} />
              <button
                className="tv-btn tv-btn--primary"
                onClick={() => void handleMigrate()}
                disabled={!migrateDate}
              >
                Move
              </button>
              <button className="tv-btn tv-btn--icon" onClick={() => setMigratingOpen(false)}>
                <X size={14} />
              </button>
            </span>
          )}

          {linking && (
            <SessionPicker
              onSelect={(sessionId) => {
                void handleLinkSession(sessionId)
              }}
              onClose={() => setLinking(false)}
            />
          )}
        </div>
      </div>
      {addingSubtask && (
        <div className="daily-log__subtask-add-row daily-log__subtask-add-row--inline">
          <SmartTaskInput
            value={subtaskText}
            onChange={setSubtaskText}
            onSubmit={() => void handleAddFirstSubtask()}
            onCancel={() => {
              setSubtaskText('')
              setAddingSubtask(false)
            }}
            placeholder="Subtask…"
            disabled={savingSubtask}
            autoFocus
          />
          <button
            className="tv-btn tv-btn--outline tv-btn--xs"
            onClick={() => void handleAddFirstSubtask()}
            disabled={savingSubtask || !subtaskText.trim()}
          >
            Add
          </button>
          <button
            className="tv-btn tv-btn--icon"
            onClick={() => {
              setSubtaskText('')
              setAddingSubtask(false)
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {blockModalOpen && (
        <BlockModal
          onConfirm={(reason, checkInterval) => void handleBlock(reason, checkInterval)}
          onClose={() => setBlockModalOpen(false)}
        />
      )}
      {recurrenceModalOpen && (
        <RecurrenceModal
          existing={
            task.recurrenceRule
              ? (() => {
                  const rule = task.recurrenceRule
                  let interval = rule
                  let days: number[] | undefined
                  if (rule.startsWith('weekly:')) {
                    interval = 'weekly'
                    days = rule
                      .slice('weekly:'.length)
                      .split(',')
                      .map((s) => parseInt(s, 10))
                      .filter((n) => !isNaN(n))
                  }
                  return {
                    interval,
                    days,
                    time: task.recurrenceNotifyAt,
                    endType: task.recurrenceEndType,
                    endDate: task.recurrenceEndDate,
                    endCount: task.recurrenceEndCount,
                  }
                })()
              : undefined
          }
          onConfirm={(interval, days, time, endType, endDate, endCount) =>
            void handleSetRecurrence(interval, days, time, endType, endDate, endCount)
          }
          onClear={() => void handleClearRecurrence()}
          onClose={() => setRecurrenceModalOpen(false)}
        />
      )}
    </>
  )
}

function AddTaskRow({ onAdd }: { onAdd: (text: string) => Promise<void> }): React.JSX.Element {
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState(false)

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

  if (!open) {
    return (
      <button className="daily-log__add-btn" onClick={() => setOpen(true)}>
        + Add task
      </button>
    )
  }

  return (
    <div className="daily-log__add-row">
      <SmartTaskInput
        value={text}
        onChange={setText}
        onSubmit={submit}
        onCancel={() => setOpen(false)}
        disabled={adding}
        autoFocus
      />
      <button
        className="daily-log__save-btn"
        onClick={() => void submit()}
        disabled={adding || !text.trim()}
      >
        Add
      </button>
      <button className="daily-log__cancel-edit-btn" onClick={() => setOpen(false)}>
        <X size={14} />
      </button>
    </div>
  )
}

function BacklogTaskRow({
  task,
  onPickUpToday,
  onDelete,
  onRefreshBacklog,
  onSelect,
}: {
  task: IndexedTask
  onPickUpToday?: (taskId: string) => Promise<void>
  onDelete?: (taskId: string) => Promise<void>
  onRefreshBacklog?: () => Promise<void>
  onSelect?: (taskId: string) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(task.text)

  function rawText(): string {
    const parts = [task.text]
    if (task.project) parts.push(`@${task.project.replace(/ /g, '-')}`)
    if (task.context) parts.push(`+${task.context.replace(/ /g, '-')}`)
    if (task.area) parts.push(`#${task.area.replace(/ /g, '-')}`)
    if (task.dueDate) parts.push(`due:${task.dueDate}`)
    return parts.join(' ')
  }

  async function saveEdit() {
    if (!editText.trim()) {
      setEditing(false)
      setEditText(task.text)
      return
    }
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:edit-task', {
      taskId: task.id,
      text: editText.trim(),
    })
    setEditing(false)
    await onRefreshBacklog?.()
  }

  return (
    <div className="daily-log__backlog-task">
      <span className="daily-log__backlog-spacer" />
      {editing ? (
        <span className="daily-log__task-edit">
          <SmartTaskInput
            value={editText}
            onChange={setEditText}
            onSubmit={saveEdit}
            onCancel={() => {
              setEditing(false)
            }}
            autoFocus
          />
          <button className="tv-btn tv-btn--primary" onClick={() => void saveEdit()}>
            Save
          </button>
          <button
            className="tv-btn tv-btn--icon"
            onClick={() => {
              setEditing(false)
            }}
          >
            <X size={14} />
          </button>
        </span>
      ) : (
        <span
          className="daily-log__backlog-task-text"
          onClick={onSelect ? () => onSelect(task.id) : undefined}
          onDoubleClick={() => {
            setEditText(rawText())
            setEditing(true)
          }}
          style={{ cursor: onSelect ? 'pointer' : undefined }}
          title="Click to open detail · Double-click to edit"
        >
          {task.text}
          {task.project && (
            <span className="daily-log__tag daily-log__tag--project">@{task.project}</span>
          )}
          {task.area && <span className="daily-log__tag daily-log__tag--area">#{task.area}</span>}
          {task.context && (
            <span className="daily-log__tag daily-log__tag--context">+{task.context}</span>
          )}
        </span>
      )}
      {!editing && (
        <span className="daily-log__backlog-actions">
          {onPickUpToday && (
            <button
              className="daily-log__backlog-btn"
              onClick={() => void onPickUpToday(task.id)}
              title="Pick up today"
            >
              <CalendarCheck size={13} />
            </button>
          )}
          {onDelete && (
            <button
              className="daily-log__backlog-btn"
              onClick={() => void onDelete(task.id)}
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          )}
        </span>
      )}
    </div>
  )
}

const TERMINAL_STATUSES = new Set<string>(['done', 'migrated', 'cancelled'])

export function DailyLog({
  log,
  rolledOverTaskIds = [],
  selectedContexts = [],
  selectedTaskId = null,
  onSelectTask,
  onTaskComplete,
  onTaskMigrate,
  onRefresh,
  onPrevDay,
  onNextDay,
  onGoToToday,
  isToday = false,
  somedayTasks = [],
  onPickUpToday,
  onDeleteBacklogTask,
  onRefreshBacklog,
}: DailyLogProps): React.JSX.Element {
  const [backlogExpanded, setBacklogExpanded] = useState(true)
  const [rolloverExpanded, setRolloverExpanded] = useState(true)
  const draggingId = useRef<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  async function handleAddTask(text: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:add-task', {
      filePath: log.filePath,
      text,
    })
    await onRefresh()
  }

  const matchesContext = (t: IndexedTask) =>
    selectedContexts.length === 0 || !t.context || selectedContexts.includes(t.context)

  const rolledOverSet = new Set(rolledOverTaskIds)
  const rawTodayTasks = log.tasks.filter((t) => !rolledOverSet.has(t.id) && matchesContext(t))
  const rolledOverTasks = log.tasks.filter((t) => rolledOverSet.has(t.id) && matchesContext(t))
  const hasRolledOver = rolledOverTasks.length > 0

  // Active tasks first (open, in-progress, in-review, blocked), terminal tasks at bottom
  const activeTodayTasks = rawTodayTasks.filter((t) => !TERMINAL_STATUSES.has(t.status))
  const terminalTodayTasks = rawTodayTasks.filter((t) => TERMINAL_STATUSES.has(t.status))

  const filteredAll = log.tasks.filter(matchesContext)
  const doneTasks = filteredAll.filter((t) => t.status === 'done').length
  const totalTasks = filteredAll.length
  const progressPct = totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0
  const allDone = totalTasks > 0 && doneTasks === totalTasks
  const { weekday, detail } = formatDate(log.date)

  function handleDragStart(taskId: string) {
    draggingId.current = taskId
  }

  function handleDragEnd() {
    draggingId.current = null
    setDragOverId(null)
  }

  function handleDragOver(e: React.DragEvent, taskId: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(taskId)
  }

  async function handleDrop(e: React.DragEvent, dropTargetId: string) {
    e.preventDefault()
    setDragOverId(null)
    const sourceId = draggingId.current
    draggingId.current = null
    if (!sourceId || sourceId === dropTargetId) return

    const sourceIdx = activeTodayTasks.findIndex((t) => t.id === sourceId)
    const targetIdx = activeTodayTasks.findIndex((t) => t.id === dropTargetId)
    if (sourceIdx === -1 || targetIdx === -1) return

    const reordered = [...activeTodayTasks]
    const [moved] = reordered.splice(sourceIdx, 1)
    reordered.splice(targetIdx, 0, moved)

    await window.electronAPI.extensionBridge.invoke('task-vault:vault:reorder-tasks', {
      orderedIds: reordered.map((t) => t.id),
    })
    await onRefresh()
  }

  function renderTaskWithSubtasks(
    task: IndexedTask,
    opts: { draggable?: boolean } = {}
  ): React.JSX.Element {
    const subtasks = task.subtasks ?? []
    const hasSubtasks = subtasks.length > 0
    const canAddSubtask = task.status === 'open' || task.status === 'blocked'
    return (
      <div key={task.id}>
        <TaskRow
          task={task}
          isSelected={selectedTaskId === task.id}
          onSelect={onSelectTask ? () => onSelectTask(task.id) : undefined}
          onComplete={onTaskComplete}
          onMigrate={onTaskMigrate}
          onRefresh={onRefresh}
          draggable={opts.draggable}
          onDragStart={
            opts.draggable
              ? (e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  handleDragStart(task.id)
                }
              : undefined
          }
          onDragEnd={opts.draggable ? handleDragEnd : undefined}
          onDragOver={opts.draggable ? (e) => handleDragOver(e, task.id) : undefined}
          onDrop={opts.draggable ? (e) => void handleDrop(e, task.id) : undefined}
          isDragOver={dragOverId === task.id}
          hasSubtasks={hasSubtasks}
        />
        {hasSubtasks && (
          <div className="daily-log__subtasks">
            {subtasks.map((st) => (
              <SubtaskRow key={st.id} subtask={st as IndexedTask} onRefresh={onRefresh} />
            ))}
            {canAddSubtask && <GhostAddSubtaskRow taskId={task.id} onRefresh={onRefresh} />}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="daily-log">
      <div className="daily-log__date">
        <button
          className="tv-btn tv-btn--icon daily-log__date-nav"
          onClick={onPrevDay}
          disabled={!onPrevDay}
          title="Previous day"
        >
          <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div className="daily-log__date-text">
          <span className="daily-log__date-weekday">
            {weekday}
            {isToday && <span className="daily-log__today-badge">Today</span>}
          </span>
          <span className="daily-log__date-detail">{detail}</span>
        </div>
        {!isToday && onGoToToday && (
          <button
            className="tv-btn tv-btn--xs tv-btn--secondary daily-log__back-to-today"
            onClick={onGoToToday}
            title="Back to today"
          >
            <CornerUpLeft size={12} />
            Today
          </button>
        )}
        <button
          className="tv-btn tv-btn--icon daily-log__date-nav"
          onClick={onNextDay}
          disabled={!onNextDay}
          title="Next day"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <section className="daily-log__tasks">
        <div className="daily-log__section-header">
          <h3>Tasks</h3>
          {totalTasks > 0 && (
            <span className="daily-log__task-count">
              {doneTasks}/{totalTasks}
            </span>
          )}
        </div>
        {totalTasks > 0 && (
          <div className="daily-log__progress-bar">
            <div
              className={`daily-log__progress-fill${allDone ? ' daily-log__progress-fill--complete' : ''}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
        {hasRolledOver && (
          <>
            <button
              className="daily-log__rollover-header"
              onClick={() => setRolloverExpanded((v) => !v)}
            >
              <span className="daily-log__rollover-header-label">
                ↩ From previous days ({rolledOverTasks.length})
              </span>
              {rolloverExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {rolloverExpanded && rolledOverTasks.map((task) => renderTaskWithSubtasks(task))}
            <div className="daily-log__rollover-divider" />
            <div className="daily-log__today-label">Today</div>
          </>
        )}
        {activeTodayTasks.map((task) => renderTaskWithSubtasks(task, { draggable: true }))}
        {terminalTodayTasks.length > 0 && activeTodayTasks.length > 0 && (
          <div className="daily-log__done-divider" />
        )}
        {terminalTodayTasks.map((task) => renderTaskWithSubtasks(task))}
        <AddTaskRow onAdd={handleAddTask} />
        <>
          <div className="daily-log__backlog-divider" />
          <button
            className="daily-log__backlog-header"
            onClick={() => setBacklogExpanded((v) => !v)}
          >
            <span className="daily-log__backlog-label">Backlog ({somedayTasks.length})</span>
            {backlogExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {backlogExpanded && (
            <div className="daily-log__backlog-list">
              {somedayTasks.length === 0 ? (
                <p className="daily-log__backlog-empty">No backlog items.</p>
              ) : (
                somedayTasks.map((task) => (
                  <BacklogTaskRow
                    key={task.id}
                    task={task}
                    onPickUpToday={onPickUpToday}
                    onDelete={onDeleteBacklogTask}
                    onRefreshBacklog={onRefreshBacklog}
                    onSelect={onSelectTask}
                  />
                ))
              )}
            </div>
          )}
        </>
      </section>

      {!log.exists && (
        <p className="daily-log__new-file">No log for today yet. Add a task to get started.</p>
      )}
    </div>
  )
}
