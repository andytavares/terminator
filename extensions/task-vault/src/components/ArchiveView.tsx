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
import {
  Button,
  IconButton,
  SegmentedControl,
  Tab,
  TabList,
  TabPanel,
  TabsRoot,
} from '@terminator/extension-ui'

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
        <CheckCircle2 className="archive-task__status-icon archive-task__status-icon--done tm-icon" />
      )
    case 'cancelled':
      return (
        <MinusCircle className="archive-task__status-icon archive-task__status-icon--cancelled tm-icon" />
      )
    case 'migrated':
      return (
        <ArrowRightCircle className="archive-task__status-icon archive-task__status-icon--migrated tm-icon" />
      )
    case 'in-progress':
      return (
        <Timer className="archive-task__status-icon archive-task__status-icon--in-progress tm-icon" />
      )
    default:
      return (
        <Circle className="archive-task__status-icon archive-task__status-icon--open tm-icon" />
      )
  }
}

type ArchiveOutcome = { data?: ArchiveData } | { error: string }

async function fetchArchive(windowDays: number): Promise<ArchiveOutcome> {
  try {
    const result = await window.electronAPI.extensionBridge.invoke(
      'task-vault:vault:list-archive',
      {
        days: windowDays,
      }
    )
    if (result && typeof result === 'object' && 'error' in result) {
      return { error: (result as { error: string }).error }
    }
    if (result && typeof result === 'object') {
      const r = result as Partial<ArchiveData>
      return { data: { tasks: r.tasks ?? [], projects: r.projects ?? [], areas: r.areas ?? [] } }
    }
    return {}
  } catch (err) {
    return { error: String(err) }
  }
}

const ARCHIVE_WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
]

export function ArchiveView(): React.JSX.Element {
  const [data, setData] = useState<ArchiveData>({ tasks: [], projects: [], areas: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const [tab, setTab] = useState<'tasks' | 'projects' | 'areas'>('tasks')

  function applyOutcome(outcome: ArchiveOutcome) {
    if ('error' in outcome) setError(outcome.error)
    else if (outcome.data) setData(outcome.data)
    setIsLoading(false)
  }

  async function load(windowDays: number) {
    applyOutcome(await fetchArchive(windowDays))
  }

  useEffect(() => {
    void fetchArchive(days).then(applyOutcome)
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on('task-vault:push:index-updated', () => {
      void reload(days)
    })
    return unsub
  }, [days])

  function reload(windowDays: number): Promise<void> {
    setIsLoading(true)
    setError(null)
    return load(windowDays)
  }

  function changeWindow(newDays: number) {
    setDays(newDays)
    void reload(newDays)
  }

  async function restoreProject(filePath: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:update-project-status', {
      projectFilePath: filePath,
      status: 'active',
    })
    await reload(days)
  }

  async function deleteProject(filePath: string, name: string) {
    if (!confirm(`Permanently delete project "${name}"?`)) return
    await window.electronAPI.extensionBridge.invoke('task-vault:projects:delete', {
      projectFilePath: filePath,
    })
    await reload(days)
  }

  async function handleRestoreTask(taskId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:restore-task', { taskId })
    await reload(days)
  }

  async function handleDeleteTask(taskId: string, text: string) {
    if (!confirm(`Delete task: "${text}"?`)) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:delete-task', { taskId })
    await reload(days)
  }

  async function handleRestoreArea(areaName: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:restore-area', { areaName })
    await reload(days)
  }

  async function handleDeleteArea(areaName: string) {
    if (!confirm(`Permanently delete area "${areaName}"?`)) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:delete-area', {
      areaFilePath: areaName,
    })
    await reload(days)
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
        <SegmentedControl
          label="Show the last"
          size="sm"
          options={ARCHIVE_WINDOWS}
          value={String(days)}
          onChange={(value) => changeWindow(Number(value))}
        />
      </div>

      <TabsRoot selectedId={tab} onSelect={setTab}>
        <TabList label="Archive sections" className="archive-view__tabs">
          <Tab id="tasks" accessibleName={`Completed tasks, ${data.tasks.length}`}>
            Completed tasks<span className="tmui-tabs__count">{data.tasks.length}</span>
          </Tab>
          <Tab id="projects" accessibleName={`Archived projects, ${data.projects.length}`}>
            Archived projects<span className="tmui-tabs__count">{data.projects.length}</span>
          </Tab>
          <Tab id="areas" accessibleName={`Archived areas, ${data.areas.length}`}>
            Archived areas<span className="tmui-tabs__count">{data.areas.length}</span>
          </Tab>
        </TabList>

        <TabPanel id="tasks">
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
                    <h3 className="archive-view__section-title">
                      Migrated ({migratedTasks.length})
                    </h3>
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
        </TabPanel>

        <TabPanel id="projects">
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
                    <Button size="sm" onClick={() => restoreProject(project.filePath)}>
                      Restore to active
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => deleteProject(project.filePath, project.name)}
                    >
                      Delete permanently
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </TabPanel>

        <TabPanel id="areas">
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
                    <Button size="sm" onClick={() => void handleRestoreArea(area.name)}>
                      Restore to active
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void handleDeleteArea(area.name)}
                    >
                      Delete permanently
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </TabPanel>
      </TabsRoot>
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
        <IconButton
          icon={Undo2}
          label="Restore to open"
          size="sm"
          onClick={() => onRestore(task.id)}
        />
        <IconButton
          icon={Trash2}
          label="Delete permanently"
          size="sm"
          onClick={() => onDelete(task.id, task.text)}
        />
      </span>
    </div>
  )
}
