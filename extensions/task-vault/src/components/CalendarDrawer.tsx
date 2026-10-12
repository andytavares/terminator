import React, { useState, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { useVaultStore } from '../stores/vault.store'
import { dayLoadLabel, isOverdue, shortDay, weekOf } from '../state/calendar-load'
import type { KanbanLane, Task } from '../vault/types'
import { IconButton } from '@terminator/extension-ui'

type DayData = { date: string; status: string; count: number }

type DayMap = Map<string, DayData[]>

type SelectedDay = ReturnType<typeof useSelectedDay>

interface CellProps {
  dateStr: string
  rows: DayData[]
  todayStr: string
  selected: boolean
  lanes: KanbanLane[]
  onPick: (dateStr: string) => void
}

interface GridProps {
  year: number
  month: number
  dayMap: DayMap
  todayStr: string
  day: SelectedDay
  lanes: KanbanLane[]
}

export const STATUS_DOT_CLASS: Record<string, string> = {
  open: 'cal-dot--open',
  'in-progress': 'cal-dot--progress',
  'in-review': 'cal-dot--review',
  blocked: 'cal-dot--blocked',
  done: 'cal-dot--done',
  migrated: 'cal-dot--migrated',
  cancelled: 'cal-dot--cancelled',
}

const DOT_ORDER = ['open', 'in-progress', 'in-review', 'blocked', 'done', 'migrated', 'cancelled']

export function statusDotStyle(
  status: string,
  lanes: KanbanLane[]
): { className: string; style?: React.CSSProperties } {
  const lane = lanes.find((l) => l.dotColor && l.taskStatuses.includes(status as never))
  if (lane?.dotColor) return { className: 'cal-dot', style: { background: lane.dotColor } }
  return { className: `cal-dot ${STATUS_DOT_CLASS[status] ?? 'cal-dot--open'}` }
}
const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const pad = (n: number) => String(n).padStart(2, '0')

function getTodayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A daily log's tasks, or null when the channel answered without any. */
async function fetchDayTasks(date: string): Promise<Task[] | null> {
  try {
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-daily', {
      date,
    })
    if (result && typeof result === 'object' && 'tasks' in result) {
      return (result as { tasks: Task[] }).tasks
    }
  } catch {
    // non-critical
  }
  return null
}

/** The month's day rows, grouped by date; null when the month could not be read. */
async function fetchMonth(year: number, month: number): Promise<DayMap | null> {
  try {
    const result = await window.electronAPI.extensionBridge.invoke(
      'task-vault:vault:get-calendar-month',
      { year, month }
    )
    if (!result || typeof result !== 'object' || !('days' in result)) return null
    const map: DayMap = new Map()
    for (const row of (result as { days: DayData[] }).days) {
      map.set(row.date, [...(map.get(row.date) ?? []), row])
    }
    return map
  } catch {
    return null
  }
}

function openTaskVaultAtDate(date: string, taskId?: string): void {
  window.electronAPI.extensionBridge
    .invoke('task-vault:open-panel', { date, taskId })
    .catch(() => {})
}

