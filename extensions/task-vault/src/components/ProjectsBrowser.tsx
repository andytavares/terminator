import React, { useEffect, useRef, useState } from 'react'
import { Zap, Pencil, Check, X } from 'lucide-react'
import type { IndexedProject, IndexedTask } from '../vault/types'
import { useVaultStore } from '../stores/vault.store'

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
  const [targetId, setTargetId] = useState('')
  const [linked, setLinked] = useState(false)

  async function confirm() {
    if (!targetId.trim()) return
    await window.electronAPI.extensionBridge.invoke('task-vault:links:create', {
      projectFilePath: filePath,
      targetId: targetId.trim(),
    })
    setLinked(true)
    setLinking(false)
    setTargetId('')
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
        title="Link to Terminator session"
      >
        Link…
      </button>
    )
  return (
    <span className="projects-browser__link-picker">
      <input
        type="text"
        placeholder="Paste terminal UUID…"
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        autoFocus
      />
      <button className="tv-btn tv-btn--primary" onClick={confirm} disabled={!targetId.trim()}>
        Link
      </button>
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
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
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
  const [tasks, setTasks] = useState<IndexedTask[]>([])
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState(false)

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

  if (!expanded) {
    return (
      <button className="projects-browser__tasks-toggle" onClick={toggle}>
        {loaded
          ? `${tasks.length} task${tasks.length !== 1 ? 's' : ''} tagged @${projectName}`
          : `Show tasks tagged @${projectName}`}
      </button>
    )
  }

  const STATUS_ICON: Record<string, string> = {
    done: '[x]',
    migrated: '[>]',
    cancelled: '[-]',
    'in-progress': '[/]',
    open: '[ ]',
  }
  const openTasks = tasks.filter((t) => t.status === 'open')
  const doneTasks = tasks.filter((t) => t.status !== 'open')

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
      {tasks.length === 0 && (
        <div className="projects-browser__task-list-empty">
          No tasks tagged @{projectName} across vault.
        </div>
      )}
      {openTasks.map((t) => (
        <div key={t.id} className="projects-browser__task-row">
          <span className="projects-browser__task-marker">{STATUS_ICON[t.status] ?? '[ ]'}</span>
          <span className="projects-browser__task-text">{t.text}</span>
          {t.area && <span className="daily-log__tag daily-log__tag--area">#{t.area}</span>}
          <span className="projects-browser__task-file">
            {t.filePath.split('/').pop()?.replace('.md', '')}
          </span>
        </div>
      ))}
      {doneTasks.length > 0 && (
        <details className="projects-browser__done-tasks">
          <summary>{doneTasks.length} completed</summary>
          {doneTasks.map((t) => (
            <div key={t.id} className="projects-browser__task-row projects-browser__task-row--done">
              <span className="projects-browser__task-marker">
                {STATUS_ICON[t.status] ?? '[x]'}
              </span>
              <span className="projects-browser__task-text">{t.text}</span>
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
        <button className="tv-btn tv-btn--primary" onClick={save} title="Save area">
          <Check size={14} />
        </button>
        <button
          className="tv-btn tv-btn--secondary"
          onClick={() => setEditing(false)}
          title="Cancel"
        >
          <X size={14} />
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
        <button className="projects-browser__area-edit-btn" onClick={openEdit} title="Change area">
          <Pencil size={14} />
        </button>
      </span>
    )
  }

  return (
    <button className="projects-browser__area-assign-btn" onClick={openEdit} title="Assign to area">
      + area
    </button>
  )
}

export function ProjectsBrowser(): React.JSX.Element {
  const [projects, setProjects] = useState<IndexedProject[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'active' | 'someday' | 'all'>('active')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const { selectedProjectName } = useVaultStore()

  async function load() {
    setIsLoading(true)
    const status = statusFilter === 'all' ? ['active', 'someday'] : [statusFilter]
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:projects:list', {
      status,
    })
    if (result && typeof result === 'object' && 'projects' in result) {
      setProjects((result as { projects: IndexedProject[] }).projects)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    load()
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

  if (isLoading) return <div className="projects-browser__loading">Loading projects…</div>

  return (
    <div className="projects-browser">
      <div className="projects-browser__header">
        <h2>Projects</h2>
        <div className="projects-browser__filter">
          {(['active', 'someday', 'all'] as const).map((f) => (
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
            <span className="projects-browser__name">{project.name}</span>
            {project.status === 'someday' && (
              <span className="projects-browser__someday-badge">someday</span>
            )}
            <ProjectAreaBadge project={project} onUpdated={load} />
            {project.deadline && (
              <span className="projects-browser__deadline">due: {project.deadline}</span>
            )}
          </div>
          <div className="projects-browser__stats">
            <span>
              {project.nextActionCount} next action{project.nextActionCount !== 1 ? 's' : ''}
            </span>
            <LinkToTerminator filePath={project.filePath} />
          </div>
          <ProjectTaskList projectName={project.name} />
          {project.isStale && (
            <div className="projects-browser__stale-info">
              <span className="projects-browser__stale-badge">
                {project.nextActionCount === 0 ? 'no next action' : 'inactive'}
              </span>
              <div className="projects-browser__stale-actions">
                <button
                  className="projects-browser__action-btn"
                  onClick={() => handleUpdateStatus(project.filePath, 'someday')}
                >
                  Move to Someday
                </button>
                <button
                  className="projects-browser__action-btn projects-browser__action-btn--danger"
                  onClick={() => handleUpdateStatus(project.filePath, 'archived')}
                >
                  Archive
                </button>
              </div>
            </div>
          )}
          {project.status === 'someday' && (
            <div className="projects-browser__stale-actions">
              <button
                className="projects-browser__action-btn"
                onClick={() => handleUpdateStatus(project.filePath, 'active')}
              >
                Promote to active
              </button>
              <button
                className="projects-browser__action-btn projects-browser__action-btn--danger"
                onClick={() => handleUpdateStatus(project.filePath, 'archived')}
              >
                Archive
              </button>
            </div>
          )}
          <div className="projects-browser__footer">
            <button
              className="projects-browser__action-btn projects-browser__action-btn--danger"
              onClick={() => handleDelete(project.filePath, project.name)}
            >
              Delete project
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
