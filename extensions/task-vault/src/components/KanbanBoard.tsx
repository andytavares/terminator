import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Settings } from 'lucide-react'
import type { KanbanConfig, KanbanLane, SwimlaneGrouping, TaskStatus } from '../vault/types'
import { DEFAULT_KANBAN_CONFIG } from '../vault/types'
import { useVaultStore } from '../stores/vault.store'
import { KanbanLaneEditor } from './KanbanLaneEditor'
import { TaskDetailPanel } from './TaskDetailPanel'
import { Button, Markdown } from '@terminator/extension-ui'
import { openInBrowser } from '../utils/open-in-browser'
import { useIndexReload } from './vault-hooks'

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

interface SwimlaneGroup {
  key: string
  label: string
  tasks: KanbanTask[]
}

/** What every lane and card on the board shares: drag state, handlers and the selection. */
interface Board {
  dragOverLane: string | null
  selectedTaskId: string | null
  onDragOver: (e: React.DragEvent, laneId: string) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, laneId: string) => void
  onDragStart: (e: React.DragEvent, taskId: string) => void
  onDragEnd: () => void
  onSelect: (task: KanbanTask) => void
}

interface LaneColumnProps {
  lane: KanbanLane
  tasks: KanbanTask[]
  board: Board
}

interface SwimlaneProps {
  group: SwimlaneGroup
  lanes: KanbanLane[]
  grouping: SwimlaneGrouping
  board: Board
}

type KanbanTasksOutcome = { tasks: KanbanTask[] } | { error: string } | Record<string, never>

interface ToolbarProps {
  grouping: SwimlaneGrouping
  onGrouping: (grouping: SwimlaneGrouping) => void
  onEditLanes: () => void
}

interface BoardBodyProps {
  data: ReturnType<typeof useKanbanData>
  board: Board
  selection: ReturnType<typeof useSelectedCard>
}

interface SelectedCard {
  id: string
  text: string
}

function laneForTask(task: KanbanTask, lanes: KanbanLane[]): string | null {
  for (const lane of lanes) {
    if (lane.taskStatuses.includes(task.status)) return lane.id
  }
  return null
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

function CardTags({ task }: { task: KanbanTask }): React.JSX.Element {
  return (
    <div className="tv-kanban__card-meta">
      {task.project && (
        <span className="tv-kanban__tag tv-kanban__tag--project">{`@${task.project}`}</span>
      )}
      {task.area && <span className="tv-kanban__tag tv-kanban__tag--area">{`#${task.area}`}</span>}
      {task.dueDate && (
        <span className="tv-kanban__tag tv-kanban__tag--due">{`due:${task.dueDate}`}</span>
      )}
    </div>
  )
}

/**
 * A card. A click right after a drag does not select it (the flag resets a tick
 * after the drag ends), and a link in the description opens itself instead.
 */
function KanbanCard({ task, board }: { task: KanbanTask; board: Board }): React.JSX.Element {
  const selected = board.selectedTaskId === task.id
  const gestures = useCardGestures(task, board)
  return (
    <div
      draggable
      className={`tv-kanban__card${selected ? ' tv-kanban__card--selected' : ''}`}
      onDragStart={gestures.onDragStart}
      onDragEnd={gestures.onDragEnd}
      onClick={gestures.onClick}
    >
      <div className="tv-kanban__card-text">{task.text}</div>
      {task.description && (
        <Markdown fetchesNothing className="tv-kanban__card-desc" onOpenLink={openInBrowser}>
          {task.description}
        </Markdown>
      )}
      <CardTags task={task} />
    </div>
  )
}

function useCardGestures(task: KanbanTask, board: Board) {
  const didDragRef = useRef(false)
  return {
    onDragStart: (e: React.DragEvent) => {
      didDragRef.current = true
      board.onDragStart(e, task.id)
    },
    onDragEnd: () => {
      board.onDragEnd()
      setTimeout(() => {
        didDragRef.current = false
      }, 0)
    },
    onClick: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('a')) return
      if (!didDragRef.current) board.onSelect(task)
    },
  }
}

function LaneColumn({ lane, tasks, board }: LaneColumnProps) {
  const isDragOver = board.dragOverLane === lane.id
  return (
    <div
      className={`tv-kanban__lane${isDragOver ? ' tv-kanban__lane--dragover' : ''}`}
      onDragOver={(e) => board.onDragOver(e, lane.id)}
      onDragLeave={board.onDragLeave}
      onDrop={(e) => board.onDrop(e, lane.id)}
    >
      <div className="tv-kanban__lane-header">
        <span className="tv-kanban__lane-title">{lane.label}</span>
        <span className="tv-kanban__lane-count">{tasks.length}</span>
      </div>
      <div className="tv-kanban__lane-body">
        {tasks.map((task) => (
          <KanbanCard key={task.id} task={task} board={board} />
        ))}
        {tasks.length === 0 && <div className="tv-kanban__lane-empty">—</div>}
      </div>
    </div>
  )
}

