// Type augmentation for task-vault extension IPC channels.
// Uses declaration merging — does not modify core source files.
// All channels invoke via window.electronAPI.extensionBridge.invoke / .on

import type {
  IndexedTask,
  IndexedProject,
  CalendarEvent,
  TaskStatus,
  ProjectStatus,
} from '../vault/types'

export type TaskVaultCaptureRequest = {
  text: string
  hintArea?: string
  hintProject?: string
}
export type TaskVaultCaptureResponse = { taskId: string } | { error: string }

export type TaskVaultGetTodayResponse =
  | {
      date: string
      tasks: IndexedTask[]
      events: Array<{ time?: string; text: string }>
      notes: Array<{ text: string }>
      exists: boolean
    }
  | { error: string }

export type TaskVaultAddTaskRequest = {
  filePath: string
  text: string
  section?: string
  dueDate?: string
  tags?: { project?: string; context?: string; area?: string }
}

export type TaskVaultCompleteTaskRequest = { taskId: string }
export type TaskVaultMigrateTaskRequest = { taskId: string; targetDate: string }

export type TaskVaultQueryRequest = {
  status?: TaskStatus | TaskStatus[]
  context?: string
  project?: string
  area?: string
  dueBefore?: string
  filePattern?: string
}

export type TaskVaultProcessInboxRequest = {
  taskId: string
  action: 'file' | 'trash' | 'do-now' | 'someday'
  destination?: string
  newProjectName?: string
}

export type TaskVaultUpdateProjectStatusRequest = {
  projectFilePath: string
  status: ProjectStatus
}

export type TaskVaultLinksCreateRequest = {
  taskId?: string
  projectFilePath?: string
  targetId: string
  targetType: 'workspace' | 'project'
}

export type TaskVaultGetEventsResponse =
  | {
      events: CalendarEvent[]
      lastFetchedAt: string
      isFeedConfigured: boolean
      isStale: boolean
      fetchError?: string
    }
  | { error: string }

export type TaskVaultWeeklyReviewResponse =
  | {
      inboxItems: IndexedTask[]
      activeProjects: IndexedProject[]
      staleProjects: IndexedProject[]
      someDayProjects: IndexedProject[]
      completedLastWeek: IndexedTask[]
      lastReviewDate?: string
    }
  | { error: string }
