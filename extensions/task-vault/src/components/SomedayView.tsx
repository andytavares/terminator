import React, { useEffect, useState } from 'react'
import { Trash2, CalendarCheck, FolderOpen, Zap } from 'lucide-react'
import type { IndexedTask, IndexedProject } from '../vault/types'

interface SomedayData {
  tasks: IndexedTask[]
  projects: IndexedProject[]
}

export function SomedayView(): React.JSX.Element {
  const [data, setData] = useState<SomedayData>({ tasks: [], projects: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'tasks' | 'projects'>('tasks')

  async function load() {
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'task-vault:vault:list-someday'
      )
      if (result && typeof result === 'object' && 'error' in result) {
        setError((result as { error: string }).error)
      } else if (result && typeof result === 'object') {
        setData(result as SomedayData)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleDoToday(taskId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:someday-to-today', { taskId })
    await load()
  }

  async function handleDelete(taskId: string, text: string) {
    if (!confirm(`Delete task: "${text}"?`)) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:delete-task', { taskId })
    await load()
  }

  async function handlePromoteProject(filePath: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:update-project-status', {
      projectFilePath: filePath,
      status: 'active',
    })
    await load()
  }

  async function handleArchiveProject(filePath: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:update-project-status', {
      projectFilePath: filePath,
      status: 'archived',
    })
    await load()
  }

  if (isLoading) return <div className="someday-view__loading">Loading someday…</div>
  if (error) return <div className="someday-view__error">{error}</div>

  return (
    <div className="someday-view">
      <div className="someday-view__header">
        <h2>Someday / Maybe</h2>
        <p className="someday-view__subtitle">
          Things you might do one day — not now, but not never.
        </p>
      </div>

      <div className="archive-view__tabs">
        <button
          className={`archive-view__tab${tab === 'tasks' ? ' archive-view__tab--active' : ''}`}
          onClick={() => setTab('tasks')}
        >
          Tasks ({data.tasks.length})
        </button>
        <button
          className={`archive-view__tab${tab === 'projects' ? ' archive-view__tab--active' : ''}`}
          onClick={() => setTab('projects')}
        >
          Projects ({data.projects.length})
        </button>
      </div>

      {tab === 'tasks' && (
        <div className="someday-view__list">
          {data.tasks.length === 0 ? (
            <p className="archive-view__empty">No someday tasks. Send tasks here from the Inbox.</p>
          ) : (
            data.tasks.map((task) => (
              <SomedayTaskRow
                key={task.id}
                task={task}
                onDoToday={handleDoToday}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      )}

      {tab === 'projects' && (
        <div className="someday-view__list">
          {data.projects.length === 0 ? (
            <p className="archive-view__empty">No someday projects.</p>
          ) : (
            data.projects.map((project) => (
              <div key={project.id} className="archive-view__project-card">
                <div className="archive-view__project-header">
                  <span className="archive-view__project-name">
                    <FolderOpen size={13} style={{ marginRight: 6, opacity: 0.6 }} />
                    {project.name}
                  </span>
                  {project.area && (
                    <span className="archive-view__project-area">#{project.area}</span>
                  )}
                </div>
                <div className="archive-view__project-actions">
                  <button
                    className="archive-view__restore-btn"
                    onClick={() => handlePromoteProject(project.filePath)}
                  >
                    Promote to active
                  </button>
                  <button
                    className="archive-view__delete-btn"
                    onClick={() => handleArchiveProject(project.filePath)}
                  >
                    Archive
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

function SomedayTaskRow({
  task,
  onDoToday,
  onDelete,
}: {
  task: IndexedTask
  onDoToday: (taskId: string) => Promise<void>
  onDelete: (taskId: string, text: string) => Promise<void>
}): React.JSX.Element {
  return (
    <div className="archive-task">
      <span className="archive-task__icon">
        <Zap size={14} className="archive-task__status-icon" style={{ opacity: 0.4 }} />
      </span>
      <span className="archive-task__text">
        {task.text}
        {task.project && (
          <span className="daily-log__tag daily-log__tag--project">@{task.project}</span>
        )}
        {task.area && <span className="daily-log__tag daily-log__tag--area">#{task.area}</span>}
        {task.context && (
          <span className="daily-log__tag daily-log__tag--context">+{task.context}</span>
        )}
      </span>
      <span className="archive-task__actions">
        <button
          className="archive-task__restore-btn"
          onClick={() => onDoToday(task.id)}
          title="Do today"
        >
          <CalendarCheck size={13} />
        </button>
        <button
          className="archive-task__delete-btn"
          onClick={() => onDelete(task.id, task.text)}
          title="Delete permanently"
        >
          <Trash2 size={13} />
        </button>
      </span>
    </div>
  )
}