function Swimlane(props: SwimlaneProps) {
  const { group, lanes, grouping, board } = props
  return (
    <div className="tv-kanban__swimlane">
      {grouping !== 'none' && <div className="tv-kanban__swimlane-header">{group.label}</div>}
      <div className="tv-kanban__lanes">
        {lanes.map((lane) => (
          <LaneColumn
            key={lane.id}
            lane={lane}
            tasks={group.tasks.filter((t) => laneForTask(t, lanes) === lane.id)}
            board={board}
          />
        ))}
      </div>
    </div>
  )
}

async function fetchKanbanConfig(): Promise<KanbanConfig | null> {
  try {
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:kanban:get-config')
    if (result && typeof result === 'object' && !('error' in result)) return result as KanbanConfig
  } catch {
    // fall back to the default config
  }
  return null
}

async function fetchKanbanTasks(): Promise<KanbanTasksOutcome> {
  try {
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:kanban:list-tasks')
    if (!result || typeof result !== 'object') return {}
    if ('tasks' in result) return { tasks: (result as { tasks: KanbanTask[] }).tasks }
    if ('error' in result) return { error: (result as { error: string }).error }
    return {}
  } catch (err) {
    return { error: String(err) }
  }
}

/** The board's cards, reloaded when the index changes. */
function useKanbanTasks() {
  const [tasks, setTasks] = useState<KanbanTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const applyTasks = useCallback((outcome: KanbanTasksOutcome) => {
    if ('tasks' in outcome) setTasks(outcome.tasks)
    else if ('error' in outcome) setError(outcome.error)
    setLoading(false)
  }, [])
  const loadTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    applyTasks(await fetchKanbanTasks())
  }, [applyTasks])
  useEffect(() => {
    void fetchKanbanTasks().then(applyTasks)
  }, [applyTasks])
  useIndexReload(() => void loadTasks(), [loadTasks])
  return { tasks, loading, error, loadTasks }
}

