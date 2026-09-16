import { useWorkspaceStore } from '../stores/workspace.store'
import { useSessionStore } from '../stores/session.store'
import { useSessionRecordsStore } from '../stores/session-records.store'
import { useSettingsStore } from '../stores/settings.store'
import { useExtensionRegistry } from '../extensions/registry'
import { createTerminalSession } from './session-controller'
import { navigateToSession } from './navigate-to-session'
import { planResume } from '../sidebar/resume'
import type { SessionFacts } from '../sidebar/session-facts'
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

/**
 * Bring a stopped conversation back in a terminal of its own.
 *
 * The order matters: open the terminal first, because if it will not open
 * there is nothing to move context onto and the old session must be left
 * exactly as it was. Then move the context, and only then close the terminal
 * the conversation used to have — the operator chose one terminal per
 * conversation, not a graveyard of exited tabs (ADR 055).
 */
export async function resumeSession(facts: SessionFacts): Promise<void> {
  const plan = planResume(facts)
  if (plan === null) return

  const { scrollbackLimit } = useSettingsStore
    .getState()
    .resolveSettings(useWorkspaceStore.getState().activeWorkspaceId ?? null).terminal

  let sessionId: string
  try {
    sessionId = await createTerminalSession(
      plan.projectId,
      'human',
      '',
      plan.cwd,
      scrollbackLimit,
      undefined,
      plan.command
    )
  } catch {
    // The controller has already said why. Nothing has moved.
    return
  }

  const snapshot = { ...facts.snapshot, sessionId }
  await useSessionRecordsStore.getState().transfer(plan.fromSessionId, snapshot)

  const previous = useSessionStore.getState().sessions.get(plan.fromSessionId)
  if (previous !== undefined) await useSessionStore.getState().closeSession(plan.fromSessionId)

  navigateToSession(sessionId)
}
