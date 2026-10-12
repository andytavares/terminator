import type { ExtensionAPI, TrackerId } from '@terminator/extension-sdk'
import type { TrackerAbilities, WorkspacesSnapshot } from './snapshot.js'

const TRACKERS: readonly TrackerId[] = ['linear', 'jira']

/** Workspaces and projects as `api.workspace` answers in main, for the extension host's copy. */
export function workspacesOf(workspace: ExtensionAPI['workspace']): WorkspacesSnapshot {
  const workspaces = workspace.list()
  const projects = Object.fromEntries(workspaces.map(({ id }) => [id, workspace.listProjects(id)]))
  return { workspaces, projects }
}

/** What each tracker supports, as `api.issues` answers in main. */
export function trackerAbilitiesOf(issues: ExtensionAPI['issues']): TrackerAbilities {
  const abilities = TRACKERS.map((tracker) => [
    tracker,
    { transitions: issues.supportsTransitions(tracker), create: issues.supportsCreate(tracker) },
  ])
  return Object.fromEntries(abilities) as TrackerAbilities
}
