import React from 'react'

interface Props {
  onKey: (sequence: string) => void
}

const KEYS = [
  { label: 'Ctrl+C', seq: '\x03' },
  { label: 'Ctrl+D', seq: '\x04' },
  { label: 'Tab', seq: '\t' },
  { label: 'Esc', seq: '\x1b' },
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
]

export function MobileControlToolbar({ onKey }: Props) {
  return (
    <div className="mobile-toolbar">
      {KEYS.map(({ label, seq }) => (
        <button
          key={label}
          className="mobile-toolbar__btn"
          onPointerDown={(e) => {
            e.preventDefault()
            onKey(seq)
          }}
          aria-label={label}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
