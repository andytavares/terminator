import React, { useEffect, useRef, useState } from 'react'
import { Button, IconButton, useCloseOnOutsidePress } from '@terminator/extension-ui'
import { invoke } from '@terminator/extension-sdk/renderer'
import { DateTimePicker } from './DateTimePicker'
import {
  Zap,
  Pencil,
  Check,
  X,
  Trash2,
  Archive,
  Circle,
  CheckCircle2,
  MinusCircle,
  ArrowRightCircle,
  Timer,
  ChevronUp,
  type LucideIcon,
} from 'lucide-react'
import type { IndexedProject, IndexedTask } from '../vault/types'
import { useVaultStore } from '../stores/vault.store'
import { SmartTaskInput } from './SmartTaskInput'
import { useIndexReload, useRecordUsageOnMount } from './vault-hooks'
import { RenameRow, TaskTextEditor, useTaskTextDraft } from './inline-edits'
import { SessionOptions, useTerminalSessions } from './terminal-sessions'
import { countLabel } from '../utils/count-label'

interface AreaOption {
  name: string
  filePath: string
}

interface ComboOption {
  label: string
  value: string
  isCreate?: boolean
}

type StatusFilter = 'active' | 'archived' | 'all'

interface CreateProjectFormProps {
  onCreated: () => void
  onCancel: () => void
}

interface ComboKeys {
  open: boolean
  setOpen: (open: boolean) => void
  count: number
  setHighlighted: React.Dispatch<React.SetStateAction<number>>
  pick: () => void
}

interface ComboboxProps {
  value: string
  onChange: (v: string) => void
  existingAreas: AreaOption[]
}

interface PickerProps {
  open: boolean
  onSelect: (sessionId: string) => void
  onClose: () => void
}

interface NewProject {
  name: string
  area: string
  deadline: string
  outcome: string
}

type ProjectTasks = ReturnType<typeof useProjectTasks>

interface EditorProps {
  task: IndexedTask
  tasks: ProjectTasks
  onDone: () => void
}

interface OpenRowProps {
  task: IndexedTask
  tasks: ProjectTasks
  editing: boolean
  setEditingId: (id: string | null) => void
}

interface AreaBadgeProps {
  project: IndexedProject
  onUpdated: () => Promise<void>
}

type ProjectList = ReturnType<typeof useProjectList>

type RenameProject = ReturnType<typeof useRenameProject>

type DeadlineEditor = ReturnType<typeof useDeadlineEditor>

/** What the browser's cards share: the list, rename and deadline editors, and status changes. */
interface Browser {
  list: ProjectList
  rename: RenameProject
  deadline: DeadlineEditor
  selectedProjectName: string | null
  updateStatus: (filePath: string, status: string) => Promise<void>
  remove: (filePath: string, name: string) => Promise<void>
}

interface CardProps {
  project: IndexedProject
  browser: Browser
}

type Combo = ReturnType<typeof useCombobox>

type CreateForm = ReturnType<typeof useCreateProject>

type AreaEdit = ReturnType<typeof useAreaEdit>

function errorOf(result: unknown): string | null {
  if (result && typeof result === 'object' && 'error' in result) {
    return (result as { error: string }).error
  }
  return null
}

/** The areas a project can be filed under, as listed by the vault. */
async function fetchAreaOptions(): Promise<AreaOption[] | null> {
  const result = await invoke('task-vault:vault:list-areas')
  if (result && typeof result === 'object' && 'areas' in result) {
    return (result as { areas: AreaOption[] }).areas
  }
  return null
}

/** Creates the area first when no existing one has this name (any case). */
async function ensureArea(areaName: string, existing: AreaOption[]): Promise<void> {
  if (!areaName || existing.some((a) => a.name.toLowerCase() === areaName.toLowerCase())) return
  await invoke('task-vault:vault:create-area', { name: areaName })
}

