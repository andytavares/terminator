import React, { useState, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { useVaultStore } from '../stores/vault.store'
import type { KanbanLane, Task } from '../vault/types'

type DayData = { date: string; status: string; count: number }
type DayMap = Map<string, DayData[]>

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

export function CalendarDrawer(): React.JSX.Element {
  const { loadDate, loadToday, calendarRefreshKey, kanbanLanes } = useVaultStore()
  const todayStr = getTodayStr()
  const today = new Date()

  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [dayMap, setDayMap] = useState<DayMap>(new Map())
  const [selectedDate, setSelectedDate] = useState<string>(todayStr)
  const [selectedDayTasks, setSelectedDayTasks] = useState<Task[]>([])
  const [loadingDay, setLoadingDay] = useState(true)
  const selectedDateRef = useRef(selectedDate)

  useEffect(() => {
    selectedDateRef.current = selectedDate
  }, [selectedDate])

  useEffect(() => {
    void loadMonth()
  }, [year, month, calendarRefreshKey])

  useEffect(() => {
    void handleDayClick(todayStr)
  }, [])

  // Refresh month dots AND selected-day task list whenever any task changes.
  // This covers both the embedded drawer (same WebContentsView as TaskVaultView)
  // and the standalone calendar panel (separate WebContentsView with its own store).
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('task-vault:push:index-updated', () => {
      void loadMonth()
      const date = selectedDateRef.current
      void (async () => {
        try {
          const result = await window.electronAPI.extensionBridge.invoke(
            'task-vault:vault:get-daily',
            { date }
          )
          if (result && typeof result === 'object' && 'tasks' in result) {
            setSelectedDayTasks((result as { tasks: Task[] }).tasks)
          }
        } catch {
          // non-critical
        }
      })()
    })
  }, [])

  async function loadMonth() {
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'task-vault:vault:get-calendar-month',
        { year, month }
      )
      if (!result || typeof result !== 'object' || !('days' in result)) return
      const { days } = result as { days: DayData[] }
      const map = new Map<string, DayData[]>()
      for (const row of days) {
        const existing = map.get(row.date) ?? []
        existing.push(row)
        map.set(row.date, existing)
      }
      setDayMap(map)
    } catch {
      // non-critical
    }
  }

  function prevMonth() {
    if (month === 1) {
      setYear((y) => y - 1)
      setMonth(12)
    } else setMonth((m) => m - 1)
  }

  function nextMonth() {
    if (month === 12) {
      setYear((y) => y + 1)
      setMonth(1)
    } else setMonth((m) => m + 1)
  }

  async function handleDayClick(dateStr: string) {
    setSelectedDate(dateStr)
    if (dateStr === todayStr) void loadToday()
    else void loadDate(dateStr)
    setLoadingDay(true)
    setSelectedDayTasks([])
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-daily', {
        date: dateStr,
      })
      if (result && typeof result === 'object' && 'tasks' in result) {
        setSelectedDayTasks((result as { tasks: Task[] }).tasks)
      }
    } catch {
      // non-critical
    } finally {
      setLoadingDay(false)
    }
  }

  async function openTaskVaultAtDate(date: string, taskId?: string) {
    try {
      await window.electronAPI.extensionBridge.invoke('task-vault:open-panel', { date, taskId })
    } catch {
      // non-critical
    }
  }

  function handleGoToDay() {
    void openTaskVaultAtDate(selectedDate)
  }

  function handleTaskClick(task: Task, dateStr: string) {
    void openTaskVaultAtDate(dateStr, task.id)
  }

  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: (string | null)[] = [
    ...Array<null>(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="cal-drawer cal-drawer--open">
      <div className="cal-drawer__panel">
        <div className="cal-drawer__month-nav">
          <button className="tv-btn tv-btn--icon" onClick={prevMonth} title="Previous month">
            <ChevronLeft size={13} />
          </button>
          <span className="cal-drawer__month-label">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <button className="tv-btn tv-btn--icon" onClick={nextMonth} title="Next month">
            <ChevronRight size={13} />
          </button>
        </div>

        <div className="cal-drawer__grid">
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} className="cal-drawer__weekday">
              {d}
            </div>
          ))}
          {cells.map((dateStr, i) => {
            if (!dateStr)
              return <div key={`e-${i}`} className="cal-drawer__cell cal-drawer__cell--empty" />
            const rows = dayMap.get(dateStr) ?? []
            const isToday = dateStr === todayStr
            const isSelected = dateStr === selectedDate
            const hasTasks = rows.length > 0
            const dots = DOT_ORDER.filter((s) => rows.some((r) => r.status === s))
            return (
              <button
                key={dateStr}
                className={[
                  'cal-drawer__cell',
                  isToday ? 'cal-drawer__cell--today' : '',
                  isSelected ? 'cal-drawer__cell--selected' : '',
                  hasTasks ? 'cal-drawer__cell--has-tasks' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => handleDayClick(dateStr)}
                title={dateStr}
              >
                <span className="cal-drawer__day-num">{parseInt(dateStr.slice(8))}</span>
                {hasTasks && (
                  <span className="cal-drawer__dots">
                    {dots.slice(0, 3).map((s) => {
                      const { className, style } = statusDotStyle(s, kanbanLanes)
                      return <span key={s} className={className} style={style} />
                    })}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="cal-drawer__day-panel">
          <div className="cal-drawer__day-header">
            <span className="cal-drawer__day-title">
              {selectedDate === todayStr ? 'Today' : selectedDate}
            </span>
            <button
              className="tv-btn tv-btn--icon"
              onClick={handleGoToDay}
              title="Open in Task Vault"
            >
              <ExternalLink size={12} />
            </button>
          </div>
          {loadingDay && <div className="cal-drawer__day-loading">…</div>}
          {!loadingDay && selectedDayTasks.length === 0 && (
            <div className="cal-drawer__day-empty">No tasks</div>
          )}
          {!loadingDay &&
            selectedDayTasks.map((task) => (
              <button
                key={task.id}
                className={`cal-drawer__day-task cal-drawer__day-task--${task.status}`}
                onClick={() => handleTaskClick(task, selectedDate)}
                title={task.text}
              >
                <span className="cal-drawer__day-task-dot" />
                <span className="cal-drawer__day-task-text">{task.text}</span>
                {task.dueDate && <span className="cal-drawer__day-task-due">{task.dueDate}</span>}
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
