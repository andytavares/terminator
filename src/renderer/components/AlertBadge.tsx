import React from 'react'
import './AlertBadge.css'

export function AlertBadge({
  count,
  className = '',
}: {
  count: number
  className?: string
}): JSX.Element | null {
  if (count <= 0) return null
  return (
    <span
      className={`alert-badge ${className}`.trim()}
      aria-label={`${count} alert${count !== 1 ? 's' : ''}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
