import React, { useEffect, useState } from 'react'
import {
  Archive,
  ArrowLeft,
  ArrowRightCircle,
  CheckCircle2,
  Circle,
  MinusCircle,
  Pencil,
  Timer,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { IndexedTask } from '../vault/types'
import { SmartTaskInput, invalidateSmartInputCache } from './SmartTaskInput'
import { useVaultStore } from '../stores/vault.store'
import { Button, IconButton } from '@terminator/extension-ui'
import { useIndexReload } from './vault-hooks'

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

type AreasOutcome = { areas: AreaData[] } | { error: string } | Record<string, never>

type StatusFilter = 'active' | 'archived'

type AreaActions = ReturnType<typeof useAreaActions>

type CreateArea = ReturnType<typeof useCreateArea>

interface HeaderProps {
  statusFilter: StatusFilter
  onFilter: (filter: StatusFilter) => void
  onNew: () => void
}

interface CardProps {
  area: AreaData
  actions: AreaActions
  onOpen: (area: AreaData) => void
}

interface DetailProps {
  area: AreaData
  actions: AreaActions
  onBack: () => void
  onRefresh: () => Promise<void>
  onNavToProject: (name: string) => void
}

type AreaTasks = ReturnType<typeof useAreaTasks>

interface TaskEditorProps {
  task: IndexedTask
  tasks: AreaTasks
  onDone: () => void
}

interface TaskRowProps {
  task: IndexedTask
  tasks: AreaTasks
  editing: boolean
  setEditingId: (id: string | null) => void
}

type Rename = ReturnType<typeof useRename>

interface ListProps {
  list: ReturnType<typeof useAreaList>
  form: CreateArea
  actions: AreaActions
  onOpen: (area: AreaData) => void
}

async function fetchAreas(status: StatusFilter): Promise<AreasOutcome> {
  try {
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:list-areas', {
      status,
    })
    if (!result || typeof result !== 'object') return {}
    if ('areas' in result) return { areas: (result as { areas: AreaData[] }).areas }
    if ('error' in result) return { error: (result as { error: string }).error }
    return {}
  } catch (err) {
    return { error: String(err) }
  }
}

function invoke(channel: string, payload?: unknown): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

/** The areas for the chosen status; quiet reloads keep the list on screen. */
function useAreaList() {
  const [areas, setAreas] = useState<AreaData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')

  function applyOutcome(outcome: AreasOutcome, silent: boolean) {
    if ('areas' in outcome) setAreas(outcome.areas)
    else if ('error' in outcome) setError(outcome.error)
    if (!silent) setIsLoading(false)
  }
  async function load(silent = false): Promise<void> {
    if (!silent) setIsLoading(true)
    setError(null)
    applyOutcome(await fetchAreas(statusFilter), silent)
  }
  function changeStatusFilter(filter: StatusFilter) {
    if (filter === statusFilter) return
    setStatusFilter(filter)
    setIsLoading(true)
    setError(null)
  }
  useEffect(() => {
    void fetchAreas(statusFilter).then((outcome) => applyOutcome(outcome, false))
  }, [statusFilter])
  useIndexReload(() => void load(true), [statusFilter])
  return { areas, isLoading, error, statusFilter, changeStatusFilter, load }
}

/**
 * The area open in the detail view, re-derived whenever the list or the requested
 * area changes: an area no longer listed (deleted or renamed) closes the detail.
 */
function useSelectedArea(areas: AreaData[], selectedAreaName: string | null) {
  const [selectedArea, setSelectedArea] = useState<AreaData | null>(null)
  const [syncedSource, setSyncedSource] = useState({ areas, selectedAreaName })
  if (syncedSource.areas !== areas || syncedSource.selectedAreaName !== selectedAreaName) {
    setSyncedSource({ areas, selectedAreaName })
    const next = reselect(selectedArea, areas, selectedAreaName)
    if (next !== undefined) setSelectedArea(next)
  }
  return { selectedArea, setSelectedArea }
}

/** The area to show after the list changed; undefined keeps the current choice. */
function reselect(
  current: AreaData | null,
  areas: AreaData[],
  requested: string | null
): AreaData | null | undefined {
  if (current) {
    const refreshed = areas.find((a) => a.name === current.name)
    if (refreshed) return refreshed
    if (areas.length > 0) return null
    return undefined
  }
  if (!requested || areas.length === 0) return undefined
  return areas.find((a) => a.name === requested)
}

