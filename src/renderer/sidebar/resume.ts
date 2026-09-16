import type { AgentConversation } from '../../shared/types/index'
import type { SessionFacts } from './session-facts'

/** What resuming one conversation needs. */
export interface ResumePlan {
  /** The session being resumed, whose context moves to the new one. */
  fromSessionId: string
  projectId: string
  /** The folder the conversation ran in. */
  cwd: string
  command: string
  conversationId: string
}

/**
 * An id, and nothing else.
 *
 * The command is typed into a shell, so the id is checked rather than escaped:
 * anything that is not one is a report this application should not have kept,
 * and refusing it costs a Resume that could not have worked anyway.
 */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** How an agent is asked to carry a conversation on, or nothing when it cannot be. */
function resumeCommand(agent: AgentConversation | null): string | null {
  if (agent === null || !ID.test(agent.sessionId)) return null
  if (agent.provider !== 'claude') return null
  return `claude --resume ${agent.sessionId}`
}

/**
 * How to bring a session's conversation back, or nothing when it cannot be.
 *
 * Only a session that has stopped: a running agent has nothing to bring back.
 * The branch comes from the snapshot rather than the live facts, because a
 * closed session has no live facts left — which is exactly the case Resume is
 * for.
 */
export function planResume(facts: SessionFacts): ResumePlan | null {
  if (!facts.isClosed && facts.state !== 'exited') return null
  if (!facts.resumable) return null
  const command = resumeCommand(facts.agent)
  if (command === null || facts.agent === null) return null
  const projectId = facts.snapshot.projectId
  if (projectId === '') return null

  return {
    fromSessionId: facts.sessionId,
    projectId,
    cwd: facts.agent.cwd,
    command,
    conversationId: facts.agent.sessionId,
  }
}
