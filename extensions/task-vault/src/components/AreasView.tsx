import React, { useEffect, useState } from 'react'
import { Trash2, Pencil, Check, X } from 'lucide-react'
import type { IndexedTask } from '../vault/types'
import { SmartTaskInput, invalidateSmartInputCache } from './SmartTaskInput'
import { useVaultStore } from '../stores/vault.store'

interface AreaProject {
  id: string
  filePath: string
  name: string
  status: string
  nextActionCount: number
  totalTaskCount: number
  doneTaskCount: number
}

interface AreaData {
  filePath: string
  name: string
  taskCount: number
  openTaskCount: number
  tasks: IndexedTask[]
  projects?: AreaProject[]
}

export function AreasView(): React.JSX.Element {
  const [areas, setAreas] = useState<AreaData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedArea, setSelectedArea] = useState<AreaData | null>(null)
  const { navToProject, selectedAreaName } = useVaultStore()
  const [creatingArea, setCreatingArea] = useState(false)
  const [newAreaName, setNewAreaName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function load() {
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:list-areas')
      if (result && typeof result === 'object' && 'areas' in result) {
        setAreas((result as { areas: AreaData[] }).areas)
      } else if (result && typeof result === 'object' && 'error' in result) {
        setError((result as { error: string }).error)
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

  useEffect(() => {
    if (selectedAreaName && areas.length > 0) {
      const found = areas.find((a) => a.name === selectedAreaName)
      if (found) setSelectedArea(found)
    }
  }, [selectedAreaName, areas])

  async function handleCreateArea() {
    if (!newAreaName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'task-vault:vault:create-area',
        { name: newAreaName.trim() }
      )
      if (result && typeof result === 'object' && 'error' in result) {
        const err = (result as { error: string }).error
        setCreateError(err === 'AREA_EXISTS' ? 'An area with that name already exists.' : err)
      } else {
        setNewAreaName('')
        setCreatingArea(false)
        invalidateSmartInputCache()
        await load()
      }
    } finally {
      setCreating(false)
    }
  }

  async function handleDeleteArea(filePath: string, name: string) {
    if (!confirm(`Delete area "${name}"? This will delete the area file and all its tasks.`)) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:delete-area', {
      areaFilePath: filePath,
    })
    invalidateSmartInputCache()
    await load()
    if (selectedArea?.filePath === filePath) setSelectedArea(null)
  }

  if (isLoading) return <div className="areas-view__loading">Loading areas…</div>
  if (error) return <div className="areas-view__error">{error}</div>

  if (selectedArea) {
    return (
      <AreaDetail
        area={selectedArea}
        onBack={() => {
          setSelectedArea(null)
          load()
        }}
        onDelete={() => handleDeleteArea(selectedArea.filePath, selectedArea.name)}
        onRefresh={async () => {
          await load()
        }}
        onNavToProject={navToProject}
      />
    )
  }

  return (
    <div className="areas-view">
      <div className="areas-view__header">
        <h2>Areas</h2>
        <button className="areas-view__create-btn" onClick={() => setCreatingArea(true)}>
          + New area
        </button>
      </div>

      {creatingArea && (
        <div className="areas-view__create-form">
          {createError && <div className="areas-view__create-error">{createError}</div>}
          <input
            type="text"
            className="areas-view__create-input"
            value={newAreaName}
            onChange={(e) => setNewAreaName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateArea()
              if (e.key === 'Escape') setCreatingArea(false)
            }}
            placeholder="Area name (e.g. health, finances, work)"
            autoFocus
          />
          <button
            className="tv-btn tv-btn--primary"
            onClick={handleCreateArea}
            disabled={creating || !newAreaName.trim()}
          >
            {creating ? '…' : 'Create'}
          </button>
          <button className="tv-btn tv-btn--secondary" onClick={() => setCreatingArea(false)}>
            Cancel
          </button>
        </div>
      )}

      {areas.length === 0 && !creatingArea ? (
        <div className="areas-view__empty">
          <p>No areas yet.</p>
          <p>Areas are ongoing responsibilities (health, finances, work, home…)</p>
        </div>
      ) : (
        <div className="areas-view__grid">
          {areas.map((area) => (
            <div
              key={area.filePath}
              className="areas-view__card"
              onClick={() => setSelectedArea(area)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setSelectedArea(area)}
            >
              <div className="areas-view__card-name">{area.name}</div>
              <div>
                <div className="areas-view__card-stats">
                  <span className="areas-view__open-count">{area.openTaskCount}</span>
                  <span className="areas-view__total-count">/ {area.taskCount} tasks</span>
                  {area.projects && area.projects.length > 0 && (
                    <span className="areas-view__project-count">
                      · {area.projects.length} project{area.projects.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="areas-view__card-progress">
                  <div
                    className="areas-view__card-progress-fill"
                    style={{
                      width:
                        area.taskCount > 0
                          ? `${Math.round(((area.taskCount - area.openTaskCount) / area.taskCount) * 100)}%`
                          : '0%',
                    }}
                  />
                </div>
                {area.projects && area.projects.length > 0 && (
                  <div className="areas-view__card-projects">
                    {area.projects.slice(0, 3).map((p) => (
                      <span key={p.id} className="areas-view__card-project-chip">
                        @{p.name}
                        {p.nextActionCount > 0 && (
                          <span className="areas-view__card-project-actions">
                            {p.nextActionCount}
                          </span>
                        )}
                      </span>
                    ))}
                    {area.projects.length > 3 && (
                      <span className="areas-view__card-project-chip areas-view__card-project-chip--more">
                        +{area.projects.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <button
                className="areas-view__card-delete"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteArea(area.filePath, area.name)
                }}
                title="Delete area"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AreaDetail({
  area,
  onBack,
  onDelete,
  onRefresh,
  onNavToProject,
}: {
  area: AreaData
  onBack: () => void
  onDelete: () => void
  onRefresh: () => Promise<void>
  onNavToProject: (name: string) => void
}): React.JSX.Element {
  const [tasks, setTasks] = useState<IndexedTask[]>(area.tasks)
  const [newTaskText, setNewTaskText] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  async function reloadTasks() {
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:list-areas')
    if (result && typeof result === 'object' && 'areas' in result) {
      const updated = (result as { areas: AreaData[] }).areas.find(
        (a) => a.filePath === area.filePath
      )
      if (updated) setTasks(updated.tasks)
    }
    await onRefresh()
  }

  async function handleAddTask() {
    if (!newTaskText.trim()) return
    setAdding(true)
    try {
      await window.electronAPI.extensionBridge.invoke('task-vault:vault:add-task', {
        filePath: area.filePath,
        text: newTaskText.trim(),
      })
      setNewTaskText('')
      await reloadTasks()
    } finally {
      setAdding(false)
    }
  }

  async function handleComplete(taskId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:complete-task', { taskId })
    await reloadTasks()
  }

  async function handleCancel(taskId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:cancel-task', { taskId })
    await reloadTasks()
  }

  async function handleDelete(taskId: string, text: string) {
    if (!confirm(`Delete: "${text}"?`)) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:delete-task', { taskId })
    await reloadTasks()
  }

  async function handleEdit(taskId: string) {
    if (!editText.trim()) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:edit-task', {
      taskId,
      text: editText.trim(),
    })
    setEditingId(null)
    await reloadTasks()
  }

  async function handleRestore(taskId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:restore-task', { taskId })
    await reloadTasks()
  }

  function startEdit(task: IndexedTask) {
    const parts = [task.text]
    if (task.project) parts.push(`@${task.project}`)
    if (task.context) parts.push(`+${task.context}`)
    if (task.area) parts.push(`#${task.area}`)
    if (task.dueDate) parts.push(`due:${task.dueDate}`)
    setEditText(parts.join(' '))
    setEditingId(task.id)
  }

  const STATUS_ICON: Record<string, string> = {
    open: '[ ]',
    done: '[x]',
    cancelled: '[-]',
    migrated: '[>]',
    'in-progress': '[/]',
  }

  return (
    <div className="area-detail">
      <div className="area-detail__header">
        <button className="area-detail__back-btn" onClick={onBack}>
          ← Areas
        </button>
        <h2>{area.name}</h2>
        <button className="area-detail__delete-btn" onClick={onDelete} title="Delete area">
          Delete area
        </button>
      </div>

      <div className="area-detail__add-row">
        <SmartTaskInput
          value={newTaskText}
          onChange={setNewTaskText}
          onSubmit={handleAddTask}
          placeholder="Add task to this area…"
          disabled={adding}
          autoFocus
        />
        <button
          className="tv-btn tv-btn--primary"
          onClick={handleAddTask}
          disabled={adding || !newTaskText.trim()}
        >
          Add
        </button>
      </div>

      {tasks.length === 0 ? (
        <p className="area-detail__empty">No tasks in this area.</p>
      ) : (
        <div className="area-detail__tasks">
          {tasks.map((task) => (
            <div
              key={task.id}
              className={`area-detail__task${task.status === 'done' || task.status === 'cancelled' ? ' area-detail__task--done' : ''}`}
            >
              <span className="area-detail__task-status">{STATUS_ICON[task.status] ?? '[ ]'}</span>

              {editingId === task.id ? (
                <span className="area-detail__task-edit">
                  <SmartTaskInput
                    value={editText}
                    onChange={setEditText}
                    onSubmit={() => handleEdit(task.id)}
                    onCancel={() => setEditingId(null)}
                    autoFocus
                  />
                  <button className="tv-btn tv-btn--primary" onClick={() => handleEdit(task.id)}>
                    Save
                  </button>
                  <button className="tv-btn tv-btn--icon" onClick={() => setEditingId(null)}>
                    <X size={14} />
                  </button>
                </span>
              ) : (
                <span
                  className={`area-detail__task-text${task.status === 'done' || task.status === 'cancelled' ? ' area-detail__task-text--done' : ''}`}
                  onDoubleClick={() => task.status === 'open' && startEdit(task)}
                  title={task.status === 'open' ? 'Double-click to edit' : undefined}
                >
                  {task.text}
                  {task.project && (
                    <span className="daily-log__tag daily-log__tag--project">@{task.project}</span>
                  )}
                  {task.context && (
                    <span className="daily-log__tag daily-log__tag--context">+{task.context}</span>
                  )}
                  {task.dueDate && (
                    <span className="daily-log__tag daily-log__tag--due">due:{task.dueDate}</span>
                  )}
                </span>
              )}

              {editingId !== task.id && (
                <span className="area-detail__task-actions">
                  {task.status === 'open' && (
                    <>
                      <button
                        className="tv-btn tv-btn--outline"
                        onClick={() => handleComplete(task.id)}
                        title="Complete"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        className="tv-btn tv-btn--outline"
                        onClick={() => startEdit(task)}
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="tv-btn tv-btn--icon"
                        onClick={() => handleCancel(task.id)}
                        title="Cancel task"
                      >
                        <X size={14} />
                      </button>
                    </>
                  )}
                  {(task.status === 'done' || task.status === 'cancelled') && (
                    <button
                      className="tv-btn tv-btn--outline"
                      onClick={() => handleRestore(task.id)}
                      title="Restore to open"
                    >
                      ↩
                    </button>
                  )}
                  <button
                    className="tv-btn tv-btn--outline"
                    onClick={() => handleDelete(task.id, task.text)}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {area.projects && area.projects.length > 0 && (
        <section className="area-detail__projects">
          <h4>Projects ({area.projects.length})</h4>
          {area.projects.map((p) => {
            const pct =
              p.totalTaskCount > 0 ? Math.round((p.doneTaskCount / p.totalTaskCount) * 100) : 0
            return (
              <div
                key={p.id}
                className="area-detail__project-card"
                onClick={() => onNavToProject(p.name)}
                style={{ cursor: 'pointer' }}
              >
                <div className="area-detail__project-header">
                  <span className="area-detail__project-name">@{p.name}</span>
                  <span className="area-detail__project-meta">
                    {p.nextActionCount} open · {pct}% done
                  </span>
                </div>
                {p.totalTaskCount > 0 && (
                  <div className="areas-view__card-progress">
                    <div className="areas-view__card-progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
