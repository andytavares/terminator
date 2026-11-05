import React from 'react'
import { Clock } from 'lucide-react'
import { SegmentedControl } from '@terminator/extension-ui'
import type { When } from './start-work-schedule'

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
