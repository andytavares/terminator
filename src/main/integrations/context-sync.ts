import { app } from 'electron'
import * as path from 'node:path'
import type { AgentContext } from '../../shared/types/index.js'
import { getProjectById, listWorkspaces } from '../storage/workspace-store.js'
import { buildAgentContext, deleteContextFile, writeContextFile } from './agent-context.js'
import { getLink } from './issue-link-store.js'
import { installHookScript, installProjectHook, removeProjectHook } from './session-hook.js'
import type { IssueService } from './issue-service.js'

// Keeping what an agent session will be told in step with the link.
//
// Three things move together and must not drift: the link, the context file
// the hook reads, and the hook registration in the project's own settings.
// This is the one place that moves all three.

let hookScriptPath: string | null = null

/** Written once at startup; every project's hook command points at it. */
export async function ensureHookScript(): Promise<string> {
  if (hookScriptPath === null) {
    hookScriptPath = await installHookScript(path.join(app.getPath('userData'), 'integrations'))
  }
  return hookScriptPath
}

/**
 * Where a project's working copy is.
 *
 * A worktree project has its own path; a plain one lives at its workspace's
 * folder. Null when the project is gone, which is not an error — it just means
 * there is nothing to write into.
 */
export function projectDirectory(projectId: string): string | null {
  const project = getProjectById(projectId)
  if (project === undefined) return null
  if (project.worktreePath !== undefined && project.worktreePath.length > 0) {
    return project.worktreePath
  }
  return listWorkspaces().find((w) => w.id === project.workspaceId)?.folderPath ?? null
}

/**
 * Bring a project's agent context up to date with its link.
 *
 * Called on link, unlink, refresh and toggle. Throws when it cannot write into
 * the project directory — the caller turns that into a refused link rather
 * than a link that silently feeds nothing (FR-026).
 */
export async function syncProjectContext(
  projectId: string,
  service: IssueService
): Promise<AgentContext | null> {
  const link = getLink(projectId)
  const directory = projectDirectory(projectId)

  if (link === null || !link.injectContext) {
    await deleteContextFile(projectId)
    if (directory !== null) await removeProjectHook(directory, await ensureHookScript())
    return null
  }

  // A tracker that is unreachable right now must not cost the operator their
  // link; the previous context file stays until a successful read replaces it.
  const issue = await service.get(link.tracker, link.key).catch(() => null)
  const context = buildAgentContext(projectId, issue)
  if (context === null) return null

  await writeContextFile(context)
  if (directory !== null) {
    await installProjectHook(directory, {
      execPath: process.execPath,
      hookScriptPath: await ensureHookScript(),
      projectId,
    })
  }
  return context
}

/** The text a session would receive, without writing anything (FR-023). */
export async function previewProjectContext(
  projectId: string,
  service: IssueService
): Promise<AgentContext | null> {
  const link = getLink(projectId)
  if (link === null) return null
  const issue = await service.get(link.tracker, link.key)
  // Built by the same function that writes the file, so the preview is the
  // thing itself rather than a second rendering of the same idea.
  return buildAgentContext(projectId, issue)
}

/** Remove everything this feature put in a project's directory. */
export async function clearProjectContext(projectId: string): Promise<void> {
  await deleteContextFile(projectId)
  const directory = projectDirectory(projectId)
  if (directory !== null) await removeProjectHook(directory, await ensureHookScript())
}
