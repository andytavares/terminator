import React from 'react'
import './desk.css'

export type ChipTone = 'neutral' | 'good' | 'bad' | 'waiting'

export interface ChipProps {
  tone?: ChipTone
  /** A flat icon placed before the text; it inherits the chip's colour. */
  icon?: React.ReactNode
  children: React.ReactNode
}

/** A small pill stating a fact: "3 files", "Checks passing". */
export function Chip({ tone = 'neutral', icon, children }: ChipProps): React.JSX.Element {
  return (
    <span className={`tmui-chip tmui-chip--${tone}`}>
      {icon}
      {children}
    </span>
  )
}
