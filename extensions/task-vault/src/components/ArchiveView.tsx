import React, { useEffect, useState } from 'react'
import {
  Trash2,
  CheckCircle2,
  MinusCircle,
  ArrowRightCircle,
  Circle,
  Timer,
  Undo2,
} from 'lucide-react'
import type { IndexedTask, IndexedProject } from '../vault/types'

interface ArchivedArea {
  id: string
  name: string
  updatedAt: string
}

interface ArchiveData {
  tasks: IndexedTask[]
  projects: IndexedProject[]
  areas: ArchivedArea[]
}

function ArchiveStatusIcon({ status }: { status: string }): React.JSX.Element {
  switch (status) {
    case 'done':
      return (
        <CheckCircle2
          size={14}
          className="archive-task__status-icon archive-task__status-icon--done"
        />
      )
    case 'cancelled':
      return (
        <MinusCircle
          size={14}
          className="archive-task__status-icon archive-task__status-icon--cancelled"
        />
      )
    case 'migrated':
      return (
        <ArrowRightCircle
          size={14}
          className="archive-task__status-icon archive-task__status-icon--migrated"
        />
      )
    case 'in-progress':
      return (
        <Timer
          size={14}
          className="archive-task__status-icon archive-task__status-icon--in-progress"
        />
      )
    default:
      return (
        <Circle size={14} className="archive-task__status-icon archive-task__status-icon--open" />
      )
  }
}

