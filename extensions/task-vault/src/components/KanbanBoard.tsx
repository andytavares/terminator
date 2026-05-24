import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Settings } from 'lucide-react'
import type { KanbanConfig, KanbanLane, SwimlaneGrouping, TaskStatus } from '../vault/types'
import { DEFAULT_KANBAN_CONFIG } from '../vault/types'
import { useVaultStore } from '../stores/vault.store'
import { KanbanLaneEditor } from './KanbanLaneEditor'
import { TaskDetailPanel } from './TaskDetailPanel'
import { renderMarkdown } from '../utils/markdown'

interface KanbanTask {
  id: string
  text: string
  status: TaskStatus
  project?: string
  area?: string
  context?: string
  dueDate?: string
  description?: string
}

interface KanbanBoardProps {
  onConfigChange?: (config: KanbanConfig) => void
}

function laneForTask(task: KanbanTask, lanes: KanbanLane[]): string | null {
  for (const lane of lanes) {
    if (lane.taskStatuses.includes(task.status)) return lane.id
  }
  return null
}

interface SwimlaneGroup {
  key: string
  label: string
  tasks: KanbanTask[]
}

function groupBySwimlane(tasks: KanbanTask[], grouping: SwimlaneGrouping): SwimlaneGroup[] {
  if (grouping === 'none') return [{ key: '__all__', label: '', tasks }]

  const map = new Map<string, KanbanTask[]>()
  for (const task of tasks) {
    const key = (grouping === 'project' ? task.project : task.area) ?? '(none)'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(task)
  }

  const groups: SwimlaneGroup[] = []
  for (const [key, groupTasks] of map) {
    groups.push({ key, label: key, tasks: groupTasks })
  }
  groups.sort((a, b) => {
    if (a.key === '(none)') return 1
    if (b.key === '(none)') return -1
    return a.key.localeCompare(b.key)
  })
  return groups
}

interface LaneColumnProps {
  lane: KanbanLane
  tasks: KanbanTask[]
  isDragOver: boolean
  selectedTaskId: string | null
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, laneId: string) => void
  onDragStart: (e: React.DragEvent, taskId: string) => void
  onDragEnd: () => void
  onSelect: (task: KanbanTask) => void
}

