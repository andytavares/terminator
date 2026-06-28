import React, { useEffect, useRef } from 'react'

interface RunConsoleProps {
  featureDir: string
  lines?: string[]
}

export function RunConsole({ lines = [] }: RunConsoleProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bottomRef.current && typeof bottomRef.current.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lines])

  return (
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
  )
}
