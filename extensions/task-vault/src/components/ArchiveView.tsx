import React, { useEffect, useState } from 'react'
import {
  Trash2,
  CheckCircle2,
  MinusCircle,
  ArrowRightCircle,
  Circle,
  Timer,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import type { IndexedTask, IndexedProject } from '../vault/types'
import { useIndexReload } from './vault-hooks'
import {
  Button,
  IconButton,
  SegmentedControl,
  Tab,
  TabList,
  TabPanel,
  TabsRoot,
} from '@terminator/extension-ui'
import { invokeVault } from './daily-log-format'

interface ArchivedArea {
  id: string
  name: string
  updatedAt: string
}

type ArchiveOutcome = { data?: ArchiveData } | { error: string }

interface ArchiveData {
  tasks: IndexedTask[]
  projects: IndexedProject[]
  areas: ArchivedArea[]
}

/** The icon for each way a task ended; anything else shows as open. */
const STATUS_ICONS: Record<string, LucideIcon> = {
  done: CheckCircle2,
  cancelled: MinusCircle,
  migrated: ArrowRightCircle,
  'in-progress': Timer,
}

function ArchiveStatusIcon(props: { status: string }): React.JSX.Element {
  const { status } = props
  const known = Object.hasOwn(STATUS_ICONS, status)
  const Icon = known ? STATUS_ICONS[status] : Circle
  const modifier = known ? status : 'open'
  return (
    <Icon className={`archive-task__status-icon archive-task__status-icon--${modifier} tm-icon`} />
  )
}

function toArchiveData(r: Partial<ArchiveData>): ArchiveData {
  return { tasks: r.tasks ?? [], projects: r.projects ?? [], areas: r.areas ?? [] }
}

function archiveOutcomeOf(result: unknown): ArchiveOutcome {
  if (!result || typeof result !== 'object') return {}
  if ('error' in result) return { error: (result as { error: string }).error }
  return { data: toArchiveData(result as Partial<ArchiveData>) }
}

async function fetchArchive(windowDays: number): Promise<ArchiveOutcome> {
  try {
    const result = await window.electronAPI.extensionBridge.invoke(
      'task-vault:vault:list-archive',
      {
        days: windowDays,
      }
    )
    return archiveOutcomeOf(result)
  } catch (err) {
    return { error: String(err) }
  }
}

const ARCHIVE_WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
]

const EMPTY_ARCHIVE: ArchiveData = { tasks: [], projects: [], areas: [] }

type ArchiveTab = 'tasks' | 'projects' | 'areas'

/** What the archive's buttons do; each reloads the archive afterwards. */
interface ArchiveActions {
  restoreTask: (taskId: string) => Promise<void>
  deleteTask: (taskId: string, text: string) => Promise<void>
  restoreProject: (filePath: string) => Promise<void>
  deleteProject: (filePath: string, name: string) => Promise<void>
  restoreArea: (areaName: string) => Promise<void>
  deleteArea: (areaName: string) => Promise<void>
}

/** Builds the archive actions, each followed by `reload`. */
function archiveActions(reload: () => Promise<void>): ArchiveActions {
  const invokeAndReload = (channel: string, payload: unknown) =>
    invokeVault(channel, payload).then(reload)
  return {
    restoreTask: (taskId) => invokeAndReload('task-vault:vault:restore-task', { taskId }),
    deleteTask: async (taskId, text) => {
      if (!confirm(`Delete task: "${text}"?`)) return
      await invokeAndReload('task-vault:vault:delete-task', { taskId })
    },
    restoreProject: (filePath) =>
      invokeAndReload('task-vault:vault:update-project-status', {
        projectFilePath: filePath,
        status: 'active',
      }),
    deleteProject: async (filePath, name) => {
      if (!confirm(`Permanently delete project "${name}"?`)) return
      await invokeAndReload('task-vault:projects:delete', { projectFilePath: filePath })
    },
    restoreArea: (areaName) => invokeAndReload('task-vault:vault:restore-area', { areaName }),
    deleteArea: async (areaName) => {
      if (!confirm(`Permanently delete area "${areaName}"?`)) return
      await invokeAndReload('task-vault:vault:delete-area', { areaFilePath: areaName })
    },
  }
}

