import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react'

// ── Value format conventions ──────────────────────────────────────
// mode='date'     → value = 'YYYY-MM-DD'
// mode='time'     → value = 'HH:MM'   (24h internally)
// mode='datetime' → value = 'YYYY-MM-DDTHH:MM'

export interface DateTimePickerProps {
  mode: 'date' | 'time' | 'datetime'
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** minimum selectable date as 'YYYY-MM-DD' (date/datetime modes) */
  min?: string
  className?: string
  /** When true, open the picker popover on mount without requiring a button click. */
  defaultOpen?: boolean
}

// ── Helpers ───────────────────────────────────────────────────────

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
const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toLocalTimeStr(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function roundToNextQuarter(d: Date): Date {
  const out = new Date(d)
  const m = out.getMinutes()
  const rounded = Math.ceil(m / 15) * 15
  out.setMinutes(rounded % 60, 0, 0)
  if (rounded >= 60) out.setHours(out.getHours() + 1)
  return out
}

function formatDateDisplay(s: string): string {
  if (!s) return ''
  const [y, mo, d] = s.split('-').map(Number)
  return new Date(y, mo - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Format HH:MM (24h) → "h:mm AM/PM" */
function formatTimeDisplay(s: string): string {
  if (!s) return ''
  const [h, m] = s.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const display = h % 12 || 12
  return `${display}:${String(m).padStart(2, '0')} ${period}`
}

/** Format a 24h slot "HH:MM" → "h:mm" (no period, used inside list where toggle shows AM/PM) */
function formatSlotLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const display = h % 12 || 12
  return `${display}:${String(m).padStart(2, '0')}`
}

/** All 15-minute slots across a full day, partitioned by AM/PM */
const AM_SLOTS: string[] = []
const PM_SLOTS: string[] = []
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    const s = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    if (h < 12) AM_SLOTS.push(s)
    else PM_SLOTS.push(s)
  }
}

type AmPm = 'AM' | 'PM'

function defaultAmPm(timePart: string): AmPm {
  if (timePart) {
    const h = parseInt(timePart.split(':')[0] ?? '0', 10)
    return h >= 12 ? 'PM' : 'AM'
  }
  return new Date().getHours() >= 12 ? 'PM' : 'AM'
}

type Shortcut = { label: string; getValue: () => string }

const DATE_SHORTCUTS: Shortcut[] = [
  { label: 'Today', getValue: () => toLocalDateStr(new Date()) },
  {
    label: 'Tomorrow',
    getValue: () => {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      return toLocalDateStr(d)
    },
  },
  {
    label: '1 week',
    getValue: () => {
      const d = new Date()
      d.setDate(d.getDate() + 7)
      return toLocalDateStr(d)
    },
  },
  {
    label: '2 weeks',
    getValue: () => {
      const d = new Date()
      d.setDate(d.getDate() + 14)
      return toLocalDateStr(d)
    },
  },
  {
    label: 'Next month',
    getValue: () => {
      const d = new Date()
      d.setMonth(d.getMonth() + 1)
      return toLocalDateStr(d)
    },
  },
]

const TIME_SHORTCUTS: Shortcut[] = [
  {
    label: '30 min',
    getValue: () => toLocalTimeStr(roundToNextQuarter(new Date(Date.now() + 30 * 60 * 1000))),
  },
  {
    label: '1 hour',
    getValue: () => toLocalTimeStr(roundToNextQuarter(new Date(Date.now() + 60 * 60 * 1000))),
  },
  {
    label: '2 hours',
    getValue: () => toLocalTimeStr(roundToNextQuarter(new Date(Date.now() + 2 * 60 * 60 * 1000))),
  },
  {
    label: '4 hours',
    getValue: () => toLocalTimeStr(roundToNextQuarter(new Date(Date.now() + 4 * 60 * 60 * 1000))),
  },
  { label: 'End of day', getValue: () => '17:00' },
]

interface CalendarCell {
  date: Date
  currentMonth: boolean
}

function buildCalendarGrid(year: number, month: number): CalendarCell[] {
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: CalendarCell[] = []

  const prevMonth = month === 0 ? 11 : month - 1
  const prevYear = month === 0 ? year - 1 : year
  const daysInPrev = new Date(prevYear, prevMonth + 1, 0).getDate()
  for (let i = firstDow - 1; i >= 0; i--) {
    cells.push({ date: new Date(prevYear, prevMonth, daysInPrev - i), currentMonth: false })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), currentMonth: true })
  }

  const nextMonth = month === 11 ? 0 : month + 1
  const nextYear = month === 11 ? year + 1 : year
  let nextDay = 1
  while (cells.length < 42) {
    cells.push({ date: new Date(nextYear, nextMonth, nextDay++), currentMonth: false })
  }

  return cells
}

