import React, { useEffect, useState } from 'react'
import { Clock, X } from 'lucide-react'
import { Button, IconButton, SegmentedControl } from '@terminator/extension-ui'
import {
  describeRepeat,
  nextRuns,
  type RepeatRule,
  type RepeatUnit,
} from '../../../shared/recurrence'
import type { When } from './start-work-schedule'
import type { Schedule } from '../../../shared/schemas/schedules.schema'

const OPTIONS: Array<{ value: When; label: string }> = [
  { value: 'now', label: 'Now' },
  { value: 'once', label: 'Once' },
  { value: 'repeat', label: 'Repeat' },
]

const WORKDAY = { from: '09:00', to: '18:00' }
const DAILY: RepeatRule = { every: 1, unit: 'day', days: [], between: null, overlap: 'skip' }

export interface WhenValue {
  when: When
  /** 'HH:MM', local. A minute or hour repeat starts its day at the window's start instead. */
  time: string
  /** 'YYYY-MM-DD', used by Once. */
  date: string
  rule: RepeatRule
}

/** The value Start work opens with: Now, and a daily repeat ready for when Repeat is picked. */
export const startingWhen = (date: string): WhenValue => ({
  when: 'now',
  time: '09:00',
  date,
  rule: DAILY,
})

interface WhenChoicesProps {
  value: WhenValue
  onChange: (value: WhenValue) => void
}

const isClockUnit = (unit: RepeatUnit): boolean => unit === 'minute' || unit === 'hour'

/** The time of day the saved schedule counts from. */
export const runTime = ({ when, rule, time }: WhenValue): string =>
  when === 'repeat' && isClockUnit(rule.unit) && rule.between !== null ? rule.between.from : time