function LaneColumn({
  lane,
  tasks,
  isDragOver,
  selectedTaskId,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onDragEnd,
  onSelect,
}: LaneColumnProps) {
  const didDragRef = useRef(false)

  return (
    <div
      className={`tv-kanban__lane${isDragOver ? ' tv-kanban__lane--dragover' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, lane.id)}
    >
      <div className="tv-kanban__lane-header">
        <span className="tv-kanban__lane-title">{lane.label}</span>
        <span className="tv-kanban__lane-count">{tasks.length}</span>
      </div>
      <div className="tv-kanban__lane-body">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={`tv-kanban__card${selectedTaskId === task.id ? ' tv-kanban__card--selected' : ''}`}
            draggable
            onDragStart={(e) => {
              didDragRef.current = true
              onDragStart(e, task.id)
            }}
            onDragEnd={() => {
              onDragEnd()
              // Reset flag after a tick so onClick doesn't fire
              setTimeout(() => {
                didDragRef.current = false
              }, 0)
            }}
            onClick={() => {
              if (!didDragRef.current) onSelect(task)
            }}
          >
            <div className="tv-kanban__card-text">{task.text}</div>
            {task.description && (
              <div
                className="tv-kanban__card-desc"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(task.description) }}
              />
            )}
            <div className="tv-kanban__card-meta">
              {task.project && (
                <span className="tv-kanban__tag tv-kanban__tag--project">@{task.project}</span>
              )}
              {task.area && (
                <span className="tv-kanban__tag tv-kanban__tag--area">#{task.area}</span>
              )}
              {task.dueDate && (
                <span className="tv-kanban__tag tv-kanban__tag--due">due:{task.dueDate}</span>
              )}
            </div>
          </div>
        ))}
        {tasks.length === 0 && <div className="tv-kanban__lane-empty">—</div>}
      </div>
    </div>
  )
}

interface SwimlaneProps {
  group: SwimlaneGroup
  lanes: KanbanLane[]
  grouping: SwimlaneGrouping
  dragOverLane: string | null
  selectedTaskId: string | null
  draggingTaskId: string | null
  onDragOver: (e: React.DragEvent, laneId: string) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, laneId: string) => void
  onDragStart: (e: React.DragEvent, taskId: string) => void
  onDragEnd: () => void
  onSelect: (task: KanbanTask) => void
}

function Swimlane({
  group,
  lanes,
  grouping,
  dragOverLane,
  selectedTaskId,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onDragEnd,
  onSelect,
}: SwimlaneProps) {
  return (
    <div className="tv-kanban__swimlane">
      {grouping !== 'none' && <div className="tv-kanban__swimlane-header">{group.label}</div>}
      <div className="tv-kanban__lanes">
        {lanes.map((lane) => {
          const laneTasks = group.tasks.filter((t) => laneForTask(t, lanes) === lane.id)
          return (
            <LaneColumn
              key={lane.id}
              lane={lane}
              tasks={laneTasks}
              isDragOver={dragOverLane === lane.id}
              selectedTaskId={selectedTaskId}
              onDragOver={(e) => onDragOver(e, lane.id)}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onSelect={onSelect}
            />
          )
        })}
      </div>
    </div>
  )
}

export function KanbanBoard({ onConfigChange }: KanbanBoardProps) {
  const [config, setConfig] = useState<KanbanConfig>(DEFAULT_KANBAN_CONFIG)
  const [tasks, setTasks] = useState<KanbanTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showLaneEditor, setShowLaneEditor] = useState(false)
  const [dragOverLane, setDragOverLane] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedTaskText, setSelectedTaskText] = useState('')
  const draggingTaskId = useRef<string | null>(null)

  const selectedContexts = useVaultStore((s) => s.selectedContexts)

  const visibleTasks = useMemo(() => {
    if (selectedContexts.length === 0) return tasks
    return tasks.filter((t) => !t.context || selectedContexts.includes(t.context))
  }, [tasks, selectedContexts])

  const loadConfig = useCallback(async () => {
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:kanban:get-config')
      if (result && typeof result === 'object' && !('error' in result)) {
        setConfig(result as KanbanConfig)
      }
    } catch {
      // fallback to default
    }
  }, [])

  const loadTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:kanban:list-tasks')
      if (result && typeof result === 'object' && 'tasks' in result) {
        setTasks((result as { tasks: KanbanTask[] }).tasks)
      } else if (result && typeof result === 'object' && 'error' in result) {
        setError((result as { error: string }).error)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadConfig()
    void loadTasks()
  }, [loadConfig, loadTasks])

  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on('task-vault:push:index-updated', () => {
      void loadTasks()
    })
    return unsub
  }, [loadTasks])

  const saveConfig = useCallback(
    async (newConfig: KanbanConfig) => {
      setConfig(newConfig)
      onConfigChange?.(newConfig)
      await window.electronAPI.extensionBridge.invoke('task-vault:kanban:save-config', newConfig)
    },
    [onConfigChange]
  )

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    draggingTaskId.current = taskId
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, laneId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverLane(laneId)
  }

  const handleDragLeave = () => {
    setDragOverLane(null)
  }

  const handleDragEnd = () => {
    draggingTaskId.current = null
    setDragOverLane(null)
  }

  const handleSelect = (task: KanbanTask) => {
    if (task.id === selectedTaskId) {
      setSelectedTaskId(null)
      setSelectedTaskText('')
    } else {
      setSelectedTaskId(task.id)
      setSelectedTaskText(task.text)
    }
  }

  const handleDrop = async (e: React.DragEvent, laneId: string) => {
    e.preventDefault()
    setDragOverLane(null)
    const taskId = draggingTaskId.current
    if (!taskId) return
    draggingTaskId.current = null

    const lane = config.lanes.find((l) => l.id === laneId)
    if (!lane || lane.taskStatuses.length === 0) return

    const toStatus = lane.taskStatuses[0]
    await window.electronAPI.extensionBridge.invoke('task-vault:kanban:move-task', {
      taskId,
      toStatus,
    })
    await loadTasks()
  }

  const swimlanes = groupBySwimlane(visibleTasks, config.swimlaneGrouping)

  if (loading) {
    return <div className="tv-kanban__loading">Loading…</div>
  }

  if (error) {
    return <div className="tv-kanban__error">{error}</div>
  }

  return (
    <div className="tv-kanban">
      <div className="tv-kanban__toolbar">
        <div className="tv-kanban__swimlane-toggle">
          <span className="tv-kanban__toolbar-label">Swimlanes:</span>
          {(['none', 'project', 'area'] as SwimlaneGrouping[]).map((g) => (
            <button
              key={g}
              className={`tv-btn tv-btn--xs${config.swimlaneGrouping === g ? ' tv-btn--primary' : ' tv-btn--ghost'}`}
              onClick={() => void saveConfig({ ...config, swimlaneGrouping: g })}
            >
              {g === 'none' ? 'Off' : g === 'project' ? 'Project' : 'Area'}
            </button>
          ))}
        </div>
        <button
          className="tv-btn tv-btn--ghost tv-btn--xs tv-kanban__edit-lanes-btn"
          onClick={() => setShowLaneEditor(true)}
          title="Edit lanes"
        >
          <Settings size={13} />
          Lanes
        </button>
      </div>

      <div className="tv-kanban__body">
        <div className="tv-kanban__board">
          {swimlanes.map((group) => (
            <Swimlane
              key={group.key}
              group={group}
              lanes={config.lanes}
              grouping={config.swimlaneGrouping}
              dragOverLane={dragOverLane}
              selectedTaskId={selectedTaskId}
              draggingTaskId={draggingTaskId.current}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onSelect={handleSelect}
            />
          ))}
        </div>

        {selectedTaskId && (
          <TaskDetailPanel
            taskId={selectedTaskId}
            taskText={selectedTaskText}
            onClose={() => {
              setSelectedTaskId(null)
              setSelectedTaskText('')
            }}
          />
        )}
      </div>

      {showLaneEditor && (
        <KanbanLaneEditor
          lanes={config.lanes}
          onSave={(lanes) => {
            void saveConfig({ ...config, lanes })
            setShowLaneEditor(false)
          }}
          onClose={() => setShowLaneEditor(false)}
        />
      )}
    </div>
  )
}
