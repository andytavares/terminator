import React, { useState } from 'react'
import type { DailyLog as DailyLogData, IndexedTask } from '../vault/types'

interface DailyLogProps {
  log: DailyLogData
  onTaskComplete: (taskId: string) => Promise<void>
  onTaskMigrate: (taskId: string, targetDate: string) => Promise<void>
}

function LinkToTerminator({ taskId }: { taskId: string }): React.JSX.Element {
  const [linking, setLinking] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [linked, setLinked] = useState(false)

  async function confirm() {
    if (!targetId.trim()) return
    await window.electronAPI.extensionBridge.invoke('task-vault:links:create', {
      taskId,
      targetId: targetId.trim(),
    })
    setLinked(true)
    setLinking(false)
    setTargetId('')
  }

  if (linked)
    return (
      <span className="daily-log__linked-badge" title="Linked">
        ⚡
      </span>
    )
  if (!linking)
    return (
      <button
        className="daily-log__link-btn"
        onClick={() => setLinking(true)}
        title="Link to Terminator session"
      >
        ⚡
      </button>
    )
  return (
    <span className="daily-log__link-picker">
      <input
        type="text"
        placeholder="Paste terminal UUID…"
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        autoFocus
      />
      <button onClick={confirm} disabled={!targetId.trim()}>
        Link
      </button>
      <button onClick={() => setLinking(false)}>✕</button>
    </span>
  )
}

export function DailyLog({ log, onTaskComplete, onTaskMigrate }: DailyLogProps): React.JSX.Element {
  const [migratingId, setMigratingId] = useState<string | null>(null)
  const [migrateDate, setMigrateDate] = useState('')

  function statusIcon(status: IndexedTask['status']): string {
    switch (status) {
      case 'done':
        return '[x]'
      case 'migrated':
        return '[>]'
      case 'cancelled':
        return '[-]'
      case 'in-progress':
        return '[/]'
      default:
        return '[ ]'
    }
  }

  async function handleComplete(taskId: string) {
    await onTaskComplete(taskId)
  }

  async function handleMigrate(taskId: string) {
    if (!migrateDate) return
    await onTaskMigrate(taskId, migrateDate)
    setMigratingId(null)
    setMigrateDate('')
  }

  return (
    <div className="daily-log">
      <h2 className="daily-log__date">{log.date}</h2>

      {log.tasks.length > 0 && (
        <section className="daily-log__tasks">
          {log.tasks.map((task) => (
            <div
              key={task.id}
              className={`daily-log__task${task.status === 'done' ? ' daily-log__task--done' : ''}`}
            >
              <span className="daily-log__task-marker">{statusIcon(task.status)}</span>
              <span
                className={`daily-log__task-text${task.status === 'done' ? ' daily-log__task-text--strikethrough' : ''}`}
              >
                {task.text}
              </span>
              {task.status === 'open' && (
                <span className="daily-log__task-actions">
                  <button
                    className="daily-log__complete-btn"
                    onClick={() => handleComplete(task.id)}
                    title="Complete task"
                  >
                    ✓
                  </button>
                  <button
                    className="daily-log__migrate-btn"
                    onClick={() => setMigratingId(task.id)}
                    title="Migrate task"
                  >
                    →
                  </button>
                  <LinkToTerminator taskId={task.id} />
                  {migratingId === task.id && (
                    <span className="daily-log__migrate-picker">
                      <input
                        type="date"
                        value={migrateDate}
                        onChange={(e) => setMigrateDate(e.target.value)}
                      />
                      <button onClick={() => handleMigrate(task.id)}>Go</button>
                      <button onClick={() => setMigratingId(null)}>✕</button>
                    </span>
                  )}
                </span>
              )}
            </div>
          ))}
        </section>
      )}

      {log.events.length > 0 && (
        <section className="daily-log__events">
          <h3>Events</h3>
          {log.events.map((event, i) => (
            <div key={i} className="daily-log__event">
              {event.time && <span className="daily-log__event-time">{event.time}</span>}
              <span>{event.text}</span>
            </div>
          ))}
        </section>
      )}

      {log.notes.length > 0 && (
        <section className="daily-log__notes">
          <h3>Notes</h3>
          {log.notes.map((note, i) => (
            <div key={i} className="daily-log__note">
              * {note.text}
            </div>
          ))}
        </section>
      )}

      {!log.exists && (
        <p className="daily-log__new-file">
          No log for today yet. Tasks added will create this file.
        </p>
      )}
    </div>
  )
}