const pad = (n: number): string => String(n).padStart(2, '0')
const clockOf = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`

/** "Thu 7 Nov 09:30" */
function runLabel(date: Date): string {
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'short' })
  const month = date.toLocaleDateString('en-GB', { month: 'short' })
  return `${weekday} ${date.getDate()} ${month} ${clockOf(date)}`
}

const onceAt = ({ date, time }: WhenValue): Date => new Date(`${date}T${time}`)

/** What stops a Once from being saved; null when it can be. */
export function whenProblem(value: WhenValue): string | null {
  if (value.when === 'repeat') return repeatProblem(value)
  if (value.when !== 'once') return null
  const at = onceAt(value)
  if (Number.isNaN(at.getTime())) return 'Pick a date and time.'
  return at.getTime() <= Date.now() ? 'That time has passed.' : null
}

function repeatProblem(value: WhenValue): string | null {
  const { between } = value.rule
  if (between !== null && between.to <= between.from)
    return 'The end time must be after the start time.'
  const now = new Date()
  const runs = nextRuns({ rule: value.rule, time: runTime(value), anchor: now }, now, 1)
  return runs.length === 0 ? 'This repeat never runs.' : null
}

/** The "When" row: start now, or save the prompt to run once, or on a repeat. */
export function WhenChoices({ value, onChange }: WhenChoicesProps): React.JSX.Element {
  return (
    <>
      <div className="start-work__label">When</div>
      <SegmentedControl
        label="When"
        className="start-work__when"
        value={value.when}
        onChange={(when) => onChange({ ...value, when })}
        options={OPTIONS.map((o) => ({ value: o.value, label: o.label, accessibleName: o.label }))}
      />
      {value.when === 'once' && <OnceFields value={value} onChange={onChange} />}
      {value.when === 'repeat' && <RepeatFields value={value} onChange={onChange} />}
      {value.when !== 'now' && (
        <p className="start-work__note">
          Runs while Terminator is open. A missed run waits in Needs you.
        </p>
      )}
    </>
  )
}

function quickPicks(now: Date): Array<{ label: string; at: Date }> {
  const at = (days: number, hours: number, minutes = 0): Date =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hours, minutes)
  const untilMonday = (8 - now.getDay()) % 7 || 7
  return [
    { label: 'In 1 hour', at: new Date(now.getTime() + 3_600_000) },
    { label: 'This evening 17:00', at: at(0, 17) },
    { label: 'Tomorrow 09:00', at: at(1, 9) },
    { label: 'Monday 09:00', at: at(untilMonday, 9) },
  ]
}

function inWords(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function QuickPicks({ value, onChange }: WhenChoicesProps): React.JSX.Element {
  return (
    <div className="start-work__picks">
      {quickPicks(new Date()).map((pick) => (
        <Button
          key={pick.label}
          size="sm"
          onClick={() =>
            onChange({
              ...value,
              date: pick.at.toLocaleDateString('sv-SE'),
              time: clockOf(pick.at),
            })
          }
        >
          {pick.label}
        </Button>
      ))}
    </div>
  )
}

function OnceFields({ value, onChange }: WhenChoicesProps): React.JSX.Element {
  return (
    <>
      <QuickPicks value={value} onChange={onChange} />
      <div className="start-work__time">
        <Clock aria-hidden="true" />
        <input
          type="date"
          aria-label="Date"
          value={value.date}
          onChange={(e) => onChange({ ...value, date: e.target.value })}
        />
        <TimeInput
          label="Time"
          value={value.time}
          onChange={(time) => onChange({ ...value, time })}
        />
      </div>
      <OnceSummary value={value} />
    </>
  )
}

function OnceSummary({ value }: { value: WhenValue }): React.JSX.Element {
  const problem = whenProblem(value)
  const at = onceAt(value)
  if (problem !== null) return <p className="start-work__error">{problem}</p>
  return (
    <p className="start-work__note">
      Runs {runLabel(at)}, in {inWords(at.getTime() - new Date().getTime())}.
    </p>
  )
}

function TimeInput(props: {
  label: string
  value: string
  onChange: (time: string) => void
}): React.JSX.Element {
  return (
    <input
      type="time"
      aria-label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  )
}

const PRESETS: Array<{ label: string; rule: Partial<RepeatRule> }> = [
  { label: 'Every 30 min', rule: { every: 30, unit: 'minute', between: WORKDAY } },
  { label: 'Hourly', rule: { every: 1, unit: 'hour', between: WORKDAY } },
  { label: 'Daily 09:00', rule: {} },
  { label: 'Weekdays 09:00', rule: { days: [1, 2, 3, 4, 5] } },
  { label: 'Mondays 09:00', rule: { unit: 'week', days: [1] } },
]

const UNITS: RepeatUnit[] = ['minute', 'hour', 'day', 'week', 'month']
/** Monday first; Sunday is 0. */
const WEEK: Array<{ day: number; initial: string; name: string }> = [
  { day: 1, initial: 'M', name: 'Mon' },
  { day: 2, initial: 'T', name: 'Tue' },
  { day: 3, initial: 'W', name: 'Wed' },
  { day: 4, initial: 'T', name: 'Thu' },
  { day: 5, initial: 'F', name: 'Fri' },
  { day: 6, initial: 'S', name: 'Sat' },
  { day: 0, initial: 'S', name: 'Sun' },
]

function RepeatFields({ value, onChange }: WhenChoicesProps): React.JSX.Element {
  const { rule } = value
  const setRule = (patch: Partial<RepeatRule>): void =>
    onChange({ ...value, rule: { ...rule, ...patch } })
  return (
    <>
      <Presets value={value} onChange={onChange} />
      <EveryRow rule={rule} setRule={setRule} />
      <WeekdayToggles rule={rule} setRule={setRule} />
      <DayTime value={value} onChange={onChange} setRule={setRule} />
      <label className="start-work__row-fields">
        If busy
        <select
          value={rule.overlap}
          onChange={(e) => setRule({ overlap: e.target.value as RepeatRule['overlap'] })}
        >
          <option value="skip">Skip the run while the last one is still going</option>
          <option value="start">Start another</option>
        </select>
      </label>
      <RepeatSummary value={value} />
    </>
  )
}

function RepeatSummary({ value }: { value: WhenValue }): React.JSX.Element {
  const problem = whenProblem(value)
  return problem === null ? (
    <NextRuns value={value} />
  ) : (
    <p className="start-work__error">{problem}</p>
  )
}

function Presets({ value, onChange }: WhenChoicesProps): React.JSX.Element {
  const keep = value.rule.overlap
  return (
    <div className="start-work__picks">
      {PRESETS.map((preset) => (
        <Button
          key={preset.label}
          size="sm"
          onClick={() =>
            onChange({ ...value, time: '09:00', rule: { ...DAILY, overlap: keep, ...preset.rule } })
          }
        >
          {preset.label}
        </Button>
      ))}
    </div>
  )
}

interface RuleFieldsProps {
  rule: RepeatRule
  setRule: (patch: Partial<RepeatRule>) => void
}

function EveryRow({ rule, setRule }: RuleFieldsProps): React.JSX.Element {
  return (
    <div className="start-work__row-fields">
      <span>Every</span>
      <input
        type="number"
        min={1}
        max={999}
        aria-label="Every"
        value={rule.every}
        onChange={(e) =>
          setRule({ every: Math.min(999, Math.max(1, Number(e.target.value) || 1)) })
        }
      />
      <UnitSelect rule={rule} setRule={setRule} />
    </div>
  )
}

function UnitSelect({ rule, setRule }: RuleFieldsProps): React.JSX.Element {
  const pick = (unit: RepeatUnit): void =>
    setRule({ unit, between: isClockUnit(unit) ? (rule.between ?? WORKDAY) : null })
  return (
    <select
      aria-label="Unit"
      value={rule.unit}
      onChange={(e) => pick(e.target.value as RepeatUnit)}
    >
      {UNITS.map((unit) => (
        <option key={unit} value={unit}>
          {unit}s
        </option>
      ))}
    </select>
  )
}

function WeekdayToggles({ rule, setRule }: RuleFieldsProps): React.JSX.Element {
  const toggle = (day: number): number[] =>
    rule.days.includes(day) ? rule.days.filter((d) => d !== day) : [...rule.days, day].sort()
  return (
    <div className="start-work__row-fields">
      <span>On</span>
      {WEEK.map(({ day, initial, name }) => (
        <Button
          key={day}
          size="sm"
          variant={rule.days.includes(day) ? 'primary' : 'secondary'}
          aria-label={name}
          aria-pressed={rule.days.includes(day)}
          onClick={() => setRule({ days: toggle(day) })}
        >
          {initial}
        </Button>
      ))}
    </div>
  )
}

/** "Between from and to" for minute and hour repeats; "At time" for the rest. */
function DayTime({
  value,
  onChange,
  setRule,
}: WhenChoicesProps & Pick<RuleFieldsProps, 'setRule'>) {
  const { between } = value.rule
  if (between === null)
    return (
      <div className="start-work__row-fields">
        <span>At</span>
        <TimeInput
          label="Time"
          value={value.time}
          onChange={(time) => onChange({ ...value, time })}
        />
      </div>
    )
  const set = (patch: Partial<typeof between>): void =>
    setRule({ between: { ...between, ...patch } })
  return (
    <div className="start-work__row-fields">
      <span>Between</span>
      <TimeInput label="From" value={between.from} onChange={(from) => set({ from })} />
      <span>and</span>
      <TimeInput label="To" value={between.to} onChange={(to) => set({ to })} />
    </div>
  )
}

/** How many runs one day holds inside the window of a minute or hour repeat. */
function runsADay({ every, unit, between }: RepeatRule): number {
  if (between === null) return 0
  const minuteOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
  const span = minuteOf(between.to) - minuteOf(between.from)
  return span < 0 ? 0 : Math.floor(span / (every * (unit === 'hour' ? 60 : 1))) + 1
}

function NextRuns({ value }: { value: WhenValue }): React.JSX.Element {
  const { rule } = value
  const now = new Date()
  const runs = nextRuns({ rule, time: runTime(value), anchor: now }, now, 3)
  const perDay = isClockUnit(rule.unit) ? ` · ${runsADay(rule)} runs a day` : ''
  return (
    <>
      <p className="start-work__note">
        {runs.length === 0 ? 'Next: none' : `Next: ${runs.map(runLabel).join(', ')}${perDay}`}
      </p>
      {rule.unit === 'minute' && rule.every < 5 && (
        <p className="start-work__warning">Runs 288 times a day or more.</p>
      )}
    </>
  )
}

/** When a saved run runs, and in which repository. */
function whenOf(schedule: Schedule): string {
  const when =
    schedule.repeat === null
      ? `on ${schedule.date} at ${schedule.time}`
      : describeRepeat(schedule.repeat, schedule.time)
  const repo =
    schedule.repoRoot === null
      ? 'Global'
      : (schedule.repoRoot.split('/').pop() ?? schedule.repoRoot)
  return `${when} · ${repo}`
}

/** The saved runs, read once, and a remove that reads them again. */
function useSavedRuns(): [Schedule[], (id: string) => Promise<void>] {
  const [saved, setSaved] = useState<Schedule[]>([])
  const read = (): Promise<void> =>
    window.electronAPI.schedules.list().then((answer) => {
      if ('data' in answer) setSaved(answer.data)
    })
  useEffect(() => {
    void window.electronAPI.schedules.list().then((answer) => {
      if ('data' in answer) setSaved(answer.data)
    })
  }, [])
  const remove = async (id: string): Promise<void> => {
    await window.electronAPI.schedules.delete({ id })
    await read()
  }
  return [saved, remove]
}

/** The runs already saved, so one can be removed; nothing when there are none. @internal */
export function ScheduledRuns(): React.JSX.Element | null {
  const [saved, remove] = useSavedRuns()
  if (saved.length === 0) return null
  return (
    <>
      <div className="start-work__label">Scheduled · {saved.length}</div>
      <ul className="start-work__scheduled" aria-label="Scheduled runs">
        {saved.map((schedule) => (
          <li key={schedule.id}>
            <span className="start-work__scheduled-prompt">{schedule.prompt}</span>
            <small>{whenOf(schedule)}</small>
            <IconButton
              icon={X}
              label={`Remove ${schedule.prompt}`}
              onClick={() => void remove(schedule.id)}
            />
          </li>
        ))}
      </ul>
    </>
  )
}
