export type TaskStatus =
  | 'open'
  | 'done'
  | 'migrated'
  | 'cancelled'
  | 'in-progress'
  | 'in-review'
  | 'blocked'

export interface KanbanLane {
  id: string
  label: string
  taskStatuses: TaskStatus[]
}

export type SwimlaneGrouping = 'none' | 'project' | 'area'

export interface KanbanConfig {
  viewMode: 'list' | 'kanban'
  lanes: KanbanLane[]
  swimlaneGrouping: SwimlaneGrouping
}

export const DEFAULT_KANBAN_CONFIG: KanbanConfig = {
  viewMode: 'list',
  lanes: [
    { id: 'todo', label: 'Todo', taskStatuses: ['open'] },
    { id: 'in-progress', label: 'In Progress', taskStatuses: ['in-progress'] },
    { id: 'in-review', label: 'In Review', taskStatuses: ['in-review'] },
    { id: 'done', label: 'Done', taskStatuses: ['done'] },
  ],
  swimlaneGrouping: 'none',
}
export type ProjectStatus = 'active' | 'someday' | 'done' | 'archived'

export interface Task {
  id: string
  filePath: string
  line: number
  status: TaskStatus
  text: string
  project?: string
  context?: string
  area?: string
  dueDate?: string
  completedDate?: string
  migratedTo?: string
  metadata: Record<string, string>
  terminatorLinks: string[]
  subtasks?: Task[]
}

export interface DailyLog {
  date: string
  filePath: string
  tasks: Task[]
  exists: boolean
}

export interface InboxItem extends Task {
  capturedAt?: string
  source?: 'quick-capture' | 'mcp' | 'manual'
}

export interface Project {
  filePath: string
  name: string
  status: ProjectStatus
  deadline?: string
  area?: string
  created: string
  outcome?: string
  nextActions: Task[]
  allTasks: Task[]
  isStale: boolean
  lastModified: Date
  terminatorLinks: string[]
}

export interface Area {
  filePath: string
  name: string
  area: string
  tasks: Task[]
  terminatorLinks: string[]
}

export interface IndexedTask {
  id: string
  filePath: string
  line: number
  status: TaskStatus
  text: string
  project?: string
  context?: string
  area?: string
  dueDate?: string
  terminatorLinks: string[]
  subtasks?: IndexedTask[]
  blockedReason?: string
  blockedCheckInterval?: string
  recurrenceInterval?: string
  recurrenceDays?: number[]
  recurrenceTime?: string
  recurrenceEndType?: 'none' | 'on_date' | 'after_count'
  recurrenceEndDate?: string
  recurrenceEndCount?: number
  recurrenceCompletedCount?: number
}

export interface IndexedProject {
  id: string
  filePath: string
  name: string
  status: ProjectStatus
  deadline?: string
  area?: string
  isStale: boolean
  nextActionCount: number
  lastModified: string
  terminatorLinks: string[]
}

export interface TerminatorLink {
  targetId: string
  targetType: 'workspace' | 'project'
  displayName?: string
  isBroken: boolean
}

export interface CalendarEvent {
  uid: string
  summary: string
  startDate: Date
  endDate: Date
  allDay: boolean
  location?: string
  description?: string
}

export interface IcsFeedCache {
  feedUrl: string
  events: CalendarEvent[]
  lastFetchedAt: string
  fetchError?: string
}
