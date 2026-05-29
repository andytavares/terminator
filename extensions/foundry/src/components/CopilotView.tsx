import React, { useEffect, useRef, useState } from 'react'
import './foundry.css'
import type { Run, FileChange } from '../types/foundry.types'

interface Props {
  run: Run
  workspaceRoot: string
}

interface CopilotMsg {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: string
  filesModified?: string[]
}

function invoke(channel: string, payload: unknown) {
  return window.electronAPI.extensionBridge.invoke(channel, payload) as Promise<
    Record<string, unknown>
  >
}

function DiffPanel({
  files,
  workspaceRoot,
  onRevert,
}: {
  files: FileChange[]
  workspaceRoot: string
  onRevert: (filePath: string) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (files.length > 0 && !selected) setSelected(files[0].filePath)
  }, [files.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    void invoke('foundry:git-diff-file', { workspaceRoot, filePath: selected })
      .then((r) => setDiff((r.unifiedDiff as string) ?? ''))
      .finally(() => setLoading(false))
  }, [selected, workspaceRoot])

  const addedTotal = files.reduce((n, f) => n + f.linesAdded, 0)
  const removedTotal = files.reduce((n, f) => n + f.linesRemoved, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          padding: '6px 12px',
          borderBottom: '1px solid var(--tm-border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span className="fnd-section-label" style={{ flex: 1 }}>
          Live diff — {files.length} file{files.length !== 1 ? 's' : ''}
        </span>
        {addedTotal > 0 && (
          <span style={{ fontSize: 10, color: 'var(--tm-success)' }}>+{addedTotal} added</span>
        )}
        {removedTotal > 0 && (
          <span style={{ fontSize: 10, color: 'var(--tm-danger)' }}>-{removedTotal} removed</span>
        )}
      </div>

      {files.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--tm-text-muted)',
            fontSize: 12,
          }}
        >
          No changes yet
        </div>
      ) : (
        <>
          {/* File tabs */}
          <div
            style={{
              display: 'flex',
              gap: 2,
              padding: '4px 8px',
              borderBottom: '1px solid var(--tm-border)',
              flexShrink: 0,
              overflow: 'auto',
            }}
          >
            {files.map((f) => (
              <button
                key={f.filePath}
                onClick={() => setSelected(f.filePath)}
                className={`fnd-btn fnd-btn--sm ${selected === f.filePath ? 'fnd-btn--primary' : 'fnd-btn--secondary'}`}
                style={{ fontSize: 10, fontFamily: 'var(--tm-font-mono)', whiteSpace: 'nowrap' }}
              >
                {f.filePath.split('/').pop()}
              </button>
            ))}
          </div>

          {/* Diff content */}
          <div style={{ flex: 1, overflow: 'auto', fontFamily: 'monospace', fontSize: 11 }}>
            {loading ? (
              <div style={{ padding: 12, color: 'var(--tm-text-muted)' }}>Loading…</div>
            ) : !diff ? (
              <div style={{ padding: 12, color: 'var(--tm-text-muted)' }}>No diff available.</div>
            ) : (
              diff.split('\n').map((line, i) => {
                const isAdd = line.startsWith('+') && !line.startsWith('+++')
                const isDel = line.startsWith('-') && !line.startsWith('---')
                const isHunk = line.startsWith('@@')
                return (
                  <div
                    key={i}
                    style={{
                      padding: '0 12px',
                      background: isAdd
                        ? 'rgba(74,222,128,0.08)'
                        : isDel
                          ? 'rgba(239,68,68,0.08)'
                          : isHunk
                            ? 'rgba(92,107,192,0.08)'
                            : 'transparent',
                      color: isAdd
                        ? 'var(--tm-success)'
                        : isDel
                          ? 'var(--tm-danger)'
                          : isHunk
                            ? 'var(--tm-accent)'
                            : 'var(--tm-text-secondary)',
                      whiteSpace: 'pre',
                    }}
                  >
                    {line || ' '}
                  </div>
                )
              })
            )}
          </div>

          {/* Footer: revert button */}
          {selected && (
            <div
              style={{
                padding: '6px 10px',
                borderTop: '1px solid var(--tm-border)',
                flexShrink: 0,
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                style={{ color: 'var(--tm-warning)', fontSize: 11 }}
                onClick={() => onRevert(selected)}
              >
                ↺ Revert {selected.split('/').pop()}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function CopilotView({ run, workspaceRoot }: Props) {
  const [messages, setMessages] = useState<CopilotMsg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [files, setFiles] = useState<FileChange[]>(run.fileChanges ?? [])
  const [accepting, setAccepting] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Subscribe to streaming events
  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on('foundry:copilot-event', (data) => {
      const { runId, event } = data as {
        runId: string
        event: { type: string; token?: string; filePath?: string; change?: FileChange }
      }
      if (runId !== run.id) return
      if (event.type === 'token') {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === 'agent' && last.id === 'streaming') {
            return [...prev.slice(0, -1), { ...last, content: last.content + (event.token ?? '') }]
          }
          return [
            ...prev,
            {
              id: 'streaming',
              role: 'agent',
              content: event.token ?? '',
              timestamp: new Date().toISOString(),
            },
          ]
        })
      } else if (event.type === 'file-changed' && event.change) {
        setFiles((prev) => {
          const existing = prev.find((f) => f.filePath === event.filePath)
          if (existing)
            return prev.map((f) =>
              f.filePath === event.filePath
                ? {
                    ...f,
                    linesAdded: f.linesAdded + event.change!.linesAdded,
                    linesRemoved: f.linesRemoved + event.change!.linesRemoved,
                  }
                : f
            )
          return [...prev, event.change!]
        })
      } else if (event.type === 'done') {
        setStreaming(false)
        setMessages((prev) =>
          prev.map((m) => (m.id === 'streaming' ? { ...m, id: Date.now().toString() } : m))
        )
      } else if (event.type === 'error') {
        setStreaming(false)
      }
    })
    return () => unsub()
  }, [run.id])

  async function send() {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
      },
    ])
    setStreaming(true)
    try {
      await invoke('foundry:copilot-send', { runId: run.id, workspaceRoot, message: text })
    } catch {
      setStreaming(false)
    }
  }

  async function acceptAll() {
    setAccepting(true)
    try {
      await invoke('foundry:copilot-accept-all', { runId: run.id, workspaceRoot })
      setFiles([])
    } finally {
      setAccepting(false)
    }
  }

  async function abort() {
    // Server tracks turn files — just pass runId+workspaceRoot
    await invoke('foundry:copilot-abort', { runId: run.id, workspaceRoot })
    setFiles([])
  }

  async function revertFile(filePath: string) {
    await invoke('foundry:copilot-revert-file', { runId: run.id, workspaceRoot, filePath })
    setFiles((prev) => prev.filter((f) => f.filePath !== filePath))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  function renderProseLine(line: string, key: number) {
    // Highlight `backtick` spans and bare file paths (word.ext) as chips
    // Use a conservative pattern that won't match JSON values or URL fragments
    const parts = line.split(/(`[^`]+`)/)
    return (
      <div key={key} style={{ minHeight: '1.4em' }}>
        {parts.map((part, i) => {
          if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
            return (
              <span key={i} className="fnd-file-mention">
                {part.slice(1, -1)}
              </span>
            )
          }
          // Within plain text, highlight bare file paths like src/foo/bar.ts
          const subParts = part.split(/((?:[\w./]+\/)?[\w-]+\.\w{1,6}(?=\s|$|[,)]|\s))/g)
          return subParts.map((sub, j) => {
            if (/^(?:[\w./]+\/)?[\w-]+\.\w{1,6}$/.test(sub) && !sub.includes('://')) {
              return (
                <span key={`${i}-${j}`} className="fnd-file-mention">
                  {sub}
                </span>
              )
            }
            return <span key={`${i}-${j}`}>{sub}</span>
          })
        })}
      </div>
    )
  }

  function renderContent(content: string) {
    const lines = content.split('\n')
    return lines.map((line, i) => {
      // Tool call line: "→ toolName({...})"
      if (line.startsWith('→ ')) {
        const body = line.slice(2)
        const parenIdx = body.indexOf('(')
        const name = parenIdx >= 0 ? body.slice(0, parenIdx) : body
        const args = parenIdx >= 0 ? body.slice(parenIdx) : ''
        return (
          <div key={i} className="fnd-tool-call">
            <span className="fnd-tool-call__arrow">→</span>
            <span className="fnd-tool-call__name">{name}</span>
            {args && <span className="fnd-tool-call__args">{args}</span>}
          </div>
        )
      }
      // Empty line → spacer
      if (!line.trim()) return <div key={i} style={{ height: 6 }} />
      return renderProseLine(line, i)
    })
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ── Chat pane ── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRight: '1px solid var(--tm-border)',
        }}
      >
        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {messages.length === 0 && (
            <div
              style={{
                color: 'var(--tm-text-muted)',
                fontSize: 12,
                textAlign: 'center',
                marginTop: 32,
              }}
            >
              Start a conversation. Changes will appear in the live diff panel →
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '82%',
                  padding: '8px 12px',
                  borderRadius: 'var(--tm-radius)',
                  fontSize: 12,
                  lineHeight: 1.5,
                  background:
                    msg.role === 'user'
                      ? 'var(--tm-accent-dim, rgba(92,107,192,0.18))'
                      : 'var(--tm-bg-card)',
                  color: 'var(--tm-text-primary)',
                  border: `1px solid ${msg.role === 'user' ? 'rgba(92,107,192,0.3)' : 'var(--tm-border)'}`,
                  wordBreak: 'break-word',
                }}
              >
                {renderContent(msg.content)}
                {msg.id === 'streaming' && (
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 12,
                      background: 'var(--tm-accent)',
                      marginLeft: 2,
                      animation: 'fnd-blink 0.9s steps(1) infinite',
                      verticalAlign: 'middle',
                    }}
                  />
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div
          style={{
            padding: '10px 12px',
            borderTop: '1px solid var(--tm-border)',
            flexShrink: 0,
            background: 'var(--tm-bg-elevated)',
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
              style={{
                flex: 1,
                background: 'var(--tm-bg-input)',
                border: '1px solid var(--tm-border)',
                borderRadius: 'var(--tm-radius-xs)',
                color: 'var(--tm-text-primary)',
                fontSize: 12,
                padding: '6px 10px',
                resize: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            <button
              className="fnd-btn fnd-btn--primary fnd-btn--sm"
              onClick={() => void send()}
              disabled={streaming || !input.trim()}
              style={{ flexShrink: 0 }}
            >
              {streaming ? '…' : '⟶ Send'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Live diff pane ── */}
      <div
        style={{
          width: 420,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Diff header actions */}
        <div
          style={{
            padding: '6px 10px',
            borderBottom: '1px solid var(--tm-border)',
            flexShrink: 0,
            display: 'flex',
            gap: 6,
            justifyContent: 'flex-end',
          }}
        >
          <button
            className="fnd-btn fnd-btn--primary fnd-btn--sm"
            disabled={files.length === 0 || accepting}
            onClick={() => void acceptAll()}
          >
            {accepting ? '…' : '✓ Accept all'}
          </button>
          <button
            className="fnd-btn fnd-btn--secondary fnd-btn--sm"
            style={{ color: 'var(--tm-danger)' }}
            onClick={() => void abort()}
          >
            Abort
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <DiffPanel files={files} workspaceRoot={workspaceRoot} onRevert={revertFile} />
        </div>
      </div>
    </div>
  )
}
