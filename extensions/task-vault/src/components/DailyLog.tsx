import React, { useState, useEffect } from 'react'
import { Trash2, Pencil, Check, X, ArrowRight, Zap, ListPlus } from 'lucide-react'
import type { DailyLog as DailyLogData, IndexedTask } from '../vault/types'
import { SmartTaskInput } from './SmartTaskInput'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'

interface DailyLogProps {
  log: DailyLogData
  onTaskComplete: (taskId: string) => Promise<void>
  onTaskMigrate: (taskId: string, targetDate: string) => Promise<void>
  onRefresh: () => Promise<void>
}

function SessionPicker({ onSelect, onClose }: { onSelect: (id: string) => void; onClose: () => void }): React.JSX.Element {
  const sessions = useSessionStore((s) => Array.from(s.sessions.values()))
  const activeSessions = sessions.filter(s => s.status !== 'closed')
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const projectsByWs = useWorkspaceStore((s) => s.projectsByWorkspaceId)

  function sessionLabel(s: { id: string; tabTitle?: string; projectId: string }): string {
    let project: { name: string; workspaceId: string } | undefined
    for (const [, projects] of projectsByWs) {
      project = projects.find(p => p.id === s.projectId)
      if (project) break
    }
    const workspace = project ? workspaces.find(w => w.id === project!.workspaceId) : undefined
    const parts: string[] = []
    if (workspace) parts.push(workspace.name)
    if (project) parts.push(project.name)
    if (s.tabTitle) parts.push(s.tabTitle)
    return parts.length ? parts.join(' › ') : s.id.slice(0, 8)
  }

  if (activeSessions.length === 0) {
    return (
      <span className="daily-log__link-picker">
        <span style={{ fontSize: 12, color: 'var(--tm-text-muted)' }}>No active terminal sessions.</span>
        <button className="tv-btn tv-btn--icon" onClick={onClose}><X size={14} /></button>
      </span>
    )
  }

  return (
    <span className="daily-log__link-picker">
      <select onChange={(e) => { if (e.target.value) onSelect(e.target.value) }} defaultValue="">
        <option value="" disabled>Select a terminal session…</option>
        {activeSessions.map(s => (
          <option key={s.id} value={s.id}>{sessionLabel(s)}</option>
        ))}
      </select>
      <button className="tv-btn tv-btn--icon" onClick={onClose}><X size={14} /></button>
    </span>
  )
}

function SubtaskRow({ subtask, onRefresh }: { subtask: IndexedTask; onRefresh: () => Promise<void> }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(subtask.text)

  async function saveEdit() {
    if (!editText.trim()) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:edit-task', {
      taskId: subtask.id, text: editText.trim()
    })
    setEditing(false)
    await onRefresh()
  }
  async function handleComplete() {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:complete-task', { taskId: subtask.id })
    await onRefresh()
  }
  async function handleDelete() {
    if (!confirm(`Delete subtask: "${subtask.text}"?`)) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:delete-task', { taskId: subtask.id })
    await onRefresh()
  }
  function statusIcon(status: IndexedTask['status']): string {
    switch (status) {
      case 'done': return '[x]'
      case 'cancelled': return '[-]'
      case 'in-progress': return '[/]'
      default: return '[ ]'
    }
  }
  const isOpen = subtask.status === 'open'
  return (
    <div className={`daily-log__subtask${subtask.status === 'done' ? ' daily-log__subtask--done' : ''}`}>
      <span className="daily-log__subtask-marker">{statusIcon(subtask.status)}</span>
      {editing ? (
        <span className="daily-log__subtask-edit">
          <input type="text" value={editText} onChange={e => setEditText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { void saveEdit() } if (e.key === 'Escape') setEditing(false) }} autoFocus />
          <button className="tv-btn tv-btn--primary" onClick={() => void saveEdit()}>Save</button>
          <button className="tv-btn tv-btn--icon" onClick={() => setEditing(false)}><X size={14} /></button>
        </span>
      ) : (
        <span className={`daily-log__subtask-text${subtask.status === 'done' ? ' daily-log__task-text--strikethrough' : ''}`}
          onDoubleClick={isOpen ? () => setEditing(true) : undefined}>
          {subtask.text}
        </span>
      )}
      {isOpen && !editing && (
        <span className="daily-log__subtask-actions">
          <button className="tv-btn tv-btn--outline" onClick={() => void handleComplete()} title="Complete"><Check size={14} /></button>
          <button className="tv-btn tv-btn--outline" onClick={() => setEditing(true)} title="Edit"><Pencil size={14} /></button>
          <button className="tv-btn tv-btn--outline" onClick={() => void handleDelete()} title="Delete"><Trash2 size={14} /></button>
        </span>
      )}
      {!isOpen && !editing && (
        <span className="daily-log__subtask-actions">
          <button className="tv-btn tv-btn--outline" onClick={() => void handleDelete()} title="Delete"><Trash2 size={14} /></button>
        </span>
      )}
    </div>
  )
}

