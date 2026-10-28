import React, { useEffect, useRef, useState } from 'react'
import { Button, IconButton, Popover } from '@terminator/extension-ui'
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { localDate, monthNameOf, weekdayName } from '../utils/local-date'

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

type AmPm = 'AM' | 'PM'

type Shortcut = { label: string; getValue: () => string }

interface CalendarCell {
  date: Date
  currentMonth: boolean
}

type Mode = DateTimePickerProps['mode']

type Picker = ReturnType<typeof usePicker>

interface PaneProps {
  picker: Picker
  props: DateTimePickerProps
}

interface DayProps {
  cell: CalendarCell
  datePart: string
  min?: string
  onSelect: (dateStr: string) => void
}

interface ChoiceContext {
  props: DateTimePickerProps
  parts: { datePart: string; timePart: string }
  setOpen: (open: boolean) => void
  setAmPm: (half: AmPm) => void
}

interface TimeProps {
  picker: Picker
  timeListRef: React.RefObject<HTMLDivElement>
}

interface PickerPopoverProps extends PaneProps {
  timeListRef: React.RefObject<HTMLDivElement>
  onDone: () => void
}

interface TriggerProps {
  props: DateTimePickerProps
  open: boolean
  onToggle: () => void
}

// ── Value format conventions: 'YYYY-MM-DD' for mode='date', 'HH:MM' (24h) for mode='time' and
// 'YYYY-MM-DDTHH:MM' for mode='datetime' ──

// ── Helpers ───────────────────────────────────────────────────────

const DAY_HEADERS = [0, 1, 2, 3, 4, 5, 6].map((day) => weekdayName(day, 'short').slice(0, 2))

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

function defaultAmPm(timePart: string): AmPm {
  if (timePart) {
    const h = parseInt(timePart.split(':')[0] ?? '0', 10)
    return h >= 12 ? 'PM' : 'AM'
  }
  return new Date().getHours() >= 12 ? 'PM' : 'AM'
}

