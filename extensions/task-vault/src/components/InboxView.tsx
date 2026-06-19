import React, { useEffect, useState } from 'react'
import { Trash2, X, CalendarDays, Sunset } from 'lucide-react'
import type { IndexedTask } from '../vault/types'
import { InboxProcessor } from './InboxProcessor'
import { SmartTaskInput } from './SmartTaskInput'
import { useVaultStore } from '../stores/vault.store'
import { useVaultDataStore } from '../stores/vault-data.store'

export function InboxView(): React.JSX.Element {
  const [items, setItems] = useState<IndexedTask[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newTaskText, setNewTaskText] = useState('')
  const [adding, setAdding] = useState(false)
  const [processing, setProcessing] = useState(false)
  const { refreshInboxCount, loadToday, setView, loadSomeday } = useVaultStore()

  async function load() {
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-inbox')
      if (result && typeof result === 'object' && 'error' in result) {
        setError((result as { error: string }).error)
      } else if (result && typeof result === 'object' && 'tasks' in result) {
        const tasks = (result as { tasks: IndexedTask[] }).tasks
        setItems(tasks)
        // Keep the store's inboxCount in sync so the sidebar badge is always accurate
        useVaultDataStore.setState({ inboxCount: tasks.length })
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
      setInitialized(true)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on('task-vault:push:index-updated', () => {
      void load()
    })
    return unsub
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
    await refreshInboxCount()
    await loadSomeday()
    await loadToday()
    setView('daily')
  }

  if (isLoading && !initialized) return <div className="inbox-view__loading">Loading inbox…</div>
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
            <button
              className="tv-btn tv-btn--ghost tv-btn--xs"
              onClick={() => {
                setProcessing(false)
                void load()
              }}
            >
              ← Back to list
            </button>
          </div>
          <InboxProcessor items={items} onDone={handleDone} />
        </div>
      ) : (
        <>
          <div className="inbox-view__actions-bar">
            <button
              className="inbox-view__process-btn"
              onClick={async () => {
                await load()
                setProcessing(true)
              }}
            >
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
  const { refreshInboxCount, loadSomeday, loadToday } = useVaultStore()

  function rawText() {
    const parts = [item.text]
    if (item.project) parts.push(`@${item.project.replace(/ /g, '-')}`)
    if (item.context) parts.push(`+${item.context.replace(/ /g, '-')}`)
    if (item.area) parts.push(`#${item.area.replace(/ /g, '-')}`)
    if (item.dueDate) parts.push(`due:${item.dueDate}`)
    return parts.join(' ')
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
    await loadSomeday()
  }

  async function handleMoveToToday() {
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:process-inbox-item', {
      taskId: item.id,
      action: 'file',
      destination: `daily/${today}.md`,
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
          <button className="tv-btn tv-btn--outline" onClick={() => setEditing(false)}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="inbox-item__row">
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
          <div className="inbox-item__actions">
            <button
              className="tv-btn tv-btn--outline tv-btn--action-icon"
              onClick={handleMoveToToday}
              title="Move to Today's log"
            >
              <CalendarDays size={13} />
            </button>
            <button
              className="tv-btn tv-btn--outline tv-btn--action-icon"
              onClick={handleSomeday}
              title="Move to backlog"
            >
              <Sunset size={13} />
            </button>
            <button
              className="tv-btn tv-btn--outline tv-btn--action-icon inbox-item__btn--delete"
              onClick={handleDelete}
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