function TaskRow({
  task,
  onComplete,
  onMigrate,
  onRefresh,
}: {
  task: IndexedTask
  onComplete: (id: string) => Promise<void>
  onMigrate: (id: string, date: string) => Promise<void>
  onRefresh: () => Promise<void>
}): React.JSX.Element {
  const [migratingOpen, setMigratingOpen] = useState(false)
  const [migrateDate, setMigrateDate] = useState('')
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [linking, setLinking] = useState(false)
  const [linked, setLinked] = useState(task.terminatorLinks.length > 0)
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [subtaskText, setSubtaskText] = useState('')

  useEffect(() => {
    setLinked(task.terminatorLinks.length > 0)
  }, [task.terminatorLinks])

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

  function rawText(): string {
    const parts = [task.text]
    if (task.project) parts.push(`@${task.project.replace(/ /g, '-')}`)
    if (task.context) parts.push(`+${task.context.replace(/ /g, '-')}`)
    if (task.area) parts.push(`#${task.area.replace(/ /g, '-')}`)
    if (task.dueDate) parts.push(`due:${task.dueDate}`)
    return parts.join(' ')
  }

  function startEdit() {
    setEditText(rawText())
    setEditing(true)
  }

  async function saveEdit() {
    if (!editText.trim()) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:edit-task', {
      taskId: task.id,
      text: editText.trim(),
    })
    setEditing(false)
    await onRefresh()
  }

  async function handleDelete() {
    if (!confirm(`Delete task: "${task.text}"?`)) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:delete-task', {
      taskId: task.id,
    })
    await onRefresh()
  }

  async function handleCancel() {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:cancel-task', {
      taskId: task.id,
    })
    await onRefresh()
  }

  async function handleMigrate() {
    if (!migrateDate) return
    await onMigrate(task.id, migrateDate)
    setMigratingOpen(false)
    setMigrateDate('')
  }

  async function handleLinkSession(sessionId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:links:create', {
      taskId: task.id,
      targetId: sessionId,
    })
    setLinked(true)
    setLinking(false)
  }

  async function handleRestore() {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:restore-task', { taskId: task.id })
    await onRefresh()
  }

  async function handleAddSubtask() {
    if (!subtaskText.trim()) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:add-subtask', {
      taskId: task.id,
      text: subtaskText.trim(),
    })
    setAddingSubtask(false)
    setSubtaskText('')
    await onRefresh()
  }

  const isOpen = task.status === 'open'
  const isDone = task.status === 'done'

  return (
    <div className={`daily-log__task${isDone ? ' daily-log__task--done' : task.status === 'cancelled' ? ' daily-log__task--cancelled' : ''}`}>
      <span className="daily-log__task-marker">{statusIcon(task.status)}</span>

      {editing ? (
        <span className="daily-log__task-edit">
          <SmartTaskInput
            value={editText}
            onChange={setEditText}
            onSubmit={saveEdit}
            onCancel={() => setEditing(false)}
            autoFocus
          />
          <button className="tv-btn tv-btn--primary" onClick={() => void saveEdit()}>Save</button>
          <button className="tv-btn tv-btn--icon" onClick={() => setEditing(false)}><X size={14} /></button>
        </span>
      ) : (
        <span
          className={`daily-log__task-text${isDone ? ' daily-log__task-text--strikethrough' : task.status === 'cancelled' ? ' daily-log__task-text--cancelled' : ''}`}
          onDoubleClick={isOpen ? startEdit : undefined}
          title={isOpen ? 'Double-click to edit' : undefined}
        >
          {task.text}
          {task.project && <span className="daily-log__tag daily-log__tag--project">@{task.project}</span>}
          {task.context && <span className="daily-log__tag daily-log__tag--context">+{task.context}</span>}
          {task.area && <span className="daily-log__tag daily-log__tag--area">#{task.area}</span>}
          {task.dueDate && <span className="daily-log__tag daily-log__tag--due">due:{task.dueDate}</span>}
        </span>
      )}

      {isOpen && !editing && (
        <span className="daily-log__task-actions">
          <button className="tv-btn tv-btn--outline" onClick={() => void onComplete(task.id)} title="Complete"><Check size={14} /></button>
          <button className="tv-btn tv-btn--outline" onClick={startEdit} title="Edit"><Pencil size={14} /></button>
          <button className="tv-btn tv-btn--outline" onClick={() => setMigratingOpen(true)} title="Migrate"><ArrowRight size={14} /></button>
          <button className="tv-btn tv-btn--outline" onClick={() => void handleCancel()} title="Cancel task"><X size={14} /></button>
          <button className="tv-btn tv-btn--outline" onClick={() => void handleDelete()} title="Delete"><Trash2 size={14} /></button>
          <button className="tv-btn tv-btn--outline" onClick={() => setAddingSubtask(true)} title="Add subtask"><ListPlus size={14} /></button>
          {linked || task.terminatorLinks.length > 0 ? (
            <button
              className="tv-btn tv-btn--outline"
              title="Jump to linked terminal"
              onClick={() => {
                useExtensionRegistry.getState().setActiveGlobalTab(null)
              }}
            ><Zap size={14} /></button>
          ) : (
            <button className="tv-btn tv-btn--outline" onClick={() => setLinking(true)} title="Link to session"><Zap size={14} /></button>
          )}
        </span>
      )}

      {!isOpen && !editing && (
        <span className="daily-log__task-actions">
          {task.status === 'done' && (
            <button className="tv-btn tv-btn--outline" onClick={() => void handleRestore()} title="Restore to open">↩</button>
          )}
          <button className="tv-btn tv-btn--outline" onClick={() => void handleDelete()} title="Delete"><Trash2 size={14} /></button>
        </span>
      )}

      {migratingOpen && (
        <span className="daily-log__migrate-picker">
          <input
            type="date"
            value={migrateDate}
            onChange={(e) => setMigrateDate(e.target.value)}
          />
          <button className="tv-btn tv-btn--primary" onClick={() => void handleMigrate()} disabled={!migrateDate}>Go</button>
          <button className="tv-btn tv-btn--icon" onClick={() => setMigratingOpen(false)}><X size={14} /></button>
        </span>
      )}

      {linking && (
        <SessionPicker
          onSelect={(sessionId) => { void handleLinkSession(sessionId) }}
          onClose={() => setLinking(false)}
        />
      )}

      {addingSubtask && (
        <span className="daily-log__subtask-edit">
          <input
            type="text"
            placeholder="Subtask text…"
            value={subtaskText}
            onChange={e => setSubtaskText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { void handleAddSubtask() } if (e.key === 'Escape') { setAddingSubtask(false); setSubtaskText('') } }}
            autoFocus
          />
          <button className="tv-btn tv-btn--outline" onClick={() => void handleAddSubtask()} disabled={!subtaskText.trim()}>Add</button>
          <button className="tv-btn tv-btn--icon" onClick={() => { setAddingSubtask(false); setSubtaskText('') }}><X size={14} /></button>
        </span>
      )}
    </div>
  )
}