/** Archive and delete, each confirmed first and followed by a reload. */
function useAreaActions(load: () => Promise<void>, closeIfOpen: (name: string) => void) {
  async function act(channel: string, payload: unknown, name: string) {
    await invoke(channel, payload)
    invalidateSmartInputCache()
    await load()
    closeIfOpen(name)
  }
  return {
    archive: async (name: string) => {
      if (
        !confirm(
          `Archive area "${name}"? This will archive the area, all its projects, and cancel all open tasks.`
        )
      )
        return
      await act('task-vault:vault:archive-area', { areaName: name }, name)
    },
    remove: async (name: string) => {
      if (!confirm(`Permanently delete area "${name}" and all its data? This cannot be undone.`))
        return
      await act('task-vault:vault:delete-area', { areaFilePath: name }, name)
    },
  }
}

/** The new-area form's state, and the create that closes it on success. */
function useCreateArea(load: () => Promise<void>) {
  const [creatingArea, setCreatingArea] = useState(false)
  const [newAreaName, setNewAreaName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function handleCreateArea() {
    if (!newAreaName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const result = await invoke('task-vault:vault:create-area', { name: newAreaName.trim() })
      if (result && typeof result === 'object' && 'error' in result) {
        const err = (result as { error: string }).error
        setCreateError(err === 'AREA_EXISTS' ? 'An area with that name already exists.' : err)
        return
      }
      setNewAreaName('')
      setCreatingArea(false)
      invalidateSmartInputCache()
      await load()
    } finally {
      setCreating(false)
    }
  }

  return {
    ...{ creatingArea, setCreatingArea, newAreaName, setNewAreaName },
    ...{ creating, createError, handleCreateArea },
  }
}

function CreateAreaForm({ form }: { form: CreateArea }): React.JSX.Element {
  return (
    <div className="areas-view__create-form">
      {form.createError && <div className="areas-view__create-error">{form.createError}</div>}
      <input
        autoFocus
        type="text"
        className="areas-view__create-input"
        value={form.newAreaName}
        onChange={(e) => form.setNewAreaName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void form.handleCreateArea()
          if (e.key === 'Escape') form.setCreatingArea(false)
        }}
        placeholder="Area name (e.g. health, finances, work)"
      />
      <Button
        variant="primary"
        onClick={form.handleCreateArea}
        disabled={form.creating || !form.newAreaName.trim()}
      >
        {form.creating ? '…' : 'Create'}
      </Button>
      <Button onClick={() => form.setCreatingArea(false)}>Cancel</Button>
    </div>
  )
}

