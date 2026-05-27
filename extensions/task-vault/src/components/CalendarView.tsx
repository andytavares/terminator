import React, { useState, useEffect } from 'react'
import { ChevronRight } from 'lucide-react'
import { useVaultStore } from '../stores/vault.store'

type DayData = { date: string; status: string; count: number }
type DayMap = Map<string, DayData[]>

const STATUS_DOT_CLASS: Record<string, string> = {
  open: 'cal-dot--open',
  'in-progress': 'cal-dot--progress',
  'in-review': 'cal-dot--progress',
  blocked: 'cal-dot--blocked',
  done: 'cal-dot--done',
  migrated: 'cal-dot--migrated',
  cancelled: 'cal-dot--cancelled',
}

const DOT_ORDER = ['open', 'in-progress', 'blocked', 'done', 'migrated', 'cancelled']

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
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

export function CalendarView(): React.JSX.Element {
  const { loadDate, loadToday } = useVaultStore()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [dayMap, setDayMap] = useState<DayMap>(new Map())

  const pad = (n: number) => String(n).padStart(2, '0')
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

  useEffect(() => {
    void load()
  }, [year, month])

  async function load() {
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

  function handleDayClick(dateStr: string) {
    useVaultStore.getState().setView('daily')
    if (dateStr === todayStr) {
      void loadToday()
    } else {
      void loadDate(dateStr)
    }
  }

  // Build grid cells
  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()

  const cells: (string | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="cal-view">
      <div className="cal-view__header">
        <button className="tv-btn tv-btn--icon" onClick={prevMonth} title="Previous month">
          <ChevronRight size={15} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <span className="cal-view__month-label">
          {MONTH_NAMES[month - 1]} {year}
        </span>
        <button className="tv-btn tv-btn--icon" onClick={nextMonth} title="Next month">
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="cal-view__grid">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="cal-view__weekday">
            {d}
          </div>
        ))}
        {cells.map((dateStr, i) => {
          if (!dateStr)
            return <div key={`empty-${i}`} className="cal-view__cell cal-view__cell--empty" />
          const rows = dayMap.get(dateStr) ?? []
          const isToday = dateStr === todayStr
          const hasTasks = rows.length > 0
          const dots = DOT_ORDER.filter((s) => rows.some((r) => r.status === s))

          return (
            <button
              key={dateStr}
              className={`cal-view__cell${isToday ? ' cal-view__cell--today' : ''}${hasTasks ? ' cal-view__cell--has-tasks' : ''}`}
              onClick={() => handleDayClick(dateStr)}
              title={dateStr}
            >
              <span className="cal-view__day-num">{parseInt(dateStr.slice(8))}</span>
              {hasTasks && (
                <span className="cal-view__dots">
                  {dots.slice(0, 5).map((s) => (
                    <span key={s} className={`cal-dot ${STATUS_DOT_CLASS[s] ?? ''}`} />
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="cal-view__legend">
        <span className="cal-legend-item">
          <span className="cal-dot cal-dot--open" />
          Open
        </span>
        <span className="cal-legend-item">
          <span className="cal-dot cal-dot--blocked" />
          Blocked
        </span>
        <span className="cal-legend-item">
          <span className="cal-dot cal-dot--done" />
          Done
        </span>
      </div>
    </div>
  )
}
