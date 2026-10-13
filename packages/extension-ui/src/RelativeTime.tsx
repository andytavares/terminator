import React from 'react'
import { formatRelativeTime, toMilliseconds, type TimeInput } from './relative-time'

export interface RelativeTimeProps {
  value: TimeInput
  /** The moment to measure from. Defaults to when the component renders. */
  now?: TimeInput
}

/** The time as a sentence, with the exact moment in the tooltip and in the `datetime` attribute
 * for assistive technology and copy. */
export function RelativeTime({ value, now }: RelativeTimeProps): JSX.Element | null {
  const moment = new Date(toMilliseconds(value))
  if (Number.isNaN(moment.getTime())) return null
  return (
    <time dateTime={moment.toISOString()} title={moment.toLocaleString()}>
      {formatRelativeTime(moment, now)}
    </time>
  )
}