/** Areas matching the typed value, plus a create option unless it names one exactly. */
function comboOptions(value: string, existingAreas: AreaOption[]): ComboOption[] {
  const query = value.toLowerCase()
  const options: ComboOption[] = existingAreas
    .filter((a) => a.name.toLowerCase().includes(query))
    .map((a) => ({ label: a.name, value: a.name }))
  const exact = existingAreas.some((a) => a.name.toLowerCase() === query)
  if (value.trim() && !exact) {
    options.push({ label: `Create area "${value.trim()}"`, value: value.trim(), isCreate: true })
  }
  return options
}

/** Arrow keys move the highlight, Enter picks it, Escape closes; closed, ArrowDown or Enter opens. */
function comboKeyHandler(k: ComboKeys) {
  return (e: React.KeyboardEvent) => {
    if (!k.open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') k.setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      k.setHighlighted((h) => Math.min(h + 1, k.count - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      k.setHighlighted((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      k.pick()
    } else if (e.key === 'Escape') {
      k.setOpen(false)
    }
  }
}

/** The combobox's open state and highlight, which resets whenever the value changes. */
function useCombobox({ value, onChange, existingAreas }: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [highlightedFor, setHighlightedFor] = useState(value)
  if (highlightedFor !== value) {
    setHighlightedFor(value)
    setHighlighted(0)
  }
  const options = comboOptions(value, existingAreas)
  const select = (opt: ComboOption) => {
    onChange(opt.value)
    setOpen(false)
  }
  const pick = () => options[highlighted] && select(options[highlighted])
  const onKeyDown = comboKeyHandler({
    open,
    setOpen,
    count: options.length,
    setHighlighted,
    pick,
  })
  return { open, setOpen, highlighted, setHighlighted, options, select, onKeyDown }
}

function comboOptionClass(opt: ComboOption, highlighted: boolean): string {
  let cls = 'area-combobox__option'
  if (highlighted) cls += ' area-combobox__option--highlighted'
  if (opt.isCreate) cls += ' area-combobox__option--create'
  return cls
}

function ComboList({ combo }: { combo: Combo }): React.JSX.Element | null {
  if (!combo.open || combo.options.length === 0) return null
  return (
    <ul className="area-combobox__dropdown">
      {combo.options.map((opt, i) => (
        <li
          key={opt.value + String(opt.isCreate)}
          className={comboOptionClass(opt, i === combo.highlighted)}
          onMouseDown={(e) => {
            e.preventDefault()
            combo.select(opt)
          }}
          onMouseEnter={() => combo.setHighlighted(i)}
        >
          {opt.label}
        </li>
      ))}
    </ul>
  )
}

/** Closes the list on a click outside the combobox. */
function useCloseOutside(containerRef: React.RefObject<HTMLDivElement | null>, combo: Combo): void {
  useCloseOnOutsidePress(containerRef, () => combo.setOpen(false), combo.open)
}

function AreaCombobox(props: ComboboxProps): React.JSX.Element {
  const combo = useCombobox(props)
  const containerRef = useRef<HTMLDivElement>(null)
  useCloseOutside(containerRef, combo)
  return (
    <div className="area-combobox" ref={containerRef}>
      <input
        type="text"
        value={props.value}
        onChange={(e) => {
          props.onChange(e.target.value)
          combo.setOpen(true)
        }}
        onFocus={() => combo.setOpen(true)}
        onKeyDown={combo.onKeyDown}
        placeholder="e.g. work"
        autoComplete="off"
      />
      <ComboList combo={combo} />
    </div>
  )
}

/** Picks one of the open terminal sessions, loaded while the picker is open. */
function ProjectLinkPicker({ open, onSelect, onClose }: PickerProps): React.JSX.Element {
  const { sessions, labelOf } = useTerminalSessions(open)
  if (sessions.length === 0) {
    return (
      <span className="projects-browser__link-picker">
        <span className="tv-text-muted-sm">No active sessions</span>
        <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
      </span>
    )
  }
  return (
    <span className="projects-browser__link-picker">
      <select autoFocus defaultValue="" onChange={(e) => onSelect(e.target.value)}>
        <SessionOptions sessions={sessions} labelOf={labelOf} placeholder="Select terminal…" />
      </select>
      <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
    </span>
  )
}

