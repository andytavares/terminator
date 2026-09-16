import { useWorkspaceStore } from '../stores/workspace.store'
import { useSettingsStore } from '../stores/settings.store'
import { useExtensionRegistry } from '../extensions/registry'
import { createTerminalSession } from './session-controller'
import { navigateToSession } from './navigate-to-session'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'

// Starting work from Home. The sidebar starts a terminal by selecting the
// branch it belongs to; Home has no selection, so it names the branch instead.

/**
 * Opens a terminal on a branch and shows it.
 *
 * The working directory is the branch's own checkout when it has one — a
 * worktree — and otherwise the repo's folder, the same rule the rest of the app
 * resolves a terminal's cwd by.
 */
export async function startSessionInBranch(projectId: string): Promise<void> {
  const { workspaces, projectsByWorkspaceId } = useWorkspaceStore.getState()
  const project = [...projectsByWorkspaceId.values()].flat().find((p) => p.id === projectId)
  if (project === undefined) return
  const workspace = workspaces.find((w) => w.id === project.workspaceId)
  const { scrollbackLimit } = useSettingsStore
    .getState()
    .resolveSettings(project.workspaceId).terminal
  const cwd = project.worktreePath ?? workspace?.folderPath ?? '~'
  try {
    const sessionId = await createTerminalSession(projectId, 'human', '', cwd, scrollbackLimit)
    navigateToSession(sessionId)
  } catch {
    // The controller has already said why; Home stays where it is.
  }
}

/** Opens a scratch terminal — one that belongs to no branch — and shows it. */
export async function startScratchSession(): Promise<void> {
  const workspaces = useWorkspaceStore.getState()
  const { scrollbackLimit } = useSettingsStore
    .getState()
    .resolveSettings(workspaces.activeWorkspaceId ?? null).terminal
  try {
    await createTerminalSession(
      SCRATCH_PROJECT_ID,
      'human',
      'Scratch',
      workspaces.resolveActiveCwd(),
      scrollbackLimit
    )
    workspaces.setScratchActive(true)
    useExtensionRegistry.getState().setActiveGlobalTab(null)
  } catch {
    // Nothing started, so there is nothing to show.
  }
}
