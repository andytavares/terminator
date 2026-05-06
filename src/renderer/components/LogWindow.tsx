import React, { useEffect, useRef } from 'react'
import { useLogStore } from '../stores/log.store'
import type { LogLevel } from '../stores/log.store'
import './LogWindow.css'

interface Props {
  onClose: () => void
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  log:   'LOG ',
  info:  'INFO',
  warn:  'WARN',
  error: 'ERR ',
}

export function LogWindow({ onClose }: Props): JSX.Element {
  const { entries, clear } = useLogStore()
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length])

  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="log-window" role="dialog" aria-label="Application Logs">
      <div className="log-window__header">
        <span className="log-window__title">Application Logs</span>
        <div className="log-window__actions">
          <button className="log-window__btn" onClick={clear}>Clear</button>
          <button className="log-window__btn log-window__btn--close" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="log-window__body" ref={listRef}>
        {entries.length === 0 && (
          <div className="log-window__empty">No log entries yet.</div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className={`log-entry log-entry--${entry.level}`}>
            <span className="log-entry__ts">{entry.timestamp}</span>
            <span className="log-entry__level">{LEVEL_LABEL[entry.level]}</span>
            <span className="log-entry__msg">{entry.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