function AreasHeader({ statusFilter, onFilter, onNew }: HeaderProps): React.JSX.Element {
  return (
    <div className="areas-view__header">
      <h2>Areas</h2>
      <div className="projects-browser__filter">
        {(['active', 'archived'] as const).map((f) => (
          <button
            key={f}
            className={`projects-browser__filter-btn${statusFilter === f ? ' projects-browser__filter-btn--active' : ''}`}
            onClick={() => onFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {statusFilter === 'active' && (
        <Button variant="primary" size="sm" onClick={onNew}>
          + New area
        </Button>
      )}
    </div>
  )
}

function percentDone(area: AreaData): string {
  if (area.taskCount <= 0) return '0%'
  return `${Math.round(((area.taskCount - area.openTaskCount) / area.taskCount) * 100)}%`
}

function CardProjects({ projects }: { projects: AreaProject[] }): React.JSX.Element {
  return (
    <div className="areas-view__card-projects">
      {projects.slice(0, 3).map((p) => (
        <span key={p.id} className="areas-view__card-project-chip">
          {`@${p.name}`}
          {p.nextActionCount > 0 && (
            <span className="areas-view__card-project-actions">{p.nextActionCount}</span>
          )}
        </span>
      ))}
      {projects.length > 3 && (
        <span className="areas-view__card-project-chip areas-view__card-project-chip--more">
          {`+${projects.length - 3}`}
        </span>
      )}
    </div>
  )
}

function CardStats({ area }: { area: AreaData }): React.JSX.Element {
  const projects = area.projects ?? []
  return (
    <div>
      <div className="areas-view__card-stats">
        <span className="areas-view__open-count">{area.openTaskCount}</span>
        <span className="areas-view__total-count">/ {area.taskCount} tasks</span>
        {projects.length > 0 && (
          <span className="areas-view__project-count">
            · {projects.length} project{projects.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="areas-view__card-progress">
        <div className="areas-view__card-progress-fill" style={{ width: percentDone(area) }} />
      </div>
      {projects.length > 0 && <CardProjects projects={projects} />}
    </div>
  )
}

/** An area card: archive while active, delete once archived. */
function AreaCard({ area, actions, onOpen }: CardProps): React.JSX.Element {
  const archived = area.status === 'archived'
  return (
    <div
      role="button"
      tabIndex={0}
      className="areas-view__card"
      onClick={() => onOpen(area)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(area)}
    >
      <div className="areas-view__card-name">{area.name}</div>
      <CardStats area={area} />
      <IconButton
        icon={archived ? Trash2 : Archive}
        label={archived ? 'Delete area permanently' : 'Archive area'}
        size="sm"
        className="areas-view__card-delete"
        onClick={(e) => {
          e.stopPropagation()
          void (archived ? actions.remove(area.name) : actions.archive(area.name))
        }}
      />
    </div>
  )
}

function NoAreas(): React.JSX.Element {
  return (
    <div className="areas-view__empty">
      <p>No areas yet.</p>
      <p>Areas are ongoing responsibilities (health, finances, work, home…)</p>
    </div>
  )
}

function AreaList(props: ListProps): React.JSX.Element {
  const { list, form, actions, onOpen } = props
  return (
    <div className="areas-view">
      <AreasHeader
        statusFilter={list.statusFilter}
        onFilter={list.changeStatusFilter}
        onNew={() => form.setCreatingArea(true)}
      />
      {form.creatingArea && <CreateAreaForm form={form} />}
      {list.areas.length === 0 && !form.creatingArea ? (
        <NoAreas />
      ) : (
        <div className="areas-view__grid">
          {list.areas.map((area) => (
            <AreaCard key={area.filePath} area={area} actions={actions} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

export function AreasView(): React.JSX.Element {
  const list = useAreaList()
  const { navToProject, selectedAreaName } = useVaultStore()
  const { selectedArea, setSelectedArea } = useSelectedArea(list.areas, selectedAreaName)
  const closeIfOpen = (name: string) => selectedArea?.name === name && setSelectedArea(null)
  const actions = useAreaActions(list.load, closeIfOpen)
  const form = useCreateArea(list.load)
  if (list.isLoading) return <div className="areas-view__loading">Loading areas…</div>
  if (list.error) return <div className="areas-view__error">{list.error}</div>
  if (!selectedArea) {
    return <AreaList list={list} form={form} actions={actions} onOpen={setSelectedArea} />
  }
  const back = () => {
    setSelectedArea(null)
    void list.load()
  }
  return (
    <AreaDetail
      area={selectedArea}
      actions={actions}
      onBack={back}
      onRefresh={list.load}
      onNavToProject={navToProject}
    />
  )
}

const isDone = (t: IndexedTask) =>
  t.status === 'done' || t.status === 'cancelled' || t.status === 'migrated'

/** The area's own tasks, kept in step with the list after every change. */
function useAreaTasks(area: AreaData, onRefresh: () => Promise<void>) {
  const { tickCalendar } = useVaultStore()
  const [tasks, setTasks] = useState<IndexedTask[]>(area.tasks)

  async function reloadTasks() {
    const result = await invoke('task-vault:vault:list-areas')
    if (result && typeof result === 'object' && 'areas' in result) {
      const updated = (result as { areas: AreaData[] }).areas.find(
        (a) => a.filePath === area.filePath
      )
      if (updated) setTasks(updated.tasks)
    }
    await onRefresh()
    tickCalendar()
  }

  const then = async (channel: string, payload: unknown) => {
    await invoke(channel, payload)
    await reloadTasks()
  }
  return {
    tasks,
    reloadTasks,
    complete: (taskId: string) => then('task-vault:vault:complete-task', { taskId }),
    restore: (taskId: string) => then('task-vault:vault:restore-task', { taskId }),
  }
}

/** Task text tagged with the area, unless it already carries the tag. */
function tagWithArea(text: string, areaName: string): string {
  const slug = areaName.replace(/ /g, '-')
  if (text.toLowerCase().includes(`#${slug.toLowerCase()}`)) return text
  return `${text} #${slug}`
}

function useAddTask(area: AreaData, tasks: AreaTasks) {
  const [newTaskText, setNewTaskText] = useState('')
  const [adding, setAdding] = useState(false)
  async function add() {
    if (!newTaskText.trim()) return
    setAdding(true)
    try {
      await invoke('task-vault:vault:add-task', {
        filePath: `areas/${area.name}.md`,
        text: tagWithArea(newTaskText.trim(), area.name),
      })
      setNewTaskText('')
      await tasks.reloadTasks()
    } finally {
      setAdding(false)
    }
  }
  return { newTaskText, setNewTaskText, adding, add }
}

function AddAreaTask({ area, tasks }: { area: AreaData; tasks: AreaTasks }): React.JSX.Element {
  const { newTaskText, setNewTaskText, adding, add } = useAddTask(area, tasks)
  return (
    <div className="area-detail__add-row">
      <SmartTaskInput
        autoFocus
        value={newTaskText}
        onChange={setNewTaskText}
        onSubmit={add}
        placeholder="Add task to this area…"
        disabled={adding}
      />
      <Button
        variant="primary"
        className="area-detail__add-btn"
        onClick={add}
        disabled={adding || !newTaskText.trim()}
      >
        Add
      </Button>
    </div>
  )
}

/** A task's text with its tags written back out, for editing. */
function taggedText(task: IndexedTask): string {
  const parts = [task.text]
  if (task.project) parts.push(`@${task.project}`)
  if (task.context) parts.push(`+${task.context}`)
  if (task.area) parts.push(`#${task.area}`)
  if (task.dueDate) parts.push(`due:${task.dueDate}`)
  return parts.join(' ')
}

const STATUS_ICONS: Record<string, LucideIcon> = {
  done: CheckCircle2,
  migrated: ArrowRightCircle,
  cancelled: MinusCircle,
  'in-progress': Timer,
}

function TaskStatusIcon(props: { status: string }): React.JSX.Element {
  const known = Object.hasOwn(STATUS_ICONS, props.status)
  const Icon = known ? STATUS_ICONS[props.status] : Circle
  const modifier = known ? props.status : 'open'
  return <Icon className={`task-status task-status--${modifier} tm-icon-lg`} />
}

function AreaTaskEditor({ task, tasks, onDone }: TaskEditorProps): React.JSX.Element {
  const [editText, setEditText] = useState(() => taggedText(task))
  async function save() {
    if (!editText.trim()) return
    await invoke('task-vault:vault:edit-task', { taskId: task.id, text: editText.trim() })
    onDone()
    await tasks.reloadTasks()
  }
  return (
    <span className="area-detail__task-edit">
      <SmartTaskInput
        autoFocus
        value={editText}
        onChange={setEditText}
        onSubmit={() => void save()}
        onCancel={onDone}
      />
      <Button variant="primary" size="sm" onClick={() => void save()}>
        Save
      </Button>
      <IconButton icon={X} label="Cancel edit" size="sm" onClick={onDone} />
    </span>
  )
}

function AreaTaskText(props: { task: IndexedTask; onEdit: () => void }): React.JSX.Element {
  const { task } = props
  const done = isDone(task)
  return (
    <span
      className={`area-detail__task-text${done ? ' area-detail__task-text--done' : ''}`}
      onDoubleClick={() => !done && props.onEdit()}
      title={!done ? 'Double-click to edit' : undefined}
    >
      {task.text}
      {task.project && (
        <span className="daily-log__tag daily-log__tag--project">{`@${task.project}`}</span>
      )}
      {task.context && (
        <span className="daily-log__tag daily-log__tag--context">{`+${task.context}`}</span>
      )}
      {task.dueDate && (
        <span className="daily-log__tag daily-log__tag--due">{`due:${task.dueDate}`}</span>
      )}
    </span>
  )
}

function AreaTaskRow(props: TaskRowProps): React.JSX.Element {
  const { task, tasks, editing, setEditingId } = props
  const done = isDone(task)
  return (
    <div className={`area-detail__task${done ? ' area-detail__task--done' : ''}`}>
      <button
        className="daily-log__task-checkbox"
        onClick={() => void (done ? tasks.restore(task.id) : tasks.complete(task.id))}
        title={done ? 'Restore' : 'Complete'}
      >
        <TaskStatusIcon status={task.status} />
      </button>
      {editing ? (
        <AreaTaskEditor task={task} tasks={tasks} onDone={() => setEditingId(null)} />
      ) : (
        <AreaTaskText task={task} onEdit={() => setEditingId(task.id)} />
      )}
    </div>
  )
}

function AreaTaskList({ tasks }: { tasks: AreaTasks }): React.JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  if (tasks.tasks.length === 0) return <p className="area-detail__empty">No tasks in this area.</p>
  return (
    <div className="area-detail__tasks">
      {tasks.tasks.map((task) => (
        <AreaTaskRow
          key={task.id}
          task={task}
          tasks={tasks}
          editing={editingId === task.id}
          setEditingId={setEditingId}
        />
      ))}
    </div>
  )
}

/** Renames the area; an unchanged or empty name just closes the editor. */
function useRename(area: AreaData, onRefresh: () => Promise<void>) {
  const [renamingArea, setRenamingArea] = useState(false)
  const [renameText, setRenameText] = useState(area.name)
  const [renameError, setRenameError] = useState<string | null>(null)
  const open = () => {
    setRenameText(area.name)
    setRenamingArea(true)
  }
  const cancel = () => {
    setRenamingArea(false)
    setRenameText(area.name)
  }
  async function save() {
    const trimmed = renameText.trim()
    if (!trimmed || trimmed === area.name) return setRenamingArea(false)
    setRenameError(null)
    const result = (await invoke('task-vault:vault:rename-area', {
      areaFilePath: area.filePath,
      newName: trimmed,
    })) as { error?: string } | undefined
    if (result && 'error' in result) return setRenameError(result.error ?? 'Rename failed')
    setRenamingArea(false)
    invalidateSmartInputCache()
    await onRefresh()
  }
  return { renamingArea, renameText, setRenameText, renameError, open, cancel, save }
}

function RenameRow({ rename }: { rename: Rename }): React.JSX.Element {
  return (
    <div className="area-detail__rename-row">
      <input
        autoFocus
        className="area-detail__rename-input"
        value={rename.renameText}
        onChange={(e) => rename.setRenameText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void rename.save()
          if (e.key === 'Escape') rename.cancel()
        }}
      />
      <Button variant="primary" size="sm" onClick={() => void rename.save()}>
        Save
      </Button>
      <IconButton icon={X} label="Cancel rename" size="sm" onClick={rename.cancel} />
      {rename.renameError && (
        <span className="area-detail__rename-error">{rename.renameError}</span>
      )}
    </div>
  )
}

function AreaTitle({ area, rename }: { area: AreaData; rename: Rename }): React.JSX.Element {
  return (
    <h2>
      {area.name}
      {area.status === 'archived' && (
        <span className="projects-browser__archived-badge tv-ml-2">archived</span>
      )}
      <IconButton
        icon={Pencil}
        label="Rename area"
        size="sm"
        className="area-detail__rename-btn"
        onClick={rename.open}
      />
    </h2>
  )
}

/** Archive while the area is active; delete once it is archived. */
function AreaStatusButton({ area, actions }: { area: AreaData; actions: AreaActions }) {
  if (area.status !== 'archived') {
    return (
      <Button size="sm" onClick={() => void actions.archive(area.name)} title="Archive area">
        Archive area
      </Button>
    )
  }
  return (
    <Button
      variant="danger"
      size="sm"
      onClick={() => void actions.remove(area.name)}
      title="Delete area permanently"
    >
      Delete area
    </Button>
  )
}

function DetailHeader(props: DetailProps): React.JSX.Element {
  const { area } = props
  const rename = useRename(area, props.onRefresh)
  return (
    <div className="area-detail__header">
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={props.onBack}>
        Areas
      </Button>
      {rename.renamingArea ? (
        <RenameRow rename={rename} />
      ) : (
        <AreaTitle area={area} rename={rename} />
      )}
      <AreaStatusButton area={area} actions={props.actions} />
    </div>
  )
}

function ProjectCard(props: { project: AreaProject; onOpen: (name: string) => void }) {
  const p = props.project
  const pct = p.totalTaskCount > 0 ? Math.round((p.doneTaskCount / p.totalTaskCount) * 100) : 0
  return (
    <div
      className="area-detail__project-card"
      onClick={() => props.onOpen(p.name)}
      style={{ cursor: 'pointer' }}
    >
      <div className="area-detail__project-header">
        <span className="area-detail__project-name">{`@${p.name}`}</span>
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
}

function AreaDetail(props: DetailProps): React.JSX.Element {
  const { area } = props
  const tasks = useAreaTasks(area, props.onRefresh)
  const projects = area.projects ?? []
  return (
    <div className="area-detail">
      <DetailHeader {...props} />
      <AddAreaTask area={area} tasks={tasks} />
      <AreaTaskList tasks={tasks} />
      {projects.length > 0 && (
        <section className="area-detail__projects">
          <h4>Projects ({projects.length})</h4>
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={props.onNavToProject} />
          ))}
        </section>
      )}
    </div>
  )
}
