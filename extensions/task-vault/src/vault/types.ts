export type TaskStatus = 'open' | 'done' | 'migrated' | 'cancelled' | 'in-progress'
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

export interface Event {
  time?: string
  text: string
}

export interface Note {
  text: string
}

export interface DailyLog {
  date: string
  filePath: string
  tasks: Task[]
  events: Event[]
  notes: Note[]
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

export interface VaultIndex {
  version: number
  builtAt: string
  vaultPath: string
  tasks: IndexedTask[]
  projects: IndexedProject[]
  inboxCount: number
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