function AddTaskRow({ onAdd }: { onAdd: (text: string) => Promise<void> }): React.JSX.Element {
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState(false)

  async function submit() {
    if (!text.trim()) return
    setAdding(true)
    try {
      await onAdd(text.trim())
      setText('')
      setOpen(false)
    } finally {
      setAdding(false)
    }
  }

  if (!open) {
    return (
      <button className="daily-log__add-btn" onClick={() => setOpen(true)}>
        + Add task
      </button>
    )
  }

  return (
    <div className="daily-log__add-row">
      <SmartTaskInput
        value={text}
        onChange={setText}
        onSubmit={submit}
        onCancel={() => setOpen(false)}
        disabled={adding}
        autoFocus
      />
      <button className="daily-log__save-btn" onClick={() => void submit()} disabled={adding || !text.trim()}>
        Add
      </button>
      <button className="daily-log__cancel-edit-btn" onClick={() => setOpen(false)}><X size={14} /></button>
    </div>
  )
}

export function DailyLog({ log, onTaskComplete, onTaskMigrate, onRefresh }: DailyLogProps): React.JSX.Element {
  async function handleAddTask(text: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:add-task', {
      filePath: log.filePath,
      text,
    })
    await onRefresh()
  }

  return (
    <div className="daily-log">
      <h2 className="daily-log__date">{log.date}</h2>

      <section className="daily-log__tasks">
        {log.tasks.map((task) => (
          <div key={task.id}>
            <TaskRow
              task={task as IndexedTask}
              onComplete={onTaskComplete}
              onMigrate={onTaskMigrate}
              onRefresh={onRefresh}
            />
            {task.subtasks && task.subtasks.length > 0 && (
              <div className="daily-log__subtasks">
                {task.subtasks.map((st) => (
                  <SubtaskRow key={st.id} subtask={st as IndexedTask} onRefresh={onRefresh} />
                ))}
              </div>
            )}
          </div>
        ))}
        <AddTaskRow onAdd={handleAddTask} />
      </section>

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
          No log for today yet. Add a task to create this file.
        </p>
      )}
    </div>
  )
}
