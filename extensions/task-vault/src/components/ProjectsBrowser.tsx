import React, { useEffect, useRef, useState } from 'react'
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
} from 'lucide-react'
import type { IndexedProject, IndexedTask } from '../vault/types'
import { useVaultStore } from '../stores/vault.store'
import { SmartTaskInput } from './SmartTaskInput'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'

interface AreaOption {
  name: string
  filePath: string
}

function AreaCombobox({
  value,
  onChange,
  existingAreas,
}: {
  value: string
  onChange: (v: string) => void
  existingAreas: AreaOption[]
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const query = value.toLowerCase()
  const matches = existingAreas.filter((a) => a.name.toLowerCase().includes(query))
  const showCreate = value.trim() && !existingAreas.some((a) => a.name.toLowerCase() === query)
  const options: Array<{ label: string; value: string; isCreate?: boolean }> = [
    ...matches.map((a) => ({ label: a.name, value: a.name })),
    ...(showCreate
      ? [{ label: `Create area "${value.trim()}"`, value: value.trim(), isCreate: true }]
      : []),
  ]

  useEffect(() => {
    setHighlighted(0)
  }, [value])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function select(opt: { value: string }) {
    onChange(opt.value)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((h) => Math.min(h + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (options[highlighted]) select(options[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="area-combobox" ref={containerRef}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="e.g. work"
        autoComplete="off"
      />
      {open && options.length > 0 && (
        <ul className="area-combobox__dropdown">
          {options.map((opt, i) => (
            <li
              key={opt.value + String(opt.isCreate)}
              className={`area-combobox__option${i === highlighted ? ' area-combobox__option--highlighted' : ''}${opt.isCreate ? ' area-combobox__option--create' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                select(opt)
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LinkToTerminator({ filePath }: { filePath: string }): React.JSX.Element {
  const [linking, setLinking] = useState(false)
  const [linked, setLinked] = useState(false)
  const [activeSessions, setActiveSessions] = useState<
    Array<{ sessionId: string; projectId: string; tabTitle: string }>
  >([])
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const projectsByWs = useWorkspaceStore((s) => s.projectsByWorkspaceId)

  useEffect(() => {
    if (!linking) return
    void window.electronAPI.terminal.listSessions?.().then((result) => {
      if (Array.isArray(result)) setActiveSessions(result)
    })
  }, [linking])

  function sessionLabel(s: { sessionId: string; tabTitle: string; projectId: string }): string {
    let project: { name: string; workspaceId: string } | undefined
    for (const [, projects] of projectsByWs) {
      project = projects.find((p) => p.id === s.projectId)
      if (project) break
    }
    const workspace = project ? workspaces.find((w) => w.id === project!.workspaceId) : undefined
    const parts: string[] = []
    if (workspace) parts.push(workspace.name)
    if (project) parts.push(project.name)
    if (s.tabTitle) parts.push(s.tabTitle)
    return parts.length ? parts.join(' › ') : s.sessionId.slice(0, 8)
  }

  async function handleSelect(sessionId: string) {
    if (!sessionId) return
    await window.electronAPI.extensionBridge.invoke('task-vault:links:create', {
      projectFilePath: filePath,
      targetId: sessionId,
    })
    setLinked(true)
    setLinking(false)
  }

  if (linked)
    return (
      <span className="projects-browser__linked-badge" title="Linked">
        <Zap size={14} />
      </span>
    )
  if (!linking)
    return (
      <button
        className="projects-browser__link-btn"
        onClick={() => setLinking(true)}
        title="Link to terminal session"
      >
        Link…
      </button>
    )

  if (activeSessions.length === 0)
    return (
      <span className="projects-browser__link-picker">
        <span className="tv-text-muted-sm">No active sessions</span>
        <button className="tv-btn tv-btn--icon" onClick={() => setLinking(false)}>
          <X size={14} />
        </button>
      </span>
    )

  return (
    <span className="projects-browser__link-picker">
      <select defaultValue="" onChange={(e) => void handleSelect(e.target.value)} autoFocus>
        <option value="" disabled>
          Select terminal…
        </option>
        {activeSessions.map((s) => (
          <option key={s.sessionId} value={s.sessionId}>
            {sessionLabel(s)}
          </option>
        ))}
      </select>
      <button className="tv-btn tv-btn--icon" onClick={() => setLinking(false)}>
        <X size={14} />
      </button>
    </span>
  )
}

interface CreateProjectFormProps {
  onCreated: () => void
  onCancel: () => void
}

function CreateProjectForm({ onCreated, onCancel }: CreateProjectFormProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [area, setArea] = useState('')
  const [deadline, setDeadline] = useState('')
  const [outcome, setOutcome] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingAreas, setExistingAreas] = useState<AreaOption[]>([])

  useEffect(() => {
    window.electronAPI.extensionBridge
      .invoke('task-vault:vault:list-areas')
      .then((result: unknown) => {
        if (result && typeof result === 'object' && 'areas' in result) {
          setExistingAreas((result as { areas: AreaOption[] }).areas)
        }
      })
      .catch(() => {})
  }, [])

  async function handleCreate() {
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const areaName = area.trim()
      // Create area if it doesn't already exist
      if (areaName && !existingAreas.some((a) => a.name.toLowerCase() === areaName.toLowerCase())) {
        await window.electronAPI.extensionBridge.invoke('task-vault:vault:create-area', {
          name: areaName,
        })
      }
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:projects:create', {
        name: name.trim(),
        area: areaName || undefined,
        deadline: deadline || undefined,
        outcome: outcome.trim() || undefined,
      })
      if (result && typeof result === 'object' && 'error' in result) {
        const err = (result as { error: string }).error
        setError(err === 'PROJECT_EXISTS' ? 'A project with that name already exists.' : err)
      } else {
        onCreated()
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="create-project-form">
      <h3>New Project</h3>
      {error && <div className="create-project-form__error">{error}</div>}
      <div className="create-project-form__field">
        <label>Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="Project name"
          autoFocus
        />
      </div>
      <div className="create-project-form__field">
        <label>Outcome</label>
        <input
          type="text"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          placeholder="What does done look like?"
        />
      </div>
      <div className="create-project-form__row">
        <div className="create-project-form__field">
          <label>Area</label>
          <AreaCombobox value={area} onChange={setArea} existingAreas={existingAreas} />
        </div>
        <div className="create-project-form__field">
          <label>Deadline</label>
          <DateTimePicker
            mode="date"
            value={deadline}
            onChange={setDeadline}
            className="dtp--full"
          />
        </div>
      </div>
      <div className="create-project-form__actions">
        <button
          className="create-project-form__create-btn"
          onClick={handleCreate}
          disabled={creating || !name.trim()}
        >
          {creating ? 'Creating…' : 'Create project'}
        </button>
        <button className="create-project-form__cancel-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function ProjectTaskList({ projectName }: { projectName: string }): React.JSX.Element {
  const tickCalendar = useVaultStore((s) => s.tickCalendar)
  const [tasks, setTasks] = useState<IndexedTask[]>([])
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [addingText, setAddingText] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  async function load() {
    const result = await window.electronAPI.extensionBridge.invoke(
      'task-vault:projects:get-tasks',
      { projectName }
    )
    if (result && typeof result === 'object' && 'tasks' in result) {
      setTasks((result as { tasks: IndexedTask[] }).tasks)
    }
    setLoaded(true)
  }

  async function toggle() {
    if (!loaded) await load()
    setExpanded((v) => !v)
  }

  async function handleComplete(taskId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:complete-task', { taskId })
    await load()
    tickCalendar()
  }

  async function handleRestore(taskId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:restore-task', { taskId })
    await load()
    tickCalendar()
  }

  async function handleSaveEdit(taskId: string) {
    if (!editText.trim()) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:edit-task', {
      taskId,
      text: editText.trim(),
    })
    setEditingId(null)
    await load()
    tickCalendar()
  }

  function startEdit(t: IndexedTask) {
    const parts = [t.text]
    if (t.project) parts.push(`@${t.project}`)
    if (t.context) parts.push(`+${t.context}`)
    if (t.area) parts.push(`#${t.area}`)
    if (t.dueDate) parts.push(`due:${t.dueDate}`)
    setEditText(parts.join(' '))
    setEditingId(t.id)
  }

  async function handleAddTask() {
    if (!addingText.trim()) return
    setAdding(true)
    try {
      const slug = projectName.replace(/ /g, '-')
      const text = addingText.trim()
      // Only append the tag if the text doesn't already reference this project
      const taggedText = text.toLowerCase().includes(`@${slug.toLowerCase()}`)
        ? text
        : `${text} @${slug}`
      await window.electronAPI.extensionBridge.invoke('task-vault:vault:add-task', {
        filePath: `projects/${projectName}.md`,
        text: taggedText,
      })
      setAddingText('')
      await load()
      tickCalendar()
    } finally {
      setAdding(false)
    }
  }

  if (!expanded) {
    return (
      <button
        className="tv-btn tv-btn--ghost tv-btn--xs projects-browser__tasks-toggle"
        onClick={toggle}
      >
        {loaded
          ? `${tasks.length} task${tasks.length !== 1 ? 's' : ''} tagged @${projectName}`
          : `Show tasks tagged @${projectName}`}
      </button>
    )
  }

  const isDone = (t: IndexedTask) =>
    t.status === 'done' || t.status === 'cancelled' || t.status === 'migrated'
  const openTasks = tasks.filter((t) => !isDone(t))
  const doneTasks = tasks.filter(isDone)

  function TaskStatusIcon({ task }: { task: IndexedTask }): React.JSX.Element {
    switch (task.status) {
      case 'done':
        return (
          <CheckCircle2
            size={15}
            className="daily-log__task-status-icon daily-log__task-status-icon--done"
          />
        )
      case 'cancelled':
        return (
          <MinusCircle
            size={15}
            className="daily-log__task-status-icon daily-log__task-status-icon--cancelled"
          />
        )
      case 'migrated':
        return (
          <ArrowRightCircle
            size={15}
            className="daily-log__task-status-icon daily-log__task-status-icon--migrated"
          />
        )
      case 'in-progress':
        return (
          <Timer
            size={15}
            className="daily-log__task-status-icon daily-log__task-status-icon--in-progress"
          />
        )
      default:
        return <Circle size={15} className="daily-log__task-status-icon" />
    }
  }

  return (
    <div className="projects-browser__task-list">
      <div className="projects-browser__task-list-header">
        <span>
          {tasks.length} task{tasks.length !== 1 ? 's' : ''} tagged @{projectName}
        </span>
        <button className="tv-btn tv-btn--ghost" onClick={() => setExpanded(false)}>
          ▲
        </button>
      </div>

      <div className="projects-browser__add-task-row">
        <SmartTaskInput
          value={addingText}
          onChange={setAddingText}
          onSubmit={() => void handleAddTask()}
          placeholder={`Add task to @${projectName}…`}
          disabled={adding}
        />
        <button
          className="tv-btn tv-btn--primary projects-browser__add-btn"
          onClick={() => void handleAddTask()}
          disabled={adding || !addingText.trim()}
        >
          Add
        </button>
      </div>

      {tasks.length === 0 && (
        <div className="projects-browser__task-list-empty">
          No tasks tagged @{projectName} across vault.
        </div>
      )}
      {openTasks.map((t) => (
        <div key={t.id} className="projects-browser__task-row">
          <button
            className="daily-log__task-checkbox"
            onClick={() => void handleComplete(t.id)}
            title="Complete"
          >
            <TaskStatusIcon task={t} />
          </button>
          {editingId === t.id ? (
            <span className="projects-browser__task-edit">
              <SmartTaskInput
                value={editText}
                onChange={setEditText}
                onSubmit={() => void handleSaveEdit(t.id)}
                onCancel={() => setEditingId(null)}
                autoFocus
              />
              <button
                className="tv-btn tv-btn--primary tv-btn--icon"
                onClick={() => void handleSaveEdit(t.id)}
              >
                <Check size={13} />
              </button>
              <button className="tv-btn tv-btn--icon" onClick={() => setEditingId(null)}>
                <X size={13} />
              </button>
            </span>
          ) : (
            <>
              <span
                className="projects-browser__task-text"
                onDoubleClick={() => startEdit(t)}
                title="Double-click to edit"
              >
                {t.text}
                {t.area && <span className="daily-log__tag daily-log__tag--area">#{t.area}</span>}
              </span>
              <span className="projects-browser__task-file">
                {t.filePath.split('/').pop()?.replace('.md', '')}
              </span>
            </>
          )}
        </div>
      ))}
      {doneTasks.length > 0 && (
        <details className="projects-browser__done-tasks">
          <summary>{doneTasks.length} completed/cancelled</summary>
          {doneTasks.map((t) => (
            <div key={t.id} className="projects-browser__task-row projects-browser__task-row--done">
              <span className="daily-log__task-checkbox projects-browser__task-done-icon">
                <TaskStatusIcon task={t} />
              </span>
              <span className="projects-browser__task-text">{t.text}</span>
              <span className="projects-browser__task-actions">
                <button
                  className="tv-btn tv-btn--ghost tv-btn--xs"
                  onClick={() => void handleRestore(t.id)}
                  title="Reopen on today's log"
                >
                  ↩
                </button>
              </span>
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

function ProjectAreaBadge({
  project,
  onUpdated,
}: {
  project: IndexedProject
  onUpdated: () => Promise<void>
}): React.JSX.Element {
  const { navToArea } = useVaultStore()
  const [editing, setEditing] = useState(false)
  const [areaValue, setAreaValue] = useState(project.area ?? '')
  const [existingAreas, setExistingAreas] = useState<AreaOption[]>([])

  async function openEdit() {
    setAreaValue(project.area ?? '')
    setEditing(true)
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:list-areas')
    if (result && typeof result === 'object' && 'areas' in result) {
      setExistingAreas((result as { areas: AreaOption[] }).areas)
    }
  }

  async function save() {
    const areaName = areaValue.trim()
    if (areaName && !existingAreas.some((a) => a.name.toLowerCase() === areaName.toLowerCase())) {
      await window.electronAPI.extensionBridge.invoke('task-vault:vault:create-area', {
        name: areaName,
      })
    }
    await window.electronAPI.extensionBridge.invoke('task-vault:projects:update-area', {
      projectFilePath: project.filePath,
      area: areaName || null,
    })
    setEditing(false)
    await onUpdated()
  }

  if (editing) {
    return (
      <span className="projects-browser__area-edit">
        <AreaCombobox value={areaValue} onChange={setAreaValue} existingAreas={existingAreas} />
        <button
          className="tv-btn tv-btn--icon tv-btn--accent-active"
          onClick={() => void save()}
          title="Save area"
        >
          <Check size={13} />
        </button>
        <button className="tv-btn tv-btn--icon" onClick={() => setEditing(false)} title="Cancel">
          <X size={13} />
        </button>
      </span>
    )
  }

  if (project.area) {
    return (
      <span className="projects-browser__area-wrap">
        <span
          className="projects-browser__area"
          onClick={() => navToArea(project.area!)}
          style={{ cursor: 'pointer' }}
          title={`Go to ${project.area} area`}
        >
          #{project.area}
        </span>
        <button
          className="projects-browser__area-edit-btn"
          onClick={() => void openEdit()}
          title="Change area"
        >
          <Pencil size={14} />
        </button>
      </span>
    )
  }

  return (
    <button
      className="projects-browser__area-assign-btn"
      onClick={() => void openEdit()}
      title="Assign to area"
    >
      + area
    </button>
  )
}

export function ProjectsBrowser(): React.JSX.Element {
  const [projects, setProjects] = useState<IndexedProject[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [renamingProject, setRenamingProject] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [editingDeadlineProject, setEditingDeadlineProject] = useState<string | null>(null)
  const [deadlineValue, setDeadlineValue] = useState('')
  const { selectedProjectName } = useVaultStore()

  async function load() {
    setIsLoading(true)
    const status = statusFilter === 'all' ? ['active', 'someday', 'archived'] : [statusFilter]
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:projects:list', {
      status,
    })
    if (result && typeof result === 'object' && 'projects' in result) {
      setProjects((result as { projects: IndexedProject[] }).projects)
    }
    setIsLoading(false)
    setInitialized(true)
  }

  useEffect(() => {
    load()
  }, [statusFilter])

  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on('task-vault:push:index-updated', () => {
      void load()
    })
    return unsub
  }, [statusFilter])

  async function handleUpdateStatus(filePath: string, status: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:update-project-status', {
      projectFilePath: filePath,
      status,
    })
    await load()
  }

  async function handleDelete(filePath: string, name: string) {
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return
    await window.electronAPI.extensionBridge.invoke('task-vault:projects:delete', {
      projectFilePath: filePath,
    })
    await load()
  }

  async function handleUpdateDeadline(projectName: string, value: string | null) {
    await window.electronAPI.extensionBridge.invoke('task-vault:projects:update-deadline', {
      projectFilePath: projectName,
      deadline: value || null,
    })
    setEditingDeadlineProject(null)
    await load()
  }

  async function handleRenameProject() {
    if (!renamingProject || !renameText.trim()) return
    setRenameError(null)
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:projects:rename', {
        projectFilePath: renamingProject,
        newName: renameText.trim(),
      })
      if (result && typeof result === 'object' && 'error' in result) {
        const err = (result as { error: string }).error
        setRenameError(err === 'PROJECT_EXISTS' ? 'A project with that name already exists.' : err)
      } else {
        setRenamingProject(null)
        await load()
      }
    } catch (err) {
      setRenameError(String(err))
    }
  }

  if (isLoading && !initialized)
    return <div className="projects-browser__loading">Loading projects…</div>

  return (
    <div className="projects-browser">
      <div className="projects-browser__header">
        <h2>Projects</h2>
        <div className="projects-browser__filter">
          {(['active', 'archived', 'all'] as const).map((f) => (
            <button
              key={f}
              className={`projects-browser__filter-btn${statusFilter === f ? ' projects-browser__filter-btn--active' : ''}`}
              onClick={() => setStatusFilter(f)}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <button className="projects-browser__create-btn" onClick={() => setShowCreateForm(true)}>
          + New project
        </button>
      </div>

      {showCreateForm && (
        <CreateProjectForm
          onCreated={async () => {
            setShowCreateForm(false)
            await load()
          }}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      {projects.length === 0 && !showCreateForm && (
        <p className="projects-browser__empty">
          {statusFilter === 'active' ? 'No active projects.' : 'No projects found.'}
        </p>
      )}

      {projects.map((project) => (
        <div
          key={project.id}
          className={`projects-browser__card${project.isStale ? ' projects-browser__card--stale' : ''}${project.name === selectedProjectName ? ' projects-browser__card--selected' : ''}`}
        >
          <div className="projects-browser__card-header">
            {renamingProject === project.name ? (
              <div className="area-detail__rename-row projects-browser__rename-row">
                <input
                  className="area-detail__rename-input projects-browser__rename-input"
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRenameProject()
                    if (e.key === 'Escape') {
                      setRenamingProject(null)
                      setRenameError(null)
                    }
                  }}
                  autoFocus
                />
                <button
                  className="tv-btn tv-btn--primary tv-btn--xs"
                  onClick={() => void handleRenameProject()}
                >
                  Save
                </button>
                <button
                  className="tv-btn tv-btn--ghost tv-btn--xs"
                  onClick={() => {
                    setRenamingProject(null)
                    setRenameError(null)
                  }}
                >
                  <X size={13} />
                </button>
                {renameError && <span className="area-detail__rename-error">{renameError}</span>}
              </div>
            ) : (
              <span className="projects-browser__name-wrap">
                <span className="projects-browser__name">{project.name}</span>
                <button
                  className="tv-btn tv-btn--ghost tv-btn--xs area-detail__rename-btn"
                  onClick={() => {
                    setRenameText(project.name)
                    setRenamingProject(project.name)
                    setRenameError(null)
                  }}
                  title="Rename project"
                >
                  <Pencil size={12} />
                </button>
              </span>
            )}
            {project.status === 'archived' && (
              <span className="projects-browser__archived-badge">archived</span>
            )}
            {project.status === 'someday' && (
              <span className="projects-browser__someday-badge">someday</span>
            )}
            <ProjectAreaBadge project={project} onUpdated={load} />
            {editingDeadlineProject === project.name ? (
              <span className="projects-browser__deadline-edit">
                <DateTimePicker mode="date" value={deadlineValue} onChange={setDeadlineValue} />
                <button
                  className="tv-btn tv-btn--primary tv-btn--xs"
                  onClick={() => void handleUpdateDeadline(project.name, deadlineValue)}
                >
                  Save
                </button>
                {project.deadline && (
                  <button
                    className="tv-btn tv-btn--ghost tv-btn--xs"
                    onClick={() => void handleUpdateDeadline(project.name, null)}
                  >
                    Clear
                  </button>
                )}
                <button
                  className="tv-btn tv-btn--ghost tv-btn--xs"
                  onClick={() => setEditingDeadlineProject(null)}
                >
                  <X size={12} />
                </button>
              </span>
            ) : project.deadline ? (
              <button
                className="projects-browser__deadline"
                onClick={() => {
                  setDeadlineValue(project.deadline ?? '')
                  setEditingDeadlineProject(project.name)
                }}
                title="Edit deadline"
              >
                due: {project.deadline}
              </button>
            ) : (
              <button
                className="projects-browser__deadline-add-btn"
                onClick={() => {
                  setDeadlineValue('')
                  setEditingDeadlineProject(project.name)
                }}
                title="Set deadline"
              >
                + due date
              </button>
            )}
          </div>
          <div className="projects-browser__stats">
            <span>
              {project.nextActionCount} next action{project.nextActionCount !== 1 ? 's' : ''}
            </span>
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
              <button
                className="projects-browser__action-btn"
                onClick={() => void handleUpdateStatus(project.filePath, 'active')}
              >
                Promote to active
              </button>
            </div>
          )}
          <div className="projects-browser__footer">
            {project.status !== 'archived' ? (
              <button
                className="projects-browser__action-btn projects-browser__action-btn--danger"
                onClick={() => void handleUpdateStatus(project.filePath, 'archived')}
              >
                <Archive size={12} /> Archive project
              </button>
            ) : (
              <button
                className="projects-browser__action-btn projects-browser__action-btn--danger"
                onClick={() => void handleDelete(project.filePath, project.name)}
              >
                <Trash2 size={12} /> Delete project
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
