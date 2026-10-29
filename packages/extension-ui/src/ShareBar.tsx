import React from 'react'
import './desk.css'

export type ShareTone = 'accent' | 'info' | 'good' | 'warning' | 'neutral'

export interface Share {
  label: string
  value: number
  tone: ShareTone
}

export interface ShareBarProps {
  /** Says what the bar divides, for assistive technology: "How Notes was reached". */
  label: string
  /** Drawn in order, each as its part of the sum. Zero values take no room. */
  shares: readonly Share[]
}

/** One horizontal bar split into labeled parts: how a total divides. */
export function ShareBar({ label, shares }: ShareBarProps): React.JSX.Element | null {
  const parts = shares.filter((share) => share.value > 0)
  const total = parts.reduce((sum, share) => sum + share.value, 0)
  if (total === 0) return null
  const spoken = parts.map((share) => `${share.label} ${share.value}`).join(', ')
  return (
    <span className="tmui-share-bar" role="img" aria-label={`${label}: ${spoken}`}>
      {parts.map((share) => (
        <span
          key={share.label}
          className={`tmui-share-bar__part tmui-share-bar__part--${share.tone}`}
          style={{ width: `${(share.value / total) * 100}%` }}
          title={`${share.label} ${share.value}`}
        />
      ))}
    </span>
  )
}