/** The archive for the chosen window, reloaded when the index changes. */
function useArchive() {
  const [data, setData] = useState<ArchiveData>(EMPTY_ARCHIVE)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)

  function applyArchiveOutcome(outcome: ArchiveOutcome) {
    if ('error' in outcome) setError(outcome.error)
    else if (outcome.data) setData(outcome.data)
    setIsLoading(false)
  }

  function reloadArchive(windowDays: number): Promise<void> {
    setIsLoading(true)
    setError(null)
    return fetchArchive(windowDays).then(applyArchiveOutcome)
  }

  useEffect(() => {
    void fetchArchive(days).then(applyArchiveOutcome)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useIndexReload(() => void reloadArchive(days), [days])
  const changeWindow = (newDays: number) => {
    setDays(newDays)
    void reloadArchive(newDays)
  }
  const actions = archiveActions(() => reloadArchive(days))
  return { data, isLoading, error, days, changeWindow, actions }
}

interface TaskSectionProps {
  title: string
  tasks: IndexedTask[]
  actions: ArchiveActions
}

function TaskSection({ title, tasks, actions }: TaskSectionProps): React.JSX.Element | null {
  if (tasks.length === 0) return null
  return (
    <section>
      <h3 className="archive-view__section-title">
        {title} ({tasks.length})
      </h3>
      {tasks.map((task) => (
        <ArchiveTaskRow
          key={task.id}
          task={task}
          onRestore={actions.restoreTask}
          onDelete={actions.deleteTask}
        />
      ))}
    </section>
  )
}

const TASK_SECTIONS = [
  { status: 'done', title: 'Completed' },
  { status: 'cancelled', title: 'Cancelled' },
  { status: 'migrated', title: 'Migrated' },
]

interface PanelProps {
  data: ArchiveData
  days: number
  actions: ArchiveActions
}

function TasksPanel({ data, days, actions }: PanelProps): React.JSX.Element {
  return (
    <div className="archive-view__tasks">
      {data.tasks.length === 0 && (
        <p className="archive-view__empty">No completed tasks in the last {days} days.</p>
      )}
      {TASK_SECTIONS.map(({ status, title }) => (
        <TaskSection
          key={status}
          title={title}
          tasks={data.tasks.filter((t) => t.status === status)}
          actions={actions}
        />
      ))}
    </div>
  )
}

interface CardProps {
  name: string
  area?: string
  date: string
  onRestore: () => void
  onDelete: () => void
}

function ArchivedCard(props: CardProps): React.JSX.Element {
  const { name, area, date, onRestore, onDelete } = props
  return (
    <div className="archive-view__project-card">
      <div className="archive-view__project-header">
        <span className="archive-view__project-name">{name}</span>
        {area && <span className="archive-view__project-area">#{area}</span>}
        <span className="archive-view__project-date">{new Date(date).toLocaleDateString()}</span>
      </div>
      <div className="archive-view__project-actions">
        <Button size="sm" onClick={onRestore}>
          Restore to active
        </Button>
        <Button variant="danger" size="sm" onClick={onDelete}>
          Delete permanently
        </Button>
      </div>
    </div>
  )
}

function ProjectsPanel({ data, actions }: PanelProps): React.JSX.Element {
  return (
    <div className="archive-view__projects">
      {data.projects.length === 0 && <p className="archive-view__empty">No archived projects.</p>}
      {data.projects.map((project) => (
        <ArchivedCard
          key={project.id}
          name={project.name}
          area={project.area}
          date={project.lastModified}
          onRestore={() => void actions.restoreProject(project.filePath)}
          onDelete={() => void actions.deleteProject(project.filePath, project.name)}
        />
      ))}
    </div>
  )
}

function AreasPanel({ data, actions }: PanelProps): React.JSX.Element {
  return (
    <div className="archive-view__projects">
      {data.areas.length === 0 && <p className="archive-view__empty">No archived areas.</p>}
      {data.areas.map((area) => (
        <ArchivedCard
          key={area.id}
          name={area.name}
          date={area.updatedAt}
          onRestore={() => void actions.restoreArea(area.name)}
          onDelete={() => void actions.deleteArea(area.name)}
        />
      ))}
    </div>
  )
}

function ArchiveTabs({ data }: { data: ArchiveData }): React.JSX.Element {
  return (
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
  )
}

function ArchiveHeader(props: { days: number; onChange: (days: number) => void }) {
  return (
    <div className="archive-view__header">
      <h2>History</h2>
      <SegmentedControl
        label="Show the last"
        size="sm"
        options={ARCHIVE_WINDOWS}
        value={String(props.days)}
        onChange={(value) => props.onChange(Number(value))}
      />
    </div>
  )
}

export function ArchiveView(): React.JSX.Element {
  const { data, isLoading, error, days, changeWindow, actions } = useArchive()
  const [tab, setTab] = useState<ArchiveTab>('tasks')
  if (isLoading) return <div className="archive-view__loading">Loading archive…</div>
  if (error) return <div className="archive-view__error">{error}</div>
  return (
    <div className="archive-view">
      <ArchiveHeader days={days} onChange={changeWindow} />
      <TabsRoot selectedId={tab} onSelect={setTab}>
        <ArchiveTabs data={data} />
        <TabPanel id="tasks">
          <TasksPanel data={data} days={days} actions={actions} />
        </TabPanel>
        <TabPanel id="projects">
          <ProjectsPanel data={data} days={days} actions={actions} />
        </TabPanel>
        <TabPanel id="areas">
          <AreasPanel data={data} days={days} actions={actions} />
        </TabPanel>
      </TabsRoot>
    </div>
  )
}

interface RowProps {
  task: IndexedTask
  onRestore: (taskId: string) => Promise<void>
  onDelete: (taskId: string, text: string) => Promise<void>
}

function TaskTags({ task }: { task: IndexedTask }): React.JSX.Element {
  return (
    <span className="archive-task__text">
      {task.text}
      {task.project && (
        <span className="daily-log__tag daily-log__tag--project">{`@${task.project}`}</span>
      )}
      {task.area && <span className="daily-log__tag daily-log__tag--area">{`#${task.area}`}</span>}
    </span>
  )
}

function ArchiveTaskRow({ task, onRestore, onDelete }: RowProps): React.JSX.Element {
  const fileName = task.filePath.split('/').pop()?.replace('.md', '') ?? ''
  return (
    <div className="archive-task">
      <span className="archive-task__icon">
        <ArchiveStatusIcon status={task.status} />
      </span>
      <TaskTags task={task} />
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