export function ArchiveView(): React.JSX.Element {
  const [data, setData] = useState<ArchiveData>({ tasks: [], projects: [], areas: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const [tab, setTab] = useState<'tasks' | 'projects' | 'areas'>('tasks')

  async function load(windowDays: number) {
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'task-vault:vault:list-archive',
        { days: windowDays }
      )
      if (result && typeof result === 'object' && 'error' in result) {
        setError((result as { error: string }).error)
      } else if (result && typeof result === 'object') {
        const r = result as Partial<ArchiveData>
        setData({ tasks: r.tasks ?? [], projects: r.projects ?? [], areas: r.areas ?? [] })
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load(days)
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on('task-vault:push:index-updated', () => {
      void load(days)
    })
    return unsub
  }, [days])

  function changeWindow(newDays: number) {
    setDays(newDays)
    load(newDays)
  }

  async function restoreProject(filePath: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:update-project-status', {
      projectFilePath: filePath,
      status: 'active',
    })
    await load(days)
  }

  async function deleteProject(filePath: string, name: string) {
    if (!confirm(`Permanently delete project "${name}"?`)) return
    await window.electronAPI.extensionBridge.invoke('task-vault:projects:delete', {
      projectFilePath: filePath,
    })
    await load(days)
  }

  async function handleRestoreTask(taskId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:restore-task', { taskId })
    await load(days)
  }

  async function handleDeleteTask(taskId: string, text: string) {
    if (!confirm(`Delete task: "${text}"?`)) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:delete-task', { taskId })
    await load(days)
  }

  async function handleRestoreArea(areaName: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:restore-area', { areaName })
    await load(days)
  }

  async function handleDeleteArea(areaName: string) {
    if (!confirm(`Permanently delete area "${areaName}"?`)) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:delete-area', {
      areaFilePath: areaName,
    })
    await load(days)
  }

  if (isLoading) return <div className="archive-view__loading">Loading archive…</div>
  if (error) return <div className="archive-view__error">{error}</div>

  const doneTasks = data.tasks.filter((t) => t.status === 'done')
  const cancelledTasks = data.tasks.filter((t) => t.status === 'cancelled')
  const migratedTasks = data.tasks.filter((t) => t.status === 'migrated')

  return (
    <div className="archive-view">
      <div className="archive-view__header">
        <h2>History</h2>
        <div className="archive-view__window-picker">
          <span>Show last:</span>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              className={`archive-view__window-btn${days === d ? ' archive-view__window-btn--active' : ''}`}
              onClick={() => changeWindow(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="archive-view__tabs">
        <button
          className={`archive-view__tab${tab === 'tasks' ? ' archive-view__tab--active' : ''}`}
          onClick={() => setTab('tasks')}
        >
          Completed Tasks ({data.tasks.length})
        </button>
        <button
          className={`archive-view__tab${tab === 'projects' ? ' archive-view__tab--active' : ''}`}
          onClick={() => setTab('projects')}
        >
          Archived Projects ({data.projects.length})
        </button>
        <button
          className={`archive-view__tab${tab === 'areas' ? ' archive-view__tab--active' : ''}`}
          onClick={() => setTab('areas')}
        >
          Archived Areas ({data.areas.length})
        </button>
      </div>

      {tab === 'tasks' && (
        <div className="archive-view__tasks">
          {data.tasks.length === 0 ? (
            <p className="archive-view__empty">No completed tasks in the last {days} days.</p>
          ) : (
            <>
              {doneTasks.length > 0 && (
                <section>
                  <h3 className="archive-view__section-title">Completed ({doneTasks.length})</h3>
                  {doneTasks.map((task) => (
                    <ArchiveTaskRow
                      key={task.id}
                      task={task}
                      onRestore={handleRestoreTask}
                      onDelete={handleDeleteTask}
                    />
                  ))}
                </section>
              )}
              {cancelledTasks.length > 0 && (
                <section>
                  <h3 className="archive-view__section-title">
                    Cancelled ({cancelledTasks.length})
                  </h3>
                  {cancelledTasks.map((task) => (
                    <ArchiveTaskRow
                      key={task.id}
                      task={task}
                      onRestore={handleRestoreTask}
                      onDelete={handleDeleteTask}
                    />
                  ))}
                </section>
              )}
              {migratedTasks.length > 0 && (
                <section>
                  <h3 className="archive-view__section-title">Migrated ({migratedTasks.length})</h3>
                  {migratedTasks.map((task) => (
                    <ArchiveTaskRow
                      key={task.id}
                      task={task}
                      onRestore={handleRestoreTask}
                      onDelete={handleDeleteTask}
                    />
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'projects' && (
        <div className="archive-view__projects">
          {data.projects.length === 0 ? (
            <p className="archive-view__empty">No archived projects.</p>
          ) : (
            data.projects.map((project) => (
              <div key={project.id} className="archive-view__project-card">
                <div className="archive-view__project-header">
                  <span className="archive-view__project-name">{project.name}</span>
                  {project.area && (
                    <span className="archive-view__project-area">#{project.area}</span>
                  )}
                  <span className="archive-view__project-date">
                    {new Date(project.lastModified).toLocaleDateString()}
                  </span>
                </div>
                <div className="archive-view__project-actions">
                  <button
                    className="archive-view__restore-btn"
                    onClick={() => restoreProject(project.filePath)}
                  >
                    Restore to active
                  </button>
                  <button
                    className="archive-view__delete-btn"
                    onClick={() => deleteProject(project.filePath, project.name)}
                  >
                    Delete permanently
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'areas' && (
        <div className="archive-view__projects">
          {data.areas.length === 0 ? (
            <p className="archive-view__empty">No archived areas.</p>
          ) : (
            data.areas.map((area) => (
              <div key={area.id} className="archive-view__project-card">
                <div className="archive-view__project-header">
                  <span className="archive-view__project-name">{area.name}</span>
                  <span className="archive-view__project-date">
                    {new Date(area.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="archive-view__project-actions">
                  <button
                    className="archive-view__restore-btn"
                    onClick={() => void handleRestoreArea(area.name)}
                  >
                    Restore to active
                  </button>
                  <button
                    className="archive-view__delete-btn"
                    onClick={() => void handleDeleteArea(area.name)}
                  >
                    Delete permanently
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function ArchiveTaskRow({
  task,
  onRestore,
  onDelete,
}: {
  task: IndexedTask
  onRestore: (taskId: string) => Promise<void>
  onDelete: (taskId: string, text: string) => Promise<void>
}): React.JSX.Element {
  const fileName = task.filePath.split('/').pop()?.replace('.md', '') ?? ''
  return (
    <div className="archive-task">
      <span className="archive-task__icon">
        <ArchiveStatusIcon status={task.status} />
      </span>
      <span className="archive-task__text">
        {task.text}
        {task.project && (
          <span className="daily-log__tag daily-log__tag--project">@{task.project}</span>
        )}
        {task.area && <span className="daily-log__tag daily-log__tag--area">#{task.area}</span>}
      </span>
      <span className="archive-task__meta">
        <span className="archive-task__file">{fileName}</span>
      </span>
      <span className="archive-task__actions">
        <button
          className="archive-task__restore-btn"
          onClick={() => onRestore(task.id)}
          title="Restore to open"
        >
          <Undo2 size={13} />
        </button>
        <button
          className="archive-task__delete-btn"
          onClick={() => onDelete(task.id, task.text)}
          title="Delete permanently"
        >
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  )
}
