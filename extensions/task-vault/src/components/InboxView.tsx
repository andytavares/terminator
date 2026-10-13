import React, { useEffect, useState } from 'react'
import { ArrowLeft, CalendarDays, Sunset, Trash2, X } from 'lucide-react'
import type { IndexedTask } from '../vault/types'
import { InboxProcessor } from './InboxProcessor'
import { SmartTaskInput } from './SmartTaskInput'
import { useVaultStore } from '../stores/vault.store'
import { useVaultDataStore } from '../stores/vault-data.store'
import { useIndexReload } from './vault-hooks'
import { Button, IconButton } from '@terminator/extension-ui'
import { invokeVault } from './daily-log-format'
import { localDate } from '../vault/recurrence'

type InboxOutcome = { tasks?: IndexedTask[] } | { error: string }

interface CaptureProps {
  onCaptured: () => Promise<void>
}

interface ProcessingProps {
  items: IndexedTask[]
  onBack: () => void
  onDone: () => Promise<void>
}

interface ListProps {
  items: IndexedTask[]
  onProcess: () => void
  onRefresh: () => Promise<void>
}

/** The list, or while processing, the clarify steps; empty inboxes show neither. */
interface BodyProps {
  items: IndexedTask[]
  load: () => Promise<void>
  processing: [boolean, (processing: boolean) => void]
}

interface ItemProps {
  item: IndexedTask
  onRefresh: () => Promise<void>
}

interface EditProps {
  item: IndexedTask
  initialText: string
  onDone: () => void
  onRefresh: () => Promise<void>
}

interface RowProps extends ItemProps {
  onEdit: () => void
}

async function fetchInbox(): Promise<InboxOutcome> {
  try {
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-inbox')
    if (result && typeof result === 'object' && 'error' in result) {
      return { error: (result as { error: string }).error }
    }
    if (result && typeof result === 'object' && 'tasks' in result) {
      return { tasks: (result as { tasks: IndexedTask[] }).tasks }
    }
    return {}
  } catch (err) {
    return { error: String(err) }
  }
}

/** The inbox items, reloaded on demand and whenever the index changes. Each load keeps the
 *  store's inboxCount in step, so the sidebar badge is right. */