// ── Component ─────────────────────────────────────────────────────

export function DateTimePicker({
  mode,
  value,
  onChange,
  placeholder,
  min,
  className,
  defaultOpen,
}: DateTimePickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const timeListRef = useRef<HTMLDivElement>(null)

  // Derive date and time parts from value
  const datePart =
    mode === 'time' ? '' : mode === 'datetime' ? (value?.split('T')[0] ?? '') : (value ?? '')
  const timePart =
    mode === 'date' ? '' : mode === 'datetime' ? (value?.split('T')[1] ?? '') : (value ?? '')

  // Calendar display state – initialize to value's month or today
  const seed = datePart ? new Date(datePart + 'T00:00:00') : new Date()
  const [displayYear, setDisplayYear] = useState(seed.getFullYear())
  const [displayMonth, setDisplayMonth] = useState(seed.getMonth())

  // AM/PM toggle state — defaults to whichever half is closest to now (or the selected time)
  const [amPm, setAmPm] = useState<AmPm>(() => defaultAmPm(timePart))

  const visibleSlots = amPm === 'AM' ? AM_SLOTS : PM_SLOTS

  const openPicker = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const estimatedHeight = 360
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const top = spaceBelow >= estimatedHeight ? rect.bottom + 4 : rect.top - estimatedHeight - 4
    setPos({ top, left: rect.left })
    setOpen(true)
  }, [])

  useEffect(() => {
    if (defaultOpen) openPicker()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        popoverRef.current?.contains(e.target as Node)
      )
        return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Auto-scroll time list to selected slot (or closest slot in current AM/PM half)
  useEffect(() => {
    if (!open || !timeListRef.current) return
    const targetSlot = timePart || toLocalTimeStr(roundToNextQuarter(new Date()))
    const halfSlots = amPm === 'AM' ? AM_SLOTS : PM_SLOTS
    const idx = halfSlots.indexOf(targetSlot)
    const scrollIdx = idx >= 0 ? idx : 0
    const el = timeListRef.current.children[scrollIdx] as HTMLElement | undefined
    el?.scrollIntoView?.({ block: 'center' })
  }, [open, timePart, amPm])

  // When AM/PM changes, sync it with the selected timePart if one is set
  function handleAmPmToggle(half: AmPm) {
    setAmPm(half)
    if (!timePart) return
    const [h, m] = timePart.split(':').map(Number)
    // Mirror hour to the new half
    let newH = h
    if (half === 'PM' && h < 12) newH = h + 12
    else if (half === 'AM' && h >= 12) newH = h - 12
    const newSlot = `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    if (mode === 'time') onChange(newSlot)
    else if (mode === 'datetime') onChange(`${datePart || toLocalDateStr(new Date())}T${newSlot}`)
  }

  // When datePart changes externally (e.g. shortcut), re-anchor the calendar
  useEffect(() => {
    if (!datePart) return
    const d = new Date(datePart + 'T00:00:00')
    setDisplayYear(d.getFullYear())
    setDisplayMonth(d.getMonth())
  }, [datePart])

  // Sync amPm state when timePart changes externally
  useEffect(() => {
    if (!timePart) return
    const h = parseInt(timePart.split(':')[0] ?? '0', 10)
    setAmPm(h >= 12 ? 'PM' : 'AM')
  }, [timePart])

  function selectDate(dateStr: string) {
    if (mode === 'date') {
      onChange(dateStr)
      setOpen(false)
    } else {
      onChange(`${dateStr}T${timePart || '12:00'}`)
    }
  }

  function selectTime(timeStr: string) {
    if (mode === 'time') {
      onChange(timeStr)
      setOpen(false)
    } else {
      onChange(`${datePart || toLocalDateStr(new Date())}T${timeStr}`)
    }
  }

  function handleDateShortcut(shortcut: Shortcut) {
    const v = shortcut.getValue()
    if (mode === 'date') {
      onChange(v)
      setOpen(false)
    } else {
      onChange(`${v}T${timePart || '12:00'}`)
    }
  }

  function handleTimeShortcut(shortcut: Shortcut) {
    const v = shortcut.getValue()
    // Sync AM/PM toggle with the shortcut value
    const h = parseInt(v.split(':')[0] ?? '0', 10)
    setAmPm(h >= 12 ? 'PM' : 'AM')
    if (mode === 'time') {
      onChange(v)
      setOpen(false)
    } else {
      onChange(`${datePart || toLocalDateStr(new Date())}T${v}`)
    }
  }

  function prevMonth() {
    if (displayMonth === 0) {
      setDisplayYear((y) => y - 1)
      setDisplayMonth(11)
    } else {
      setDisplayMonth((m) => m - 1)
    }
  }

  function nextMonth() {
    if (displayMonth === 11) {
      setDisplayYear((y) => y + 1)
      setDisplayMonth(0)
    } else {
      setDisplayMonth((m) => m + 1)
    }
  }

  function getTriggerLabel(): string {
    if (mode === 'date') return value ? formatDateDisplay(value) : (placeholder ?? 'Pick a date')
    if (mode === 'time') return value ? formatTimeDisplay(value) : (placeholder ?? 'Pick a time')
    if (!value) return placeholder ?? 'Pick date & time'
    const [d, t] = value.split('T')
    return `${formatDateDisplay(d)}  ${t ? formatTimeDisplay(t) : ''}`
  }

  const cells = buildCalendarGrid(displayYear, displayMonth)
  const todayStr = toLocalDateStr(new Date())
  const showCalendar = mode === 'date' || mode === 'datetime'
  const showTime = mode === 'time' || mode === 'datetime'

  return (
    <div className={`dtp${className ? ` ${className}` : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`dtp__trigger${value ? ' dtp__trigger--has-value' : ''}${open ? ' dtp__trigger--open' : ''}`}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        {mode === 'time' ? <Clock size={13} /> : <Calendar size={13} />}
        <span className="dtp__trigger-label">{getTriggerLabel()}</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            className={[
              'dtp__popover',
              mode === 'datetime' && 'dtp__popover--wide',
              mode === 'time' && 'dtp__popover--time-only',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ top: pos.top, left: pos.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Shortcut chips */}
            <div className="dtp__shortcuts">
              {showCalendar &&
                DATE_SHORTCUTS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className={`dtp__chip${datePart === s.getValue() ? ' dtp__chip--active' : ''}`}
                    onClick={() => handleDateShortcut(s)}
                  >
                    {s.label}
                  </button>
                ))}
              {showTime &&
                !showCalendar &&
                TIME_SHORTCUTS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className={`dtp__chip${timePart === s.getValue() ? ' dtp__chip--active' : ''}`}
                    onClick={() => handleTimeShortcut(s)}
                  >
                    {s.label}
                  </button>
                ))}
            </div>

            <div className="dtp__body">
              {/* Calendar */}
              {showCalendar && (
                <div className="dtp__calendar">
                  <div className="dtp__cal-header">
                    <button type="button" className="dtp__cal-nav" onClick={prevMonth}>
                      <ChevronLeft size={14} />
                    </button>
                    <span className="dtp__cal-month-label">
                      {MONTH_NAMES[displayMonth]} {displayYear}
                    </span>
                    <button type="button" className="dtp__cal-nav" onClick={nextMonth}>
                      <ChevronRight size={14} />
                    </button>
                  </div>

                  <div className="dtp__cal-grid">
                    {DAY_HEADERS.map((d) => (
                      <div key={d} className="dtp__cal-dow">
                        {d}
                      </div>
                    ))}
                    {cells.map((cell, i) => {
                      const cellStr = toLocalDateStr(cell.date)
                      const isToday = cellStr === todayStr
                      const isSelected = cellStr === datePart
                      const isDisabled = min ? cellStr < min : false
                      return (
                        <button
                          key={i}
                          type="button"
                          disabled={isDisabled}
                          className={[
                            'dtp__cal-day',
                            !cell.currentMonth && 'dtp__cal-day--other',
                            isToday && !isSelected && 'dtp__cal-day--today',
                            isSelected && 'dtp__cal-day--selected',
                            isDisabled && 'dtp__cal-day--disabled',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => selectDate(cellStr)}
                        >
                          {cell.date.getDate()}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Time panel */}
              {showTime && (
                <div className="dtp__time">
                  {/* AM/PM toggle */}
                  <div className="dtp__ampm-toggle">
                    <button
                      type="button"
                      className={`dtp__ampm-btn${amPm === 'AM' ? ' dtp__ampm-btn--active' : ''}`}
                      onClick={() => handleAmPmToggle('AM')}
                    >
                      AM
                    </button>
                    <button
                      type="button"
                      className={`dtp__ampm-btn${amPm === 'PM' ? ' dtp__ampm-btn--active' : ''}`}
                      onClick={() => handleAmPmToggle('PM')}
                    >
                      PM
                    </button>
                  </div>

                  <div ref={timeListRef} className="dtp__time-list">
                    {visibleSlots.map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        className={`dtp__time-slot${slot === timePart ? ' dtp__time-slot--selected' : ''}`}
                        onClick={() => selectTime(slot)}
                      >
                        {formatSlotLabel(slot)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="dtp__footer">
              <button
                type="button"
                className="dtp__btn dtp__btn--clear"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                Clear
              </button>
              <button
                type="button"
                className="dtp__btn dtp__btn--done"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