/** Whether the picker is open or the link made, and the link itself. */
function useLink(filePath: string) {
  const [linking, setLinking] = useState(false)
  const [linked, setLinked] = useState(false)
  async function linkProjectToSession(sessionId: string) {
    if (!sessionId) return
    await invoke('task-vault:links:create', { projectFilePath: filePath, targetId: sessionId })
    setLinked(true)
    setLinking(false)
  }
  return { linking, setLinking, linked, link: linkProjectToSession }
}

function LinkToTerminator({ filePath }: { filePath: string }): React.JSX.Element {
  const { linking, setLinking, linked, link } = useLink(filePath)
  if (linked) {
    return (
      <span className="projects-browser__linked-badge" title="Linked">
        <Zap className="tm-icon" />
      </span>
    )
  }
  if (!linking) {
    return (
      <Button size="sm" onClick={() => setLinking(true)} title="Link to terminal session">
        Link…
      </Button>
    )
  }
  return (
    <ProjectLinkPicker
      open={linking}
      onSelect={(id) => void link(id)}
      onClose={() => setLinking(false)}
    />
  )
}

/** The vault's areas, loaded once. */
function useAreaOptions() {
  const [existingAreas, setExistingAreas] = useState<AreaOption[]>([])
  useEffect(() => {
    fetchAreaOptions()
      .then((areas) => areas && setExistingAreas(areas))
      .catch(() => {})
  }, [])
  return existingAreas
}

/** The new-project form's fields, the areas it offers, and the create. */
function useCreateProject(onCreated: () => void) {
  const [fields, setFields] = useState<NewProject>({
    name: '',
    area: '',
    deadline: '',
    outcome: '',
  })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const existingAreas = useAreaOptions()
  const set = (key: keyof NewProject) => (value: string) =>
    setFields((f) => ({ ...f, [key]: value }))

  async function createFromForm() {
    if (!fields.name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const err = await requestCreateProject(fields, existingAreas)
      if (err) setError(err === 'PROJECT_EXISTS' ? 'A project with that name already exists.' : err)
      else onCreated()
    } finally {
      setCreating(false)
    }
  }
  return { fields, set, creating, error, existingAreas, create: createFromForm }
}

/** Creates the project (and its area when new); returns the error it answered with, if any. */
async function requestCreateProject(
  fields: NewProject,
  existing: AreaOption[]
): Promise<string | null> {
  const areaName = fields.area.trim()
  await ensureArea(areaName, existing)
  const result = await invoke('task-vault:projects:create', {
    name: fields.name.trim(),
    area: areaName || undefined,
    deadline: fields.deadline || undefined,
    outcome: fields.outcome.trim() || undefined,
  })
  return errorOf(result)
}

function ProjectFormField(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="create-project-form__field">
      <label>{props.label}</label>
      {props.children}
    </div>
  )
}

