import React, { useEffect, useState } from 'react'
import {
  Pencil,
  X,
  Archive,
  CheckCircle2,
  Circle,
  ArrowRightCircle,
  MinusCircle,
  Timer,
} from 'lucide-react'
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
  status: string
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
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived'>('active')
  const { navToProject, selectedAreaName } = useVaultStore()
  const [creatingArea, setCreatingArea] = useState(false)
  const [newAreaName, setNewAreaName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function load(silent = false) {
    if (!silent) setIsLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'task-vault:vault:list-areas',
        { status: statusFilter }
      )
      if (result && typeof result === 'object' && 'areas' in result) {
        setAreas((result as { areas: AreaData[] }).areas)
      } else if (result && typeof result === 'object' && 'error' in result) {
        setError((result as { error: string }).error)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      if (!silent) setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [statusFilter])

  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on('task-vault:push:index-updated', () => {
      void load(true)
    })
    return unsub
  }, [statusFilter])

  useEffect(() => {
    if (selectedArea) {
      // Refresh the open detail view from the newly loaded list.
      // If the area is no longer in the list (deleted/renamed), close the detail.
      const refreshed = areas.find((a) => a.name === selectedArea.name)
      if (refreshed) {
        setSelectedArea(refreshed)
      } else if (areas.length > 0) {
        setSelectedArea(null)
      }
    } else if (selectedAreaName && areas.length > 0) {
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

  async function handleArchiveArea(name: string) {
    if (
      !confirm(
        `Archive area "${name}"? This will archive the area, all its projects, and cancel all open tasks.`
      )
    )
      return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:archive-area', {
      areaName: name,
    })
    invalidateSmartInputCache()
    await load()
    if (selectedArea?.name === name) setSelectedArea(null)
  }

  async function handleDeleteArea(name: string) {
    if (!confirm(`Permanently delete area "${name}" and all its data? This cannot be undone.`))
      return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:delete-area', {
      areaFilePath: name,
    })
    invalidateSmartInputCache()
    await load()
    if (selectedArea?.name === name) setSelectedArea(null)
  }

  if (isLoading) return <div className="areas-view__loading">Loading areas…</div>
  if (error) return <div className="areas-view__error">{error}</div>

  if (selectedArea) {
    return (
      <AreaDetail
        area={selectedArea}
        onBack={() => {
          setSelectedArea(null)
          void load()
        }}
        onArchive={() => void handleArchiveArea(selectedArea.name)}
        onDelete={() => void handleDeleteArea(selectedArea.name)}
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
        <div className="projects-browser__filter">
          {(['active', 'archived'] as const).map((f) => (
            <button
              key={f}
              className={`projects-browser__filter-btn${statusFilter === f ? ' projects-browser__filter-btn--active' : ''}`}
              onClick={() => setStatusFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {statusFilter === 'active' && (
          <button className="areas-view__create-btn" onClick={() => setCreatingArea(true)}>
            + New area
          </button>
        )}
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
              {area.status !== 'archived' ? (
                <button
                  className="areas-view__card-delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleArchiveArea(area.name)
                  }}
                  title="Archive area"
                >
                  <Archive size={14} />
                </button>
              ) : (
                <button
                  className="areas-view__card-delete areas-view__card-delete--danger"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleDeleteArea(area.name)
                  }}
                  title="Delete area permanently"
                >
                  <Trash2 size={14} />
                </button>
              )}
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
  onArchive,
  onDelete,
  onRefresh,
  onNavToProject,
}: {
  area: AreaData
  onBack: () => void
  onArchive: () => void
  onDelete: () => void
  onRefresh: () => Promise<void>
  onNavToProject: (name: string) => void
}): React.JSX.Element {
  const tickCalendar = useVaultStore((s) => s.tickCalendar)
  const [tasks, setTasks] = useState<IndexedTask[]>(area.tasks)
  const [newTaskText, setNewTaskText] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [renamingArea, setRenamingArea] = useState(false)
  const [renameText, setRenameText] = useState(area.name)
  const [renameError, setRenameError] = useState<string | null>(null)

  async function reloadTasks() {
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:list-areas')
    if (result && typeof result === 'object' && 'areas' in result) {
      const updated = (result as { areas: AreaData[] }).areas.find(
        (a) => a.filePath === area.filePath
      )
      if (updated) setTasks(updated.tasks)
    }
    await onRefresh()
    tickCalendar()
  }

  async function handleAddTask() {
    if (!newTaskText.trim()) return
    setAdding(true)
    try {
      const slug = area.name.replace(/ /g, '-')
      const text = newTaskText.trim()
      const taggedText = text.toLowerCase().includes(`#${slug.toLowerCase()}`)
        ? text
        : `${text} #${slug}`
      await window.electronAPI.extensionBridge.invoke('task-vault:vault:add-task', {
        filePath: `areas/${area.name}.md`,
        text: taggedText,
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

  async function handleRenameArea() {
    const trimmed = renameText.trim()
    if (!trimmed || trimmed === area.name) {
      setRenamingArea(false)
      return
    }
    setRenameError(null)
    const result = (await window.electronAPI.extensionBridge.invoke(
      'task-vault:vault:rename-area',
      { areaFilePath: area.filePath, newName: trimmed }
    )) as { error?: string } | undefined
    if (result && 'error' in result) {
      setRenameError(result.error ?? 'Rename failed')
    } else {
      setRenamingArea(false)
      invalidateSmartInputCache()
      await onRefresh()
    }
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

  function TaskStatusIcon({ status }: { status: string }): React.JSX.Element {
    switch (status) {
      case 'done':
        return <CheckCircle2 size={15} className="task-status task-status--done" />
      case 'migrated':
        return <ArrowRightCircle size={15} className="task-status task-status--migrated" />
      case 'cancelled':
        return <MinusCircle size={15} className="task-status task-status--cancelled" />
      case 'in-progress':
        return <Timer size={15} className="task-status task-status--in-progress" />
      default:
        return <Circle size={15} className="task-status task-status--open" />
    }
  }

  const isDone = (t: IndexedTask) =>
    t.status === 'done' || t.status === 'cancelled' || t.status === 'migrated'

  return (
    <div className="area-detail">
      <div className="area-detail__header">
        <button className="tv-btn tv-btn--ghost tv-btn--xs" onClick={onBack}>
          ← Areas
        </button>
        {renamingArea ? (
          <div className="area-detail__rename-row">
            <input
              className="area-detail__rename-input"
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRenameArea()
                if (e.key === 'Escape') {
                  setRenamingArea(false)
                  setRenameText(area.name)
                }
              }}
              autoFocus
            />
            <button
              className="tv-btn tv-btn--primary tv-btn--xs"
              onClick={() => void handleRenameArea()}
            >
              Save
            </button>
            <button
              className="tv-btn tv-btn--ghost tv-btn--xs"
              onClick={() => {
                setRenamingArea(false)
                setRenameText(area.name)
              }}
            >
              <X size={13} />
            </button>
            {renameError && <span className="area-detail__rename-error">{renameError}</span>}
          </div>
        ) : (
          <h2>
            {area.name}
            {area.status === 'archived' && (
              <span className="projects-browser__archived-badge tv-ml-2">archived</span>
            )}
            <button
              className="tv-btn tv-btn--ghost tv-btn--xs area-detail__rename-btn"
              onClick={() => {
                setRenameText(area.name)
                setRenamingArea(true)
              }}
              title="Rename area"
            >
              <Pencil size={12} />
            </button>
          </h2>
        )}
        {area.status !== 'archived' ? (
          <button className="area-detail__delete-btn" onClick={onArchive} title="Archive area">
            Archive area
          </button>
        ) : (
          <button
            className="area-detail__delete-btn area-detail__delete-btn--danger"
            onClick={onDelete}
            title="Delete area permanently"
          >
            Delete area
          </button>
        )}
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
          className="tv-btn tv-btn--primary area-detail__add-btn"
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
              className={`area-detail__task${isDone(task) ? ' area-detail__task--done' : ''}`}
            >
              <button
                className="daily-log__task-checkbox"
                onClick={() =>
                  isDone(task) ? void handleRestore(task.id) : void handleComplete(task.id)
                }
                title={isDone(task) ? 'Restore' : 'Complete'}
              >
                <TaskStatusIcon status={task.status} />
              </button>

              {editingId === task.id ? (
                <span className="area-detail__task-edit">
                  <SmartTaskInput
                    value={editText}
                    onChange={setEditText}
                    onSubmit={() => void handleEdit(task.id)}
                    onCancel={() => setEditingId(null)}
                    autoFocus
                  />
                  <button
                    className="tv-btn tv-btn--primary tv-btn--xs"
                    onClick={() => void handleEdit(task.id)}
                  >
                    Save
                  </button>
                  <button
                    className="tv-btn tv-btn--ghost tv-btn--xs"
                    onClick={() => setEditingId(null)}
                  >
                    <X size={13} />
                  </button>
                </span>
              ) : (
                <span
                  className={`area-detail__task-text${isDone(task) ? ' area-detail__task-text--done' : ''}`}
                  onDoubleClick={() => !isDone(task) && startEdit(task)}
                  title={!isDone(task) ? 'Double-click to edit' : undefined}
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
