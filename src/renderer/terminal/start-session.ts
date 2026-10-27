import { useWorkspaceStore } from '../stores/workspace.store'
import { useSessionStore } from '../stores/session.store'
import { useSessionRecordsStore } from '../stores/session-records.store'
import { useSettingsStore } from '../stores/settings.store'
import { useExtensionRegistry } from '../extensions/registry'
import { createTerminalSession } from './session-controller'
import { revealSession } from './navigate-to-session'
import { planResume, type ResumePlan } from '../sidebar/resume'
import { promptAgentTab, startAgentTab } from './agent-tab'
import type { SessionFacts } from '../sidebar/session-facts'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'

// Starting work from Home. The sidebar starts a terminal by selecting the
// branch it belongs to; Home has no selection, so it names the branch instead.

/** Where a branch's work happens, or null when the branch has gone. */
function branchPlace(projectId: string): { cwd: string; scrollbackLimit: number } | null {
  const { workspaces, projectsByWorkspaceId } = useWorkspaceStore.getState()
  const project = [...projectsByWorkspaceId.values()].flat().find((p) => p.id === projectId)
  if (project === undefined) return null
  const workspace = workspaces.find((w) => w.id === project.workspaceId)
  const { scrollbackLimit } = useSettingsStore
    .getState()
    .resolveSettings(project.workspaceId).terminal
  return { cwd: project.worktreePath ?? workspace?.folderPath ?? '~', scrollbackLimit }
}

/**
 * Opens a terminal on a branch and shows it.
 *
 * The working directory is the branch's own checkout when it has one — a
 * worktree — and otherwise the repo's folder, the same rule the rest of the app
 * resolves a terminal's cwd by. Returns the new session's id, or null when none opened.
 */
export async function startSessionInBranch(
  projectId: string,
  initialCommand?: string
): Promise<string | null> {
  const place = branchPlace(projectId)
  if (place === null) return null
  const { cwd, scrollbackLimit } = place
  try {
    const sessionId = await createTerminalSession({
      projectId,
      type: 'human',
      title: '',
      cwd,
      scrollbackLimit,
      ...(initialCommand === undefined ? {} : { initialCommand }),
    })
    revealSession(sessionId)
    return sessionId
  } catch {
    // The controller has already said why; Home stays where it is.
    return null
  }
}

export interface AgentInBranch {
  projectId: string
  title: string
  /** What the agent is first told; none starts it with nothing. */
  prompt: string | null
  /** Absent: the default agent. */
  agentId?: string
}

/** Starts an agent as a tab on a branch, tells it the prompt and shows it; null when none started. */
export async function startAgentInBranch(request: AgentInBranch): Promise<string | null> {
  const place = branchPlace(request.projectId)
  if (place === null) return null
  const started = await startAgentTab({
    cwd: place.cwd,
    projectId: request.projectId,
    title: request.title,
    agentId: request.agentId,
  })
  if (started === null) return null
  if (request.prompt !== null) promptAgentTab(started.sessionId, request.prompt)
  revealSession(started.sessionId)
  return started.sessionId
}

/** Opens a scratch terminal — one that belongs to no branch — and shows it. */
export async function startScratchSession(): Promise<void> {
  const workspaces = useWorkspaceStore.getState()
  const { scrollbackLimit } = useSettingsStore
    .getState()
    .resolveSettings(workspaces.activeWorkspaceId ?? null).terminal
  try {
    await createTerminalSession({
      projectId: SCRATCH_PROJECT_ID,
      type: 'human',
      title: 'Scratch',
      cwd: workspaces.resolveActiveCwd(),
      scrollbackLimit,
    })
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

  const sessionId = await reopenConversation(plan, facts)
  if (sessionId === null) return

  const snapshot = { ...facts.snapshot, sessionId }
  await useSessionRecordsStore.getState().transfer(plan.fromSessionId, snapshot)

  // An agent tab resumes under its own id, so the tab to close is the one just opened.
  const previous = useSessionStore.getState().sessions.get(plan.fromSessionId)
  if (previous !== undefined && sessionId !== plan.fromSessionId) {
    await useSessionStore.getState().closeSession(plan.fromSessionId)
  }

  revealSession(sessionId)
}

/** The new session that carries the conversation on, or null when none opened. */
async function reopenConversation(plan: ResumePlan, facts: SessionFacts): Promise<string | null> {
  if (plan.transport === 'acp') {
    const started = await startAgentTab({
      agentId: plan.agentId,
      cwd: plan.cwd,
      resume: plan.conversationId,
      projectId: plan.projectId,
      title: facts.snapshot.tabTitle,
    })
    return started?.sessionId ?? null
  }
  const { scrollbackLimit } = useSettingsStore
    .getState()
    .resolveSettings(useWorkspaceStore.getState().activeWorkspaceId ?? null).terminal
  try {
    return await createTerminalSession({
      projectId: plan.projectId,
      type: 'human',
      title: '',
      cwd: plan.cwd,
      scrollbackLimit,
      parentSessionId: undefined,
      initialCommand: plan.command ?? undefined,
    })
  } catch {
    // The controller has already said why. Nothing has moved.
    return null
  }
}