/** The shown month and its day rows, reloaded on navigation and refresh. */
function useMonth(refreshKey: number) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [dayMap, setDayMap] = useState<DayMap>(new Map())

  const loadMonth = () =>
    fetchMonth(year, month).then((map) => {
      if (map) setDayMap(map)
    })
  useEffect(() => {
    void loadMonth()
  }, [year, month, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const step = (delta: 1 | -1) => {
    const next = month + delta
    if (next < 1 || next > 12) setYear((y) => y + delta)
    setMonth(((next + 11) % 12) + 1)
  }
  return { year, month, dayMap, loadMonth, prev: () => step(-1), next: () => step(1) }
}

/** The picked day and its tasks; picking a day also opens it in the vault. */
function useSelectedDay(todayStr: string) {
  const { loadDate, loadToday } = useVaultStore()
  const [selectedDate, setSelectedDate] = useState<string>(todayStr)
  const [pickedADay, setPickedADay] = useState(false)
  const [selectedDayTasks, setSelectedDayTasks] = useState<Task[]>([])
  const [loadingDay, setLoadingDay] = useState(true)

  async function pick(dateStr: string) {
    setPickedADay(true)
    setSelectedDate(dateStr)
    if (dateStr === todayStr) void loadToday()
    else void loadDate(dateStr)
    setLoadingDay(true)
    setSelectedDayTasks([])
    const tasks = await fetchDayTasks(dateStr)
    if (tasks) setSelectedDayTasks(tasks)
    setLoadingDay(false)
  }

  const refreshTasks = (date: string) =>
    fetchDayTasks(date).then((tasks) => {
      if (tasks) setSelectedDayTasks(tasks)
    })
  return { selectedDate, pickedADay, selectedDayTasks, loadingDay, pick, refreshTasks }
}

/**
 * Refreshes the month dots AND the selected day's tasks whenever any task changes.
 * This covers both the embedded drawer (same WebContentsView as TaskVaultView) and
 * the standalone calendar panel (separate WebContentsView with its own store).
 */
function useIndexRefresh(loadMonth: () => Promise<void>, day: SelectedDay) {
  const selectedDateRef = useRef(day.selectedDate)
  useEffect(() => {
    selectedDateRef.current = day.selectedDate
  }, [day.selectedDate])
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('task-vault:push:index-updated', () => {
      void loadMonth()
      void day.refreshTasks(selectedDateRef.current)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

/** The month's cells: blanks before the 1st and after the last day, in whole weeks. */
function monthCells(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: (string | null)[] = [
    ...Array<null>(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function cellClass(props: CellProps): string {
  const { dateStr, rows, todayStr, selected } = props
  return [
    'cal-drawer__cell',
    dateStr === todayStr ? 'cal-drawer__cell--today' : '',
    selected ? 'cal-drawer__cell--selected' : '',
    rows.length > 0 ? 'cal-drawer__cell--has-tasks' : '',
    isOverdue(dateStr, rows, todayStr) ? 'cal-drawer__cell--overdue' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function DayDots({ rows, lanes }: { rows: DayData[]; lanes: KanbanLane[] }) {
  const dots = DOT_ORDER.filter((s) => rows.some((r) => r.status === s))
  return (
    <span className="cal-drawer__dots">
      {dots.slice(0, 3).map((s) => {
        const { className, style } = statusDotStyle(s, lanes)
        return <span key={s} className={className} style={style} />
      })}
    </span>
  )
}

/** A day cell; its label says what the day is carrying, not just its date. */
function DayCell(props: CellProps): React.JSX.Element {
  const { dateStr, rows } = props
  const label = dayLoadLabel(dateStr, rows)
  return (
    <button
      className={cellClass(props)}
      onClick={() => props.onPick(dateStr)}
      title={label}
      aria-label={label}
    >
      <span className="cal-drawer__day-num">{parseInt(dateStr.slice(8))}</span>
      {rows.length > 0 && <DayDots rows={rows} lanes={props.lanes} />}
    </button>
  )
}

function GridCell(props: Omit<GridProps, 'year' | 'month'> & { dateStr: string }) {
  const { dateStr, day } = props
  return (
    <DayCell
      dateStr={dateStr}
      rows={props.dayMap.get(dateStr) ?? []}
      todayStr={props.todayStr}
      selected={dateStr === day.selectedDate}
      lanes={props.lanes}
      onPick={(d) => void day.pick(d)}
    />
  )
}

function MonthGrid(props: GridProps): React.JSX.Element {
  return (
    <div className="cal-drawer__grid">
      {WEEKDAY_LABELS.map((d) => (
        <div key={d} className="cal-drawer__weekday">
          {d}
        </div>
      ))}
      {monthCells(props.year, props.month).map((dateStr, i) =>
        dateStr ? (
          <GridCell key={dateStr} {...props} dateStr={dateStr} />
        ) : (
          <div key={`e-${i}`} className="cal-drawer__cell cal-drawer__cell--empty" />
        )
      )}
    </div>
  )
}

/**
 * Until a day is picked, the panel shows the week rather than today's tasks —
 * the same list the main column is already showing.
 */
function WeekSummary({ dayMap, todayStr }: { dayMap: DayMap; todayStr: string }) {
  return (
    <div className="cal-drawer__week">
      <span className="cal-drawer__week-title">This week</span>
      <ul className="cal-drawer__week-list">
        {weekOf(todayStr).map((d) => {
          const open = (dayMap.get(d) ?? []).filter((r) => r.status === 'open').length
          return (
            <li key={d} className="cal-drawer__week-row">
              <span className="cal-drawer__week-day">{shortDay(d)}</span>
              <span className="cal-drawer__week-count">{open || '—'}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function DayTaskList({ day }: { day: SelectedDay }): React.JSX.Element {
  if (day.loadingDay) return <div className="cal-drawer__day-loading">…</div>
  if (day.selectedDayTasks.length === 0)
    return <div className="cal-drawer__day-empty">No tasks</div>
  return (
    <>
      {day.selectedDayTasks.map((task) => (
        <button
          key={task.id}
          className={`cal-drawer__day-task cal-drawer__day-task--${task.status}`}
          onClick={() => openTaskVaultAtDate(day.selectedDate, task.id)}
          title={task.text}
        >
          <span className="cal-drawer__day-task-dot" />
          <span className="cal-drawer__day-task-text">{task.text}</span>
          {task.dueDate && <span className="cal-drawer__day-task-due">{task.dueDate}</span>}
        </button>
      ))}
    </>
  )
}

function DayPanel(props: { day: SelectedDay; dayMap: DayMap; todayStr: string }) {
  const { day, todayStr } = props
  return (
    <div className="cal-drawer__day-panel">
      {!day.pickedADay && <WeekSummary dayMap={props.dayMap} todayStr={todayStr} />}
      <div className="cal-drawer__day-header" hidden={!day.pickedADay}>
        <span className="cal-drawer__day-title">
          {day.selectedDate === todayStr ? 'Today' : day.selectedDate}
        </span>
        <IconButton
          icon={ExternalLink}
          label="Open in Task Vault"
          size="sm"
          onClick={() => openTaskVaultAtDate(day.selectedDate)}
        />
      </div>
      <DayTaskList day={day} />
    </div>
  )
}

export function CalendarDrawer(): React.JSX.Element {
  const { calendarRefreshKey, kanbanLanes } = useVaultStore()
  const todayStr = getTodayStr()
  const m = useMonth(calendarRefreshKey)
  const day = useSelectedDay(todayStr)
  useEffect(() => {
    void day.pick(todayStr)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useIndexRefresh(m.loadMonth, day)
  return (
    <div className="cal-drawer cal-drawer--open">
      <div className="cal-drawer__panel">
        <div className="cal-drawer__month-nav">
          <IconButton icon={ChevronLeft} label="Previous month" size="sm" onClick={m.prev} />
          <span className="cal-drawer__month-label">
            {MONTH_NAMES[m.month - 1]} {m.year}
          </span>
          <IconButton icon={ChevronRight} label="Next month" size="sm" onClick={m.next} />
        </div>
        <MonthGrid
          {...{ year: m.year, month: m.month, dayMap: m.dayMap, todayStr, day }}
          lanes={kanbanLanes}
        />
        <DayPanel day={day} dayMap={m.dayMap} todayStr={todayStr} />
      </div>
    </div>
  )
}