function useInbox() {
  const [items, setItems] = useState<IndexedTask[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function applyInboxOutcome(outcome: InboxOutcome) {
    if ('error' in outcome) {
      setError(outcome.error)
    } else if (outcome.tasks) {
      setItems(outcome.tasks)
      useVaultDataStore.setState({ inboxCount: outcome.tasks.length })
    }
    setIsLoading(false)
    setInitialized(true)
  }

  async function load() {
    setIsLoading(true)
    setError(null)
    applyInboxOutcome(await fetchInbox())
  }

  useEffect(() => {
    void fetchInbox().then(applyInboxOutcome)
  }, [])
  useIndexReload(() => void load(), [])

  return { items, loading: isLoading && !initialized, error, load }
}

/** The capture row: typed text goes to the inbox. */
function useCapture({ onCaptured }: CaptureProps) {
  const [newTaskText, setNewTaskText] = useState('')
  const [adding, setAdding] = useState(false)

  async function handleCapture() {
    if (!newTaskText.trim()) return
    setAdding(true)
    try {
      await window.electronAPI.extensionBridge.invoke('task-vault:vault:capture', {
        text: newTaskText.trim(),
      })
      setNewTaskText('')
      await onCaptured()
    } finally {
      setAdding(false)
    }
  }

  return { newTaskText, setNewTaskText, adding, handleCapture }
}

function CaptureRow(props: CaptureProps): React.JSX.Element {
  const { newTaskText, setNewTaskText, adding, handleCapture } = useCapture(props)
  return (
    <div className="inbox-view__capture">
      <SmartTaskInput
        value={newTaskText}
        onChange={setNewTaskText}
        onSubmit={handleCapture}
        disabled={adding}
        autoFocus={true}
      />
      <Button variant="primary" onClick={handleCapture} disabled={adding || !newTaskText.trim()}>
        {adding ? '…' : 'Capture'}
      </Button>
    </div>
  )
}

function EmptyInbox(): React.JSX.Element {
  return (
    <div className="inbox-view__empty">
      <p>Inbox is empty.</p>
      <p className="inbox-view__empty-hint">
        Capture new items above or via the Quick Capture shortcut.
      </p>
    </div>
  )
}

const PROCESS_LABEL = 'Process inbox (GTD clarify)'
const PROCESSING_LABEL = 'Processing inbox (GTD clarify)…'

function ProcessingPane({ items, onBack, onDone }: ProcessingProps): React.JSX.Element {
  return (
    <div className="inbox-view__processor">
      <div className="inbox-view__processor-header">
        <span>{PROCESSING_LABEL}</span>
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>
          Back to list
        </Button>
      </div>
      <InboxProcessor items={items} onDone={onDone} />
    </div>
  )
}

function ItemList({ items, onProcess, onRefresh }: ListProps): React.JSX.Element {
  return (
    <>
      <div className="inbox-view__actions-bar">
        <Button onClick={onProcess}>{PROCESS_LABEL}</Button>
      </div>
      <div className="inbox-view__list">
        {items.map((item) => (
          <InboxItem key={item.id} item={item} onRefresh={onRefresh} />
        ))}
      </div>
    </>
  )
}

function InboxBody({ items, load, processing: mode }: BodyProps) {
  const [processing, setProcessing] = mode
  const { refreshInboxCount, loadToday, setView, loadSomeday } = useVaultStore()

  async function handleDone() {
    await refreshInboxCount()
    await loadSomeday()
    await loadToday()
    setView('daily')
  }

  if (items.length === 0) return <EmptyInbox />
  if (processing) {
    const backToInbox = () => {
      setProcessing(false)
      void load()
    }
    return <ProcessingPane items={items} onBack={backToInbox} onDone={handleDone} />
  }
  const process = async () => {
    await load()
    setProcessing(true)
  }
  return <ItemList items={items} onProcess={() => void process()} onRefresh={load} />
}

export function InboxView(): React.JSX.Element {
  const { items, loading, error, load } = useInbox()
  const processing = useState(false)
  const { refreshInboxCount } = useVaultStore()
  if (loading) return <div className="inbox-view__loading">Loading inbox…</div>
  if (error) return <div className="inbox-view__error">{error}</div>
  const captured = async () => {
    await load()
    await refreshInboxCount()
  }
  return (
    <div className="inbox-view">
      <div className="inbox-view__header">
        <h2>Inbox</h2>
        <span className="inbox-view__count">
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>
      <CaptureRow onCaptured={captured} />
      <InboxBody items={items} load={load} processing={processing} />
    </div>
  )
}

/** An item's text with its tags written back out, as it was typed. */
function rawText(item: IndexedTask): string {
  const parts = [item.text]
  if (item.project) parts.push(`@${item.project.replace(/ /g, '-')}`)
  if (item.context) parts.push(`+${item.context.replace(/ /g, '-')}`)
  if (item.area) parts.push(`#${item.area.replace(/ /g, '-')}`)
  if (item.dueDate) parts.push(`due:${item.dueDate}`)
  return parts.join(' ')
}

/** Delete, backlog and move-to-today for one inbox item, each refreshing what it touches. */
function useItemActions({ item, onRefresh }: ItemProps) {
  const { refreshInboxCount, loadSomeday, loadToday } = useVaultStore()
  const fileTo = async (payload: Record<string, unknown>, reload: () => Promise<void>) => {
    await invokeVault('task-vault:vault:process-inbox-item', { taskId: item.id, ...payload })
    await onRefresh()
    await refreshInboxCount()
    await reload()
  }
  return {
    remove: async () => {
      if (!confirm(`Delete: "${item.text}"?`)) return
      await invokeVault('task-vault:vault:delete-task', { taskId: item.id })
      await onRefresh()
      await refreshInboxCount()
    },
    toBacklog: () => fileTo({ action: 'someday' }, loadSomeday),
    toToday: () => fileTo({ action: 'file', destination: `daily/${localDate()}.md` }, loadToday),
  }
}

function ItemTags({ item }: { item: IndexedTask }): React.JSX.Element {
  return (
    <>
      {item.project && (
        <span className="daily-log__tag daily-log__tag--project">{`@${item.project}`}</span>
      )}
      {item.context && (
        <span className="daily-log__tag daily-log__tag--context">{`+${item.context}`}</span>
      )}
      {item.area && <span className="daily-log__tag daily-log__tag--area">{`#${item.area}`}</span>}
      {item.dueDate && (
        <span className="daily-log__tag daily-log__tag--due">{`due:${item.dueDate}`}</span>
      )}
    </>
  )
}

function ItemEditor(props: EditProps): React.JSX.Element {
  const { item, initialText, onDone, onRefresh } = props
  const [editText, setEditText] = useState(initialText)
  async function saveEdit() {
    if (!editText.trim()) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:edit-task', {
      taskId: item.id,
      text: editText.trim(),
    })
    onDone()
    await onRefresh()
  }
  return (
    <div className="inbox-item__edit">
      <SmartTaskInput
        value={editText}
        onChange={setEditText}
        onSubmit={saveEdit}
        onCancel={onDone}
        autoFocus={true}
      />
      <Button variant="primary" onClick={saveEdit}>
        Save
      </Button>
      <IconButton icon={X} label="Cancel edit" size="sm" onClick={onDone} />
    </div>
  )
}

function ItemRow(props: RowProps): React.JSX.Element {
  const { item, onEdit } = props
  const actions = useItemActions(props)
  return (
    <div className="inbox-item__row">
      <span className="inbox-item__text" onDoubleClick={onEdit} title="Double-click to edit">
        {item.text}
        <ItemTags item={item} />
      </span>
      <div className="inbox-item__actions">
        <IconButton icon={CalendarDays} label="Move to Today's log" onClick={actions.toToday} />
        <IconButton icon={Sunset} label="Move to backlog" onClick={actions.toBacklog} />
        <IconButton icon={Trash2} label="Delete" onClick={actions.remove} />
      </div>
    </div>
  )
}

function InboxItem(props: ItemProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  return (
    <div className="inbox-item">
      {editing ? (
        <ItemEditor
          item={props.item}
          onRefresh={props.onRefresh}
          initialText={rawText(props.item)}
          onDone={() => setEditing(false)}
        />
      ) : (
        <ItemRow item={props.item} onRefresh={props.onRefresh} onEdit={() => setEditing(true)} />
      )}
    </div>
  )
}
