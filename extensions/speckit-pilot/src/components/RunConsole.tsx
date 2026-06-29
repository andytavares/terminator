import React, { useEffect, useRef } from 'react'
import { PHASE_LABELS } from '../types/speckit.types.js'

interface RunConsoleProps {
  featureDir: string
  lines?: string[]
  phase?: string
}

export function RunConsole({ lines = [], phase }: RunConsoleProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bottomRef.current && typeof bottomRef.current.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lines])

  const phaseLabel = phase ? (PHASE_LABELS[phase] ?? phase) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 120 }}>
      {phaseLabel && (
        <div
          style={{
            padding: '2px 12px',
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--tm-text-secondary)',
            background: 'var(--tm-surface, #111827)',
            borderBottom: '1px solid var(--tm-border, #374151)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          {phaseLabel}
        </div>
      )}
      <pre
        aria-label="run console"
        style={{
          background: 'var(--tm-surface, #111827)',
          color: 'var(--tm-text-primary)',
          fontFamily: 'var(--tm-font-mono, monospace)',
          fontSize: 12,
          padding: '8px 12px',
          margin: 0,
          overflowY: 'auto',
          flex: 1,
          minHeight: 120,
          maxHeight: 320,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {lines.length === 0 ? (
          <span style={{ color: 'var(--tm-text-secondary)' }}>Waiting for output…</span>
        ) : (
          lines.map((line, i) => <div key={i}>{line}</div>)
        )}
        <div ref={bottomRef} />
      </pre>
    </div>
  )
}