/** The board's lanes and grouping, loaded once and saved on every change. */
function useKanbanConfig(onConfigChange?: (config: KanbanConfig) => void) {
  const [config, setConfig] = useState<KanbanConfig>(DEFAULT_KANBAN_CONFIG)
  const { setKanbanLanes } = useVaultStore()
  useEffect(() => {
    void fetchKanbanConfig().then((loaded) => {
      if (!loaded) return
      setConfig(loaded)
      setKanbanLanes(loaded.lanes)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  async function saveConfig(newConfig: KanbanConfig) {
    setConfig(newConfig)
    setKanbanLanes(newConfig.lanes)
    onConfigChange?.(newConfig)
    await window.electronAPI.extensionBridge.invoke('task-vault:kanban:save-config', newConfig)
  }
  return { config, saveConfig }
}

/** The board's config and cards. */
function useKanbanData(onConfigChange?: (config: KanbanConfig) => void) {
  return { ...useKanbanConfig(onConfigChange), ...useKanbanTasks() }
}

/** Moves a card to the lane's first status; false when the lane maps no status. */
async function moveToLane(lanes: KanbanLane[], laneId: string, taskId: string): Promise<boolean> {
  const lane = lanes.find((l) => l.id === laneId)
  if (!lane || lane.taskStatuses.length === 0) return false
  await window.electronAPI.extensionBridge.invoke('task-vault:kanban:move-task', {
    taskId,
    toStatus: lane.taskStatuses[0],
  })
  return true
}

/** Drag-and-drop between lanes: a drop moves the card to the lane's first status. */
function useDragAndDrop(lanes: KanbanLane[], afterMove: () => Promise<void>) {
  const [dragOverLane, setDragOverLane] = useState<string | null>(null)
  const draggingTaskId = useRef<string | null>(null)
  async function onDrop(e: React.DragEvent, laneId: string) {
    e.preventDefault()
    setDragOverLane(null)
    const taskId = draggingTaskId.current
    if (!taskId) return
    draggingTaskId.current = null
    if (await moveToLane(lanes, laneId, taskId)) await afterMove()
  }
  return {
    dragOverLane,
    onDrop: (e: React.DragEvent, laneId: string) => void onDrop(e, laneId),
    onDragStart: (e: React.DragEvent, taskId: string) => {
      draggingTaskId.current = taskId
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (e: React.DragEvent, laneId: string) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOverLane(laneId)
    },
    onDragLeave: () => setDragOverLane(null),
    onDragEnd: () => {
      draggingTaskId.current = null
      setDragOverLane(null)
    },
  }
}

/** The card shown in the detail panel; selecting it again closes the panel. */
function useSelectedCard() {
  const [selected, setSelected] = useState<SelectedCard | null>(null)
  const onSelect = (task: KanbanTask) =>
    setSelected((prev) => {
      if (prev?.id === task.id) return null
      return { id: task.id, text: task.text }
    })
  return { selected, onSelect, close: () => setSelected(null) }
}

const GROUPINGS: { value: SwimlaneGrouping; label: string }[] = [
  { value: 'none', label: 'Off' },
  { value: 'project', label: 'Project' },
  { value: 'area', label: 'Area' },
]

function KanbanToolbar({ grouping, onGrouping, onEditLanes }: ToolbarProps): React.JSX.Element {
  return (
    <div className="tv-kanban__toolbar">
      <div className="tv-kanban__swimlane-toggle">
        <span className="tv-kanban__toolbar-label">Swimlanes:</span>
        {GROUPINGS.map((g) => (
          <Button
            aria-pressed={grouping === g.value}
            key={g.value}
            variant={grouping === g.value ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => onGrouping(g.value)}
          >
            {g.label}
          </Button>
        ))}
      </div>
      <Button variant="ghost" size="sm" icon={Settings} onClick={onEditLanes} title="Edit lanes">
        Lanes
      </Button>
    </div>
  )
}

/** The cards in the selected contexts, or all of them when none is selected. */
function useVisibleTasks(tasks: KanbanTask[]): KanbanTask[] {
  const { selectedContexts } = useVaultStore()
  return useMemo(() => {
    if (selectedContexts.length === 0) return tasks
    return tasks.filter((t) => selectedContexts.includes(t.context ?? ''))
  }, [tasks, selectedContexts])
}

function BoardBody({ data, board, selection }: BoardBodyProps): React.JSX.Element {
  const { config } = data
  const swimlanes = groupBySwimlane(useVisibleTasks(data.tasks), config.swimlaneGrouping)
  return (
    <div className="tv-kanban__body">
      <div className="tv-kanban__board">
        {swimlanes.map((group) => (
          <Swimlane
            key={group.key}
            group={group}
            lanes={config.lanes}
            grouping={config.swimlaneGrouping}
            board={board}
          />
        ))}
      </div>
      {selection.selected && (
        <TaskDetailPanel
          taskId={selection.selected.id}
          taskText={selection.selected.text}
          onClose={selection.close}
        />
      )}
    </div>
  )
}

/** Moving a card refreshes the board, today's log and the calendar. */
function useBoard(data: ReturnType<typeof useKanbanData>) {
  const { loadToday, tickCalendar } = useVaultStore()
  const drag = useDragAndDrop(data.config.lanes, async () => {
    await Promise.all([data.loadTasks(), loadToday()])
    tickCalendar()
  })
  const selection = useSelectedCard()
  const board: Board = {
    ...drag,
    selectedTaskId: selection.selected?.id ?? null,
    onSelect: selection.onSelect,
  }
  return { board, selection }
}

export function KanbanBoard({ onConfigChange }: KanbanBoardProps) {
  const data = useKanbanData(onConfigChange)
  const { config, saveConfig } = data
  const [showLaneEditor, setShowLaneEditor] = useState(false)
  const { board, selection } = useBoard(data)
  if (data.loading) return <div className="tv-kanban__loading">Loading…</div>
  if (data.error) return <div className="tv-kanban__error">{data.error}</div>
  const saveLanes = (lanes: KanbanLane[]) => {
    void saveConfig({ ...config, lanes })
    setShowLaneEditor(false)
  }
  return (
    <div className="tv-kanban">
      <KanbanToolbar
        grouping={config.swimlaneGrouping}
        onGrouping={(g) => void saveConfig({ ...config, swimlaneGrouping: g })}
        onEditLanes={() => setShowLaneEditor(true)}
      />
      <BoardBody data={data} board={board} selection={selection} />
      {showLaneEditor && (
        <KanbanLaneEditor
          lanes={config.lanes}
          onSave={saveLanes}
          onClose={() => setShowLaneEditor(false)}
        />
      )}
    </div>
  )
}
