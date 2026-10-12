import type { ProjectSnapshot, TrackerId, WorkspaceSnapshot } from '@terminator/extension-sdk'

/** Workspaces and each one's projects, as `api.workspace.list` / `listProjects` read them. */
export interface WorkspacesSnapshot {
  workspaces: WorkspaceSnapshot[]
  projects: Record<string, ProjectSnapshot[]>
}

/** What a tracker can do. Fixed per tracker, so it is sent once. */
export type TrackerAbilities = Record<TrackerId, { transitions: boolean; create: boolean }>

/**
 * What main sends the extension host when it starts, and keeps current with
 * `settings.changed` and `workspaces.changed` events: the values behind the
 * API's synchronous getters (SDK 4.0.0).
 */
export interface HostSnapshot {
  databasePath: string
  paths: { app: string; userData: string }
  settings: Record<string, unknown>
  workspaces: WorkspacesSnapshot
  trackers: TrackerAbilities
}
