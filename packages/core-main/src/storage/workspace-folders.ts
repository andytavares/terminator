import { listProjects, listWorkspaces } from './workspace-store.js'
import type { WorkspaceFolders } from '../extensions/setting-scope.js'

/** Every workspace and its projects, as `workspaceOwning` reads them. */
export function workspaceFolders(): WorkspaceFolders {
  const workspaces = listWorkspaces()
  const projects = Object.fromEntries(workspaces.map(({ id }) => [id, listProjects(id)]))
  return { workspaces, projects }
}