const DATE_SHORTCUTS: Shortcut[] = [
  { label: 'Today', getValue: () => localDate(new Date()) },
  {
    label: 'Tomorrow',
    getValue: () => {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      return localDate(d)
    },
  },
  {
    label: '1 week',
    getValue: () => {
      const d = new Date()
      d.setDate(d.getDate() + 7)
      return localDate(d)
    },
  },
  {
    label: '2 weeks',
    getValue: () => {
      const d = new Date()
      d.setDate(d.getDate() + 14)
      return localDate(d)
    },
  },
  {
    label: 'Next month',
    getValue: () => {
      const d = new Date()
      d.setMonth(d.getMonth() + 1)
      return localDate(d)
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

function halfOf(time: string): AmPm {
  const h = parseInt(time.split(':')[0] ?? '0', 10)
  return h >= 12 ? 'PM' : 'AM'
}

/** A picked time moved into the other half of the day, keeping its minutes. */
function mirrorHalf(timePart: string, half: AmPm): string {
  const [h, m] = timePart.split(':').map(Number)
  let newH = h
  if (half === 'PM' && h < 12) newH = h + 12
  else if (half === 'AM' && h >= 12) newH = h - 12
  return `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** A datetime value from its parts; a missing date means today. */
function joinDateTime(datePart: string, time: string): string {
  return `${datePart || localDate(new Date())}T${time}`
}

/** The date and time parts a value holds in each mode. */
function splitValue(mode: Mode, value: string): { datePart: string; timePart: string } {
  const v = value ?? ''
  if (mode === 'date') return { datePart: v, timePart: '' }
  if (mode === 'time') return { datePart: '', timePart: v }
  const [datePart, timePart] = v.split('T')
  return { datePart, timePart: timePart ?? '' }
}

function triggerLabel(props: DateTimePickerProps): string {
  const { mode, value } = props
  if (!value) return props.placeholder ?? EMPTY_LABELS[mode]
  if (mode === 'date') return formatDateDisplay(value)
  if (mode === 'time') return formatTimeDisplay(value)
  const [d, t] = value.split('T')
  return `${formatDateDisplay(d)}  ${t ? formatTimeDisplay(t) : ''}`
}

const EMPTY_LABELS: Record<Mode, string> = {
  date: 'Pick a date',
  time: 'Pick a time',
  datetime: 'Pick date & time',
}

/** Whether the popover is open. It opens under the trigger's wrapper and flips above it when
 *  there is no room below. */
function usePopover(defaultOpen: boolean | undefined) {
  const [open, setOpen] = useState(defaultOpen === true)
  return { open, setOpen }
}

/** The month the calendar shows: the value's month, or today's, re-anchored when the value changes. */
function useDisplayMonth(datePart: string) {
  const seed = datePart ? new Date(datePart + 'T00:00:00') : new Date()
  const [displayYear, setDisplayYear] = useState(seed.getFullYear())
  const [displayMonth, setDisplayMonth] = useState(seed.getMonth())
  const [anchoredDate, setAnchoredDate] = useState(datePart)
  if (anchoredDate !== datePart) {
    setAnchoredDate(datePart)
    if (datePart) {
      const d = new Date(datePart + 'T00:00:00')
      setDisplayYear(d.getFullYear())
      setDisplayMonth(d.getMonth())
    }
  }
  const stepShownMonth = (delta: 1 | -1) => {
    const next = displayMonth + delta
    if (next < 0 || next > 11) setDisplayYear((y) => y + delta)
    setDisplayMonth((next + 12) % 12)
  }
  return {
    displayYear,
    displayMonth,
    prev: () => stepShownMonth(-1),
    next: () => stepShownMonth(1),
  }
}

/** The AM/PM half shown: the picked time's half, else the current one. */
function useHalf(timePart: string) {
  const [amPm, setAmPm] = useState<AmPm>(() => defaultAmPm(timePart))
  const [syncedTime, setSyncedTime] = useState(timePart)
  if (syncedTime !== timePart) {
    setSyncedTime(timePart)
    if (timePart) setAmPm(halfOf(timePart))
  }
  return { amPm, setAmPm }
}

/** Scrolls the time list to the selected slot, or the one nearest now, in the shown half. */
function useScrollToSlot(open: boolean, timePart: string, amPm: AmPm) {
  const timeListRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !timeListRef.current) return
    const targetSlot = timePart || toLocalTimeStr(roundToNextQuarter(new Date()))
    const halfSlots = amPm === 'AM' ? AM_SLOTS : PM_SLOTS
    const idx = Math.max(halfSlots.indexOf(targetSlot), 0)
    const el = timeListRef.current.children[idx] as HTMLElement | undefined
    el?.scrollIntoView?.({ block: 'center' })
  }, [open, timePart, amPm])
  return timeListRef
}

/** What picking a date, a time, a half of the day, or Clear does in each mode. */
function choices({ props, parts, setOpen, setAmPm }: ChoiceContext) {
  const { mode, onChange } = props
  const { datePart, timePart } = parts
  const commitValue = (value: string, close: boolean) => {
    onChange(value)
    if (close) setOpen(false)
  }
  const selectDate = (dateStr: string) =>
    mode === 'date'
      ? commitValue(dateStr, true)
      : commitValue(`${dateStr}T${timePart || '12:00'}`, false)
  const selectTime = (time: string) =>
    mode === 'time' ? commitValue(time, true) : commitValue(joinDateTime(datePart, time), false)
  const toggleHalf = (half: AmPm) => {
    setAmPm(half)
    if (!timePart) return
    const slot = mirrorHalf(timePart, half)
    if (mode === 'time') onChange(slot)
    else if (mode === 'datetime') onChange(joinDateTime(datePart, slot))
  }
  const timeShortcut = (time: string) => {
    setAmPm(halfOf(time))
    selectTime(time)
  }
  return { selectDate, selectTime, timeShortcut, toggleHalf, clear: () => commitValue('', true) }
}

/** Everything the popover shows and does. */
function usePicker(props: DateTimePickerProps) {
  const parts = splitValue(props.mode, props.value)
  const popover = usePopover(props.defaultOpen)
  const month = useDisplayMonth(parts.datePart)
  const { amPm, setAmPm } = useHalf(parts.timePart)
  const timeListRef = useScrollToSlot(popover.open, parts.timePart, amPm)
  const actions = choices({ props, parts, setOpen: popover.setOpen, setAmPm })
  return { ...parts, popover, month, amPm, timeListRef, ...actions }
}

function ShortcutChips({ picker, props }: PaneProps): React.JSX.Element {
  const showCalendar = props.mode !== 'time'
  const chips = showCalendar ? DATE_SHORTCUTS : TIME_SHORTCUTS
  const current = showCalendar ? picker.datePart : picker.timePart
  const pick = showCalendar ? picker.selectDate : picker.timeShortcut
  return (
    <div className="dtp__shortcuts">
      {chips.map((s) => (
        <button
          key={s.label}
          type="button"
          className={`dtp__chip${current === s.getValue() ? ' dtp__chip--active' : ''}`}
          onClick={() => pick(s.getValue())}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}

function CalendarDay({ cell, datePart, min, onSelect }: DayProps): React.JSX.Element {
  const cellStr = localDate(cell.date)
  const isSelected = cellStr === datePart
  const isDisabled = min ? cellStr < min : false
  const className = [
    'dtp__cal-day',
    !cell.currentMonth && 'dtp__cal-day--other',
    cellStr === localDate(new Date()) && !isSelected && 'dtp__cal-day--today',
    isSelected && 'dtp__cal-day--selected',
    isDisabled && 'dtp__cal-day--disabled',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      type="button"
      disabled={isDisabled}
      className={className}
      onClick={() => onSelect(cellStr)}
    >
      {cell.date.getDate()}
    </button>
  )
}

function CalendarPane({ picker, props }: PaneProps): React.JSX.Element {
  const { displayYear, displayMonth, prev, next } = picker.month
  return (
    <div className="dtp__calendar">
      <div className="dtp__cal-header">
        <IconButton icon={ChevronLeft} label="Previous month" size="sm" onClick={prev} />
        <span className="dtp__cal-month-label">
          {monthNameOf(displayMonth)} {displayYear}
        </span>
        <IconButton icon={ChevronRight} label="Next month" size="sm" onClick={next} />
      </div>
      <div className="dtp__cal-grid">
        {DAY_HEADERS.map((d) => (
          <div key={d} className="dtp__cal-dow">
            {d}
          </div>
        ))}
        {buildCalendarGrid(displayYear, displayMonth).map((cell, i) => (
          <CalendarDay
            key={i}
            cell={cell}
            datePart={picker.datePart}
            min={props.min}
            onSelect={picker.selectDate}
          />
        ))}
      </div>
    </div>
  )
}

function HalfButton({ picker, half }: { picker: Picker; half: AmPm }): React.JSX.Element {
  return (
    <button
      type="button"
      className={`dtp__ampm-btn${picker.amPm === half ? ' dtp__ampm-btn--active' : ''}`}
      onClick={() => picker.toggleHalf(half)}
    >
      {half}
    </button>
  )
}

function TimePane({ picker, timeListRef }: TimeProps): React.JSX.Element {
  const visibleSlots = picker.amPm === 'AM' ? AM_SLOTS : PM_SLOTS
  return (
    <div className="dtp__time">
      <div className="dtp__ampm-toggle">
        <HalfButton picker={picker} half="AM" />
        <HalfButton picker={picker} half="PM" />
      </div>
      <div ref={timeListRef} className="dtp__time-list">
        {visibleSlots.map((slot) => (
          <button
            key={slot}
            type="button"
            className={`dtp__time-slot${slot === picker.timePart ? ' dtp__time-slot--selected' : ''}`}
            onClick={() => picker.selectTime(slot)}
          >
            {formatSlotLabel(slot)}
          </button>
        ))}
      </div>
    </div>
  )
}

function popoverClass(mode: Mode): string {
  if (mode === 'datetime') return 'dtp__popover dtp__popover--wide'
  if (mode === 'time') return 'dtp__popover dtp__popover--time-only'
  return 'dtp__popover'
}

function PickerPopover(p: PickerPopoverProps): React.JSX.Element {
  const { picker, props, timeListRef } = p
  return (
    <Popover
      label={EMPTY_LABELS[props.mode]}
      className={popoverClass(props.mode)}
      onDismiss={p.onDone}
    >
      <ShortcutChips picker={picker} props={props} />
      <div className="dtp__body">
        {props.mode !== 'time' && <CalendarPane picker={picker} props={props} />}
        {props.mode !== 'date' && <TimePane picker={picker} timeListRef={timeListRef} />}
      </div>
      <div className="dtp__footer">
        <Button variant="ghost" size="sm" onClick={picker.clear}>
          Clear
        </Button>
        <Button variant="primary" size="sm" onClick={p.onDone}>
          Done
        </Button>
      </div>
    </Popover>
  )
}

function triggerClass(value: string, open: boolean): string {
  let cls = 'dtp__trigger'
  if (value) cls += ' dtp__trigger--has-value'
  if (open) cls += ' dtp__trigger--open'
  return cls
}

function TriggerButton({ props, open, onToggle }: TriggerProps): React.JSX.Element {
  const Icon = props.mode === 'time' ? Clock : Calendar
  return (
    <button type="button" className={triggerClass(props.value, open)} onClick={onToggle}>
      <Icon className="tm-icon" />
      <span className="dtp__trigger-label">{triggerLabel(props)}</span>
    </button>
  )
}

export function DateTimePicker(props: DateTimePickerProps): React.JSX.Element {
  const { className } = props
  const picker = usePicker(props)
  const { open, setOpen } = picker.popover
  return (
    <div className={`dtp${className ? ` ${className}` : ''}`}>
      <TriggerButton props={props} open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <PickerPopover
          picker={picker}
          props={props}
          timeListRef={picker.timeListRef}
          onDone={() => setOpen(false)}
        />
      )}
    </div>
  )
}
