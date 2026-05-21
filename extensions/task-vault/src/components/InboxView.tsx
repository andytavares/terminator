import React, { useEffect, useState } from 'react'
import { Trash2, Pencil, X } from 'lucide-react'
import type { IndexedTask } from '../vault/types'
import { InboxProcessor } from './InboxProcessor'
import { SmartTaskInput } from './SmartTaskInput'
import { FileToPicker } from './FileToPicker'
import { useVaultStore } from '../stores/vault.store'

export function InboxView(): React.JSX.Element {
  const [items, setItems] = useState<IndexedTask[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newTaskText, setNewTaskText] = useState('')
  const [adding, setAdding] = useState(false)
  const [processing, setProcessing] = useState(false)
  const { refreshInboxCount } = useVaultStore()

  async function load() {
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-inbox')
      if (result && typeof result === 'object' && 'error' in result) {
        setError((result as { error: string }).error)
      } else if (result && typeof result === 'object' && 'tasks' in result) {
        setItems((result as { tasks: IndexedTask[] }).tasks)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCapture() {
    if (!newTaskText.trim()) return
    setAdding(true)
    try {
      await window.electronAPI.extensionBridge.invoke('task-vault:vault:capture', {
        text: newTaskText.trim(),
      })
      setNewTaskText('')
      await load()
      await refreshInboxCount()
    } finally {
      setAdding(false)
    }
  }

  async function handleDone() {
    await load()
    await refreshInboxCount()
  }

  if (isLoading) return <div className="inbox-view__loading">Loading inbox…</div>
  if (error) return <div className="inbox-view__error">{error}</div>

  return (
    <div className="inbox-view">
      <div className="inbox-view__header">
        <h2>Inbox</h2>
        <span className="inbox-view__count">
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="inbox-view__capture">
        <SmartTaskInput
          value={newTaskText}
          onChange={setNewTaskText}
          onSubmit={handleCapture}
          disabled={adding}
          autoFocus
        />
        <button
          className="inbox-view__capture-btn"
          onClick={handleCapture}
          disabled={adding || !newTaskText.trim()}
        >
          {adding ? '…' : 'Capture'}
        </button>
      </div>

      {items.length === 0 ? (
        <div className="inbox-view__empty">
          <p>Inbox is empty.</p>
          <p className="inbox-view__empty-hint">
            Capture new items above or via the Quick Capture shortcut.
          </p>
        </div>
      ) : processing ? (
        <div className="inbox-view__processor">
          <div className="inbox-view__processor-header">
            <span>Processing inbox (GTD clarify)…</span>
            <button className="inbox-view__back-btn" onClick={() => setProcessing(false)}>
              ← Back to list
            </button>
          </div>
          <InboxProcessor items={items} onDone={handleDone} />
        </div>
      ) : (
        <>
          <div className="inbox-view__actions-bar">
            <button className="inbox-view__process-btn" onClick={() => setProcessing(true)}>
              Process inbox (GTD clarify)
            </button>
          </div>
          <div className="inbox-view__list">
            {items.map((item) => (
              <InboxItem key={item.id} item={item} onRefresh={load} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function InboxItem({
  item,
  onRefresh,
}: {
  item: IndexedTask
  onRefresh: () => Promise<void>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [showFilePicker, setShowFilePicker] = useState(false)
  const { refreshInboxCount, loadToday } = useVaultStore()

  function rawText() {
    const parts = [item.text]
    if (item.project) parts.push(`@${item.project.replace(/ /g, '-')}`)
    if (item.context) parts.push(`+${item.context.replace(/ /g, '-')}`)
    if (item.area) parts.push(`#${item.area.replace(/ /g, '-')}`)
    if (item.dueDate) parts.push(`due:${item.dueDate}`)
    return parts.join(' ')
  }

  function fileToPrefilledQuery() {
    if (item.project) return item.project
    if (item.area) return item.area
    return ''
  }

  async function saveEdit() {
    if (!editText.trim()) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:edit-task', {
      taskId: item.id,
      text: editText.trim(),
    })
    setEditing(false)
    await onRefresh()
  }

  async function handleDelete() {
    if (!confirm(`Delete: "${item.text}"?`)) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:delete-task', {
      taskId: item.id,
    })
    await onRefresh()
    await refreshInboxCount()
  }

  async function handleSomeday() {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:process-inbox-item', {
      taskId: item.id,
      action: 'someday',
    })
    await onRefresh()
    await refreshInboxCount()
  }

  async function handleMoveToToday() {
    const today = new Date().toISOString().slice(0, 10)
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:process-inbox-item', {
      taskId: item.id,
      action: 'file',
      destination: `daily/${today}.md`,
    })
    await onRefresh()
    await refreshInboxCount()
    await loadToday()
  }

  async function handleFileTo(filePath: string) {
    setShowFilePicker(false)
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:process-inbox-item', {
      taskId: item.id,
      action: 'file',
      destination: filePath,
    })
    await onRefresh()
    await refreshInboxCount()
    await loadToday()
  }

  return (
    <div className="inbox-item">
      {editing ? (
        <div className="inbox-item__edit">
          <SmartTaskInput
            value={editText}
            onChange={setEditText}
            onSubmit={saveEdit}
            onCancel={() => setEditing(false)}
            autoFocus
          />
          <button className="tv-btn tv-btn--primary" onClick={saveEdit}>
            Save
          </button>
          <button className="tv-btn tv-btn--icon" onClick={() => setEditing(false)}>
            <X size={14} />
          </button>
        </div>
      ) : (
        <span
          className="inbox-item__text"
          onDoubleClick={() => {
            setEditText(rawText())
            setEditing(true)
          }}
          title="Double-click to edit"
        >
          {item.text}
          {item.project && (
            <span className="daily-log__tag daily-log__tag--project">@{item.project}</span>
          )}
          {item.context && (
            <span className="daily-log__tag daily-log__tag--context">+{item.context}</span>
          )}
          {item.area && <span className="daily-log__tag daily-log__tag--area">#{item.area}</span>}
          {item.dueDate && (
            <span className="daily-log__tag daily-log__tag--due">due:{item.dueDate}</span>
          )}
        </span>
      )}

      {!editing && (
        <div className="inbox-item__actions">
          <button
            className="inbox-item__promote-btn"
            onClick={handleMoveToToday}
            title="Move to Today's log"
          >
            → Today
          </button>
          <button
            className="inbox-item__promote-btn"
            onClick={() => setShowFilePicker((v) => !v)}
            title="File to project or area"
          >
            → File to…
          </button>
          <button className="inbox-item__btn" onClick={handleSomeday} title="Move to Someday">
            Someday
          </button>
          <button
            className="inbox-item__btn"
            onClick={() => {
              setEditText(rawText())
              setEditing(true)
            }}
            title="Edit"
          >
            <Pencil size={14} />
          </button>
          <button className="inbox-item__btn--delete" onClick={handleDelete} title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      )}

      {showFilePicker && (
        <FileToPicker
          prefilledQuery={fileToPrefilledQuery()}
          onSelect={handleFileTo}
          onClose={() => setShowFilePicker(false)}
        />
      )}
    </div>
  )
}