function NameAndOutcome({ form }: { form: CreateForm }): React.JSX.Element {
  const { fields, set } = form
  return (
    <>
      <ProjectFormField label="Name *">
        <input
          autoFocus
          type="text"
          value={fields.name}
          onChange={(e) => set('name')(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && form.create()}
          placeholder="Project name"
        />
      </ProjectFormField>
      <ProjectFormField label="Outcome">
        <input
          type="text"
          value={fields.outcome}
          onChange={(e) => set('outcome')(e.target.value)}
          placeholder="What does done look like?"
        />
      </ProjectFormField>
    </>
  )
}

function AreaAndDeadline({ form }: { form: CreateForm }): React.JSX.Element {
  const { fields, set } = form
  return (
    <div className="create-project-form__row">
      <ProjectFormField label="Area">
        <AreaCombobox
          value={fields.area}
          onChange={set('area')}
          existingAreas={form.existingAreas}
        />
      </ProjectFormField>
      <ProjectFormField label="Deadline">
        <DateTimePicker
          mode="date"
          value={fields.deadline}
          onChange={set('deadline')}
          className="dtp--full"
        />
      </ProjectFormField>
    </div>
  )
}

function CreateProjectForm({ onCreated, onCancel }: CreateProjectFormProps): React.JSX.Element {
  const form = useCreateProject(onCreated)
  return (
    <div className="create-project-form">
      <h3>New Project</h3>
      {form.error && <div className="create-project-form__error">{form.error}</div>}
      <NameAndOutcome form={form} />
      <AreaAndDeadline form={form} />
      <div className="create-project-form__actions">
        <Button
          variant="primary"
          size="sm"
          onClick={form.create}
          disabled={form.creating || !form.fields.name.trim()}
        >
          {form.creating ? 'Creating…' : 'Create project'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

const isDone = (t: IndexedTask) =>
  t.status === 'done' || t.status === 'cancelled' || t.status === 'migrated'

/** The tasks tagged with a project, loaded on first expand, and what can be done to them. */
function useProjectTasks(projectName: string) {
  const { tickCalendar } = useVaultStore()
  const [tasks, setTasks] = useState<IndexedTask[]>([])
  const [loaded, setLoaded] = useState(false)

  async function loadProjectTasks() {
    const result = await invoke('task-vault:projects:get-tasks', { projectName })
    if (result && typeof result === 'object' && 'tasks' in result) {
      setTasks((result as { tasks: IndexedTask[] }).tasks)
    }
    setLoaded(true)
  }
  const reloadProjectTasks = async () => {
    await loadProjectTasks()
    tickCalendar()
  }
  const invokeThenReload = async (channel: string, payload: unknown) => {
    await invoke(channel, payload)
    await reloadProjectTasks()
  }
  return {
    ...{ projectName, tasks, loaded, load: loadProjectTasks, reload: reloadProjectTasks },
    complete: (taskId: string) => invokeThenReload('task-vault:vault:complete-task', { taskId }),
    restore: (taskId: string) => invokeThenReload('task-vault:vault:restore-task', { taskId }),
  }
}

/** Task text tagged with the project, unless it already references it. */
function tagWithProject(text: string, projectName: string): string {
  const slug = projectName.replace(/ /g, '-')
  if (text.toLowerCase().includes(`@${slug.toLowerCase()}`)) return text
  return `${text} @${slug}`
}

function useAddProjectTask(tasks: ProjectTasks) {
  const { projectName } = tasks
  const [addingText, setAddingText] = useState('')
  const [adding, setAdding] = useState(false)
  async function addProjectTask() {
    if (!addingText.trim()) return
    setAdding(true)
    try {
      await invoke('task-vault:vault:add-task', {
        filePath: `projects/${projectName}.md`,
        text: tagWithProject(addingText.trim(), projectName),
      })
      setAddingText('')
      await tasks.reload()
    } finally {
      setAdding(false)
    }
  }
  return { addingText, setAddingText, adding, add: addProjectTask }
}

function AddProjectTask({ tasks }: { tasks: ProjectTasks }): React.JSX.Element {
  const { addingText, setAddingText, adding, add } = useAddProjectTask(tasks)
  return (
    <div className="projects-browser__add-task-row">
      <SmartTaskInput
        value={addingText}
        onChange={setAddingText}
        onSubmit={() => void add()}
        placeholder={`Add task to @${tasks.projectName}…`}
        disabled={adding}
      />
      <Button
        variant="primary"
        className="projects-browser__add-btn"
        onClick={() => void add()}
        disabled={adding || !addingText.trim()}
      >
        Add
      </Button>
    </div>
  )
}

const STATUS_ICONS: Record<string, LucideIcon> = {
  done: CheckCircle2,
  cancelled: MinusCircle,
  migrated: ArrowRightCircle,
  'in-progress': Timer,
}

function TaskStatusIcon({ task }: { task: IndexedTask }): React.JSX.Element {
  if (!Object.hasOwn(STATUS_ICONS, task.status)) {
    return <Circle className="daily-log__task-status-icon tm-icon-lg" />
  }
  const Icon = STATUS_ICONS[task.status]
  return (
    <Icon
      className={`daily-log__task-status-icon daily-log__task-status-icon--${task.status} tm-icon-lg`}
    />
  )
}

function ProjectTaskEditor({ task, tasks, onDone }: EditorProps): React.JSX.Element {
  const draft = useTaskTextDraft(task, onDone, tasks.reload)
  return <TaskTextEditor draft={draft} className="projects-browser__task-edit" saveSize="sm" />
}

function ProjectTaskText({ task, onEdit }: { task: IndexedTask; onEdit: () => void }) {
  return (
    <>
      <span
        className="projects-browser__task-text"
        onDoubleClick={onEdit}
        title="Double-click to edit"
      >
        {task.text}
        {task.area && (
          <span className="daily-log__tag daily-log__tag--area">{`#${task.area}`}</span>
        )}
      </span>
      <span className="projects-browser__task-file">
        {task.filePath.split('/').pop()?.replace('.md', '')}
      </span>
    </>
  )
}

function OpenTaskRow(props: OpenRowProps): React.JSX.Element {
  const { task, tasks } = props
  return (
    <div className="projects-browser__task-row">
      <button
        className="daily-log__task-checkbox"
        onClick={() => void tasks.complete(task.id)}
        title="Complete"
      >
        <TaskStatusIcon task={task} />
      </button>
      {props.editing ? (
        <ProjectTaskEditor task={task} tasks={tasks} onDone={() => props.setEditingId(null)} />
      ) : (
        <ProjectTaskText task={task} onEdit={() => props.setEditingId(task.id)} />
      )}
    </div>
  )
}

function DoneTasks({ done, tasks }: { done: IndexedTask[]; tasks: ProjectTasks }) {
  if (done.length === 0) return null
  return (
    <details className="projects-browser__done-tasks">
      <summary>{done.length} completed/cancelled</summary>
      {done.map((t) => (
        <div key={t.id} className="projects-browser__task-row projects-browser__task-row--done">
          <span className="daily-log__task-checkbox projects-browser__task-done-icon">
            <TaskStatusIcon task={t} />
          </span>
          <span className="projects-browser__task-text">{t.text}</span>
          <span className="projects-browser__task-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void tasks.restore(t.id)}
              title="Reopen on today's log"
            >
              ↩
            </Button>
          </span>
        </div>
      ))}
    </details>
  )
}

function ExpandedTaskList({ tasks, onHide }: { tasks: ProjectTasks; onHide: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const { projectName } = tasks
  return (
    <div className="projects-browser__task-list">
      <div className="projects-browser__task-list-header">
        <span>
          {countLabel(tasks.tasks.length, 'task')} tagged @{projectName}
        </span>
        <IconButton icon={ChevronUp} label="Hide tasks" onClick={onHide} />
      </div>
      <AddProjectTask tasks={tasks} />
      {tasks.tasks.length === 0 && (
        <div className="projects-browser__task-list-empty">No tasks tagged @{projectName}.</div>
      )}
      {tasks.tasks
        .filter((t) => !isDone(t))
        .map((t) => (
          <OpenTaskRow
            key={t.id}
            task={t}
            tasks={tasks}
            editing={editingId === t.id}
            setEditingId={setEditingId}
          />
        ))}
      <DoneTasks done={tasks.tasks.filter(isDone)} tasks={tasks} />
    </div>
  )
}

function ProjectTaskList({ projectName }: { projectName: string }): React.JSX.Element {
  const tasks = useProjectTasks(projectName)
  const [expanded, setExpanded] = useState(false)
  async function toggle() {
    if (!tasks.loaded) await tasks.load()
    setExpanded((v) => !v)
  }
  if (expanded) return <ExpandedTaskList tasks={tasks} onHide={() => setExpanded(false)} />
  const label = tasks.loaded
    ? `${countLabel(tasks.tasks.length, 'task')} tagged @${projectName}`
    : `Show tasks tagged @${projectName}`
  return (
    <Button variant="ghost" size="sm" onClick={toggle}>
      {label}
    </Button>
  )
}

/** Editing a project's area: the value, the areas offered, and the save. */
function useAreaEdit({ project, onUpdated }: AreaBadgeProps) {
  const [editing, setEditing] = useState(false)
  const [areaValue, setAreaValue] = useState(project.area ?? '')
  const [existingAreas, setExistingAreas] = useState<AreaOption[]>([])
  async function openEdit() {
    setAreaValue(project.area ?? '')
    setEditing(true)
    const areas = await fetchAreaOptions()
    if (areas) setExistingAreas(areas)
  }
  async function save() {
    const areaName = areaValue.trim()
    await ensureArea(areaName, existingAreas)
    await invoke('task-vault:projects:update-area', {
      projectFilePath: project.filePath,
      area: areaName || null,
    })
    setEditing(false)
    await onUpdated()
  }
  return { editing, setEditing, areaValue, setAreaValue, existingAreas, openEdit, save }
}

function AreaEditor({ edit }: { edit: AreaEdit }): React.JSX.Element {
  return (
    <span className="projects-browser__area-edit">
      <AreaCombobox
        value={edit.areaValue}
        onChange={edit.setAreaValue}
        existingAreas={edit.existingAreas}
      />
      <IconButton icon={Check} label="Save area" size="sm" onClick={() => void edit.save()} />
      <IconButton icon={X} label="Cancel" size="sm" onClick={() => edit.setEditing(false)} />
    </span>
  )
}

function AreaLink({ area, edit }: { area: string; edit: AreaEdit }): React.JSX.Element {
  const { navToArea } = useVaultStore()
  return (
    <span className="projects-browser__area-wrap">
      <span
        className="projects-browser__area"
        onClick={() => navToArea(area)}
        style={{ cursor: 'pointer' }}
        title={`Go to ${area} area`}
      >
        {`#${area}`}
      </span>
      <IconButton
        icon={Pencil}
        label="Change area"
        size="sm"
        onClick={() => void edit.openEdit()}
      />
    </span>
  )
}

function ProjectAreaBadge(props: AreaBadgeProps): React.JSX.Element {
  const edit = useAreaEdit(props)
  if (edit.editing) return <AreaEditor edit={edit} />
  if (props.project.area) return <AreaLink area={props.project.area} edit={edit} />
  return (
    <button
      className="projects-browser__area-assign-btn"
      onClick={() => void edit.openEdit()}
      title="Assign to area"
    >
      + area
    </button>
  )
}

async function fetchProjects(statusFilter: StatusFilter): Promise<IndexedProject[] | null> {
  const status = statusFilter === 'all' ? ['active', 'someday', 'archived'] : [statusFilter]
  const result = await invoke('task-vault:projects:list', { status })
  if (result && typeof result === 'object' && 'projects' in result) {
    return (result as { projects: IndexedProject[] }).projects
  }
  return null
}

/** The projects for the chosen status, reloaded when the index changes. */
function useProjectList() {
  const [projects, setProjects] = useState<IndexedProject[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  function applyProjects(loaded: IndexedProject[] | null) {
    if (loaded) setProjects(loaded)
    setIsLoading(false)
    setInitialized(true)
  }
  async function load(): Promise<void> {
    setIsLoading(true)
    applyProjects(await fetchProjects(statusFilter))
  }
  function changeStatusFilter(filter: StatusFilter) {
    if (filter === statusFilter) return
    setStatusFilter(filter)
    setIsLoading(true)
  }
  useEffect(() => {
    void fetchProjects(statusFilter).then(applyProjects)
  }, [statusFilter])
  useIndexReload(() => void load(), [statusFilter])
  return { projects, loading: isLoading && !initialized, statusFilter, changeStatusFilter, load }
}

/** Renames a project; returns the message to show when the rename was refused. */
async function requestRenameProject(from: string, to: string): Promise<string | null> {
  const err = errorOf(
    await invoke('task-vault:projects:rename', { projectFilePath: from, newName: to })
  )
  if (!err) return null
  if (err === 'PROJECT_EXISTS') return 'A project with that name already exists.'
  return err
}

/** Renaming one project at a time; a taken name is reported in place. */
function useRenameProject(load: () => Promise<void>) {
  const [renamingProject, setRenamingProject] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const start = (name: string) => {
    setRenameText(name)
    setRenamingProject(name)
    setRenameError(null)
  }
  const cancel = () => {
    setRenamingProject(null)
    setRenameError(null)
  }
  async function save() {
    if (!renamingProject || !renameText.trim()) return
    setRenameError(null)
    try {
      const refused = await requestRenameProject(renamingProject, renameText.trim())
      if (refused) return setRenameError(refused)
      setRenamingProject(null)
      await load()
    } catch (err) {
      setRenameError(String(err))
    }
  }
  return { renamingProject, renameText, setRenameText, renameError, start, cancel, save }
}

/** Editing one project's deadline at a time. */
function useDeadlineEditor(load: () => Promise<void>) {
  const [editingDeadlineProject, setEditingDeadlineProject] = useState<string | null>(null)
  const [deadlineValue, setDeadlineValue] = useState('')
  const start = (project: IndexedProject) => {
    setDeadlineValue(project.deadline ?? '')
    setEditingDeadlineProject(project.name)
  }
  async function save(projectName: string, value: string | null) {
    await invoke('task-vault:projects:update-deadline', {
      projectFilePath: projectName,
      deadline: value || null,
    })
    setEditingDeadlineProject(null)
    await load()
  }
  const cancel = () => setEditingDeadlineProject(null)
  return { editingDeadlineProject, deadlineValue, setDeadlineValue, start, save, cancel }
}

function useBrowser(): Browser {
  const list = useProjectList()
  const rename = useRenameProject(list.load)
  const deadline = useDeadlineEditor(list.load)
  const { selectedProjectName } = useVaultStore()
  async function updateStatus(filePath: string, status: string) {
    await invoke('task-vault:vault:update-project-status', { projectFilePath: filePath, status })
    await list.load()
  }
  async function remove(filePath: string, name: string) {
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return
    await invoke('task-vault:projects:delete', { projectFilePath: filePath })
    await list.load()
  }
  return { list, rename, deadline, selectedProjectName, updateStatus, remove }
}

function ProjectName({ project, browser }: CardProps): React.JSX.Element {
  if (browser.rename.renamingProject === project.name)
    return <RenameRow rename={browser.rename} scope="projects-browser" />
  return (
    <span className="projects-browser__name-wrap">
      <span className="projects-browser__name">{project.name}</span>
      <IconButton
        icon={Pencil}
        label="Rename project"
        size="sm"
        className="area-detail__rename-btn"
        onClick={() => browser.rename.start(project.name)}
      />
    </span>
  )
}

function DeadlineEdit({ project, browser }: CardProps): React.JSX.Element {
  const { deadline } = browser
  return (
    <span className="projects-browser__deadline-edit">
      <DateTimePicker
        mode="date"
        value={deadline.deadlineValue}
        onChange={deadline.setDeadlineValue}
      />
      <Button
        variant="primary"
        size="sm"
        onClick={() => void deadline.save(project.name, deadline.deadlineValue)}
      >
        Save
      </Button>
      {project.deadline && (
        <Button variant="ghost" size="sm" onClick={() => void deadline.save(project.name, null)}>
          Clear
        </Button>
      )}
      <IconButton icon={X} label="Cancel deadline edit" size="sm" onClick={deadline.cancel} />
    </span>
  )
}

function DeadlineControl({ project, browser }: CardProps): React.JSX.Element {
  const { deadline } = browser
  if (deadline.editingDeadlineProject === project.name) {
    return <DeadlineEdit project={project} browser={browser} />
  }
  if (project.deadline) {
    return (
      <button
        className="projects-browser__deadline"
        onClick={() => deadline.start(project)}
        title="Edit deadline"
      >
        due: {project.deadline}
      </button>
    )
  }
  return (
    <button
      className="projects-browser__deadline-add-btn"
      onClick={() => deadline.start(project)}
      title="Set deadline"
    >
      + due date
    </button>
  )
}

function CardHeader({ project, browser }: CardProps): React.JSX.Element {
  return (
    <div className="projects-browser__card-header">
      <ProjectName project={project} browser={browser} />
      {project.status === 'archived' && (
        <span className="projects-browser__archived-badge">archived</span>
      )}
      {project.status === 'someday' && (
        <span className="projects-browser__someday-badge">someday</span>
      )}
      <ProjectAreaBadge project={project} onUpdated={browser.list.load} />
      <DeadlineControl project={project} browser={browser} />
    </div>
  )
}

/** Archive while live; delete once archived. */
function CardFooter({ project, browser }: CardProps): React.JSX.Element {
  return (
    <div className="projects-browser__footer">
      {project.status !== 'archived' ? (
        <Button
          variant="danger"
          size="sm"
          icon={Archive}
          onClick={() => void browser.updateStatus(project.filePath, 'archived')}
        >
          Archive project
        </Button>
      ) : (
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          onClick={() => void browser.remove(project.filePath, project.name)}
        >
          Delete project
        </Button>
      )}
    </div>
  )
}

function projectCardClass(project: IndexedProject, selectedName: string | null): string {
  let cls = 'projects-browser__card'
  if (project.isStale) cls += ' projects-browser__card--stale'
  if (project.name === selectedName) cls += ' projects-browser__card--selected'
  return cls
}

function ProjectCard({ project, browser }: CardProps): React.JSX.Element {
  return (
    <div className={projectCardClass(project, browser.selectedProjectName)}>
      <CardHeader project={project} browser={browser} />
      <div className="projects-browser__stats">
        <span>{countLabel(project.nextActionCount, 'next action')}</span>
        <LinkToTerminator filePath={project.filePath} />
      </div>
      <ProjectTaskList projectName={project.name} />
      {project.isStale && project.status === 'active' && (
        <div className="projects-browser__stale-info">
          <span className="projects-browser__stale-badge">
            {project.nextActionCount === 0 ? 'no next action' : 'inactive'}
          </span>
        </div>
      )}
      {project.status === 'someday' && (
        <div className="projects-browser__stale-actions">
          <Button size="sm" onClick={() => void browser.updateStatus(project.filePath, 'active')}>
            Promote to active
          </Button>
        </div>
      )}
      <CardFooter project={project} browser={browser} />
    </div>
  )
}

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
]

function BrowserHeader({ list, onNew }: { list: ProjectList; onNew: () => void }) {
  return (
    <div className="projects-browser__header">
      <h2>Projects</h2>
      <div className="projects-browser__filter">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={`projects-browser__filter-btn${list.statusFilter === f.value ? ' projects-browser__filter-btn--active' : ''}`}
            onClick={() => list.changeStatusFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <Button variant="primary" size="sm" onClick={onNew}>
        + New project
      </Button>
    </div>
  )
}

export function ProjectsBrowser(): React.JSX.Element {
  useRecordUsageOnMount('view-projects')
  const browser = useBrowser()
  const { list } = browser
  const [showCreateForm, setShowCreateForm] = useState(false)
  if (list.loading) return <div className="projects-browser__loading">Loading projects…</div>
  const created = async () => {
    setShowCreateForm(false)
    await list.load()
  }
  return (
    <div className="projects-browser">
      <BrowserHeader list={list} onNew={() => setShowCreateForm(true)} />
      {showCreateForm && (
        <CreateProjectForm onCreated={created} onCancel={() => setShowCreateForm(false)} />
      )}
      {list.projects.length === 0 && !showCreateForm && (
        <p className="projects-browser__empty">
          {list.statusFilter === 'active' ? 'No active projects.' : 'No projects found.'}
        </p>
      )}
      {list.projects.map((project) => (
        <ProjectCard key={project.id} project={project} browser={browser} />
      ))}
    </div>
  )
}
