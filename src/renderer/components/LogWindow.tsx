import { useShallow } from 'zustand/react/shallow'
import React, { useEffect, useRef } from 'react'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useLogStore } from '../stores/log.store'
import type { LogLevel } from '../stores/log.store'
import './LogWindow.css'

interface Props {
  onClose: () => void
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  log: 'LOG ',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERR ',
}

/** Escape anywhere in the window closes the log. */
export function LogWindow({ onClose }: Props): JSX.Element {
  const { entries, clear } = useLogStore(
    useShallow((s) => ({ entries: s.entries, clear: s.clear }))
  )
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(onClose)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length])

  return (
    <div className="log-window" role="region" aria-label="Application Logs">
      <LogHeader onClear={clear} onClose={onClose} />
      <div className="log-window__body" ref={listRef}>
        {entries.length === 0 && <div className="log-window__empty">No log entries yet.</div>}
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

function LogHeader({ onClear, onClose }: { onClear: () => void; onClose: () => void }) {
  return (
    <div className="log-window__header">
      <span className="log-window__title">Application Logs</span>
      <div className="log-window__actions">
        <button className="log-window__btn" onClick={onClear}>
          Clear
        </button>
        <button className="log-window__btn log-window__btn--close" onClick={onClose}>
          ✕
        </button>
      </div>
    </div>
  )
}
