import { SESSION_ID, type AgentConversation } from '../../shared/types/index'
import type { SessionFacts } from './session-facts'

/** What resuming one conversation needs. */
export interface ResumePlan {
  /** The session being resumed, whose context moves to the new one. */
  fromSessionId: string
  projectId: string
  /** The folder the conversation ran in. */
  cwd: string
  transport: AgentConversation['transport']
  agentId: string
  /** The line to type in a terminal; none for an agent tab. */
  command: string | null
  conversationId: string
}

/** Whether the conversation can be carried on: an agent tab takes the id as data, a terminal as text. */
function canResume(agent: AgentConversation): boolean {
  return (
    agent.transport === 'acp' || (agent.agentId === 'claude' && SESSION_ID.test(agent.sessionId))
  )
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
  if (facts.agent === null || !canResume(facts.agent)) return null
  const projectId = facts.snapshot.projectId
  if (projectId === '') return null

  return {
    fromSessionId: facts.sessionId,
    projectId,
    cwd: facts.agent.cwd,
    transport: facts.agent.transport,
    agentId: facts.agent.agentId,
    command: facts.agent.transport === 'tui' ? `claude --resume ${facts.agent.sessionId}` : null,
    conversationId: facts.agent.sessionId,
  }
}
