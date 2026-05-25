import React from 'react'
import './ActivitySpinner.css'

export function ActivitySpinner({ className = '' }: { className?: string }): JSX.Element {
  return (
    <span
      className={`activity-spinner${className ? ` ${className}` : ''}`}
      aria-label="Activity in progress"
      role="status"
    />
  )
}
