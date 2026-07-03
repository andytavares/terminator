import React, { useEffect, useRef, useState } from 'react'
import { PHASE_LABELS } from '../types/speckit.types.js'
import { renderMarkdown } from '../utils/markdown.js'
import { getSpeckitAPI } from '../types/electron.js'

interface RunConsoleProps {
  featureDir: string
  lines?: string[]
  phase?: string
}

type RenderMode = 'text' | 'markdown'

export function RunConsole({ featureDir, lines = [], phase }: RunConsoleProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<RenderMode>('text')
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  const sendReply = async () => {
    const text = reply.trim()
    if (!text || sending) return
    setSending(true)
    setReply('')
    await getSpeckitAPI().runReply({ featureDir, text })
    setSending(false)
  }

  useEffect(() => {
    if (bottomRef.current && typeof bottomRef.current.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lines, mode])

  const phaseLabel = phase ? (PHASE_LABELS[phase] ?? phase) : null

  // Shared scroll/surface styling so plain text and markdown read the same.
  const surfaceStyle: React.CSSProperties = {
    background: 'var(--tm-surface, #111827)',
    color: 'var(--tm-text-primary)',
    fontSize: 12,
    padding: '8px 12px',
    margin: 0,
    overflowY: 'auto',
    flex: 1,
    minHeight: 120,
    maxHeight: 320,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 120 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '2px 12px',
          background: 'var(--tm-surface, #111827)',
          borderBottom: '1px solid var(--tm-border, #374151)',
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--tm-text-secondary)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          {phaseLabel}
        </span>
        <div className="sk-editor__mode-toggle" role="group" aria-label="console render mode">
          {(['text', 'markdown'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`sk-editor__mode-btn${mode === m ? ' sk-editor__mode-btn--active' : ''}`}
              aria-pressed={mode === m}
            >
              {m === 'text' ? 'Text' : 'Markdown'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'markdown' && lines.length > 0 ? (
        <div
          className="sk-markdown"
          style={surfaceStyle}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(lines.join('\n')) }}
        />
      ) : (
        <pre
          aria-label="run console"
          style={{
            ...surfaceStyle,
            fontFamily: 'var(--tm-font-mono, monospace)',
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
      )}

      <form
        className="sk-console-reply"
        onSubmit={(e) => {
          e.preventDefault()
          void sendReply()
        }}
      >
        <input
          type="text"
          aria-label="Reply to the agent"
          placeholder="Reply to the agent…"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          disabled={sending}
        />
        <button
          type="submit"
          className="sk-btn sk-btn--primary"
          disabled={sending || reply.trim().length === 0}
        >
          Send
        </button>
      </form>
    </div>
  )
}
