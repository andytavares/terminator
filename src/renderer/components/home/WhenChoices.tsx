import React, { useEffect, useState } from 'react'
import { Clock, X } from 'lucide-react'
import { IconButton, SegmentedControl } from '@terminator/extension-ui'
import type { When } from './start-work-schedule'
import type { Schedule } from '../../../shared/schemas/schedules.schema'

const OPTIONS: Array<{ value: When; label: string }> = [
  { value: 'now', label: 'Now' },
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
]

export interface WhenValue {
  when: When
  /** 'HH:MM', local. */
  time: string
  /** 'YYYY-MM-DD', used by Once. */
  date: string
}

interface WhenChoicesProps {
  value: WhenValue
  onChange: (value: WhenValue) => void
}

/** The "When" row: start now, or save the prompt to run once, every day or every weekday. */
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
      {value.when !== 'now' && <TimeInputs value={value} onChange={onChange} />}
      {value.when !== 'now' && (
        <p className="start-work__note">
          Runs while Terminator is open. A missed run waits in Needs you.
        </p>
      )}
      {value.when !== 'now' && <ScheduledRuns />}
    </>
  )
}

function TimeInputs({ value, onChange }: WhenChoicesProps): React.JSX.Element {
  return (
    <div className="start-work__time">
      <Clock aria-hidden="true" />
      {value.when === 'once' && (
        <input
          type="date"
          aria-label="Date"
          value={value.date}
          onChange={(e) => onChange({ ...value, date: e.target.value })}
        />
      )}
      <input
        type="time"
        aria-label="Time"
        value={value.time}
        onChange={(e) => onChange({ ...value, time: e.target.value })}
      />
    </div>
  )
}

const KIND_WORDS: Record<Schedule['kind'], string> = {
  once: 'once',
  daily: 'every day',
  weekdays: 'every weekday',
}

/** When a saved run runs, and in which repository. */
function whenOf(schedule: Schedule): string {
  const day = schedule.kind === 'once' ? `on ${schedule.date} ` : `${KIND_WORDS[schedule.kind]} `
  const repo = schedule.repoRoot.split('/').pop() ?? schedule.repoRoot
  return `${day}at ${schedule.time} · ${repo}`
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

/** The runs already saved, so one can be removed; nothing when there are none. */
export function ScheduledRuns(): React.JSX.Element | null {
  const [saved, remove] = useSavedRuns()
  if (saved.length === 0) return null
  return (
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
  )
}
