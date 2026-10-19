import React from 'react'
import './desk.css'

export type StatusTone = 'waiting' | 'working' | 'good' | 'bad' | 'muted'

export interface StatusDotProps {
  tone: StatusTone
  /** Says the state in words for assistive technology: "Waiting for you". Without it the dot is
   * decoration beside text that already says so. */
  label?: string
  /** A soft ring around the dot, for the one thing that wants a look. */
  pulse?: boolean
}

export function StatusDot({ tone, label, pulse = false }: StatusDotProps): JSX.Element {
  const classes = ['tmui-status-dot', `tmui-status-dot--${tone}`, pulse && 'tmui-status-dot--pulse']
  return (
    <span
      className={classes.filter(Boolean).join(' ')}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
