import type { AgentStarted } from '@terminator/extension-sdk'
import { recordUse } from '../usage/record'

export interface AgentTabRequest {
  cwd: string
  projectId: string
  title: string
  /** Absent: the default agent. */
  agentId?: string
  /** The agent's session to continue. */
  resume?: string
}

/** Starts an agent as a tab of the project; null when the agent did not start. */
export async function startAgentTab(request: AgentTabRequest): Promise<AgentStarted | null> {
  const { projectId, title, ...rest } = request
  const reply = await window.electronAPI.agents.start({ ...rest, tab: { projectId, title } })
  const started = 'data' in reply ? reply.data : null
  recordAgentStart(rest.agentId, started === null)
  return started
}

/** One feature per agent. An agent id is the operator's own name for it, so only the characters a
 * feature id allows are kept. */
function recordAgentStart(agentId: string | undefined, failed: boolean): void {
  const name = (agentId ?? 'default')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .slice(0, 40)
  recordUse(`core.agent.start.${name}`, 'click', {
    failed,
    declare: { label: `Start ${agentId ?? 'the default agent'}`, kind: 'control', source: 'core' },
  })
}

/** Sends the first words to an agent tab without waiting for its turn to end. */
export function promptAgentTab(sessionId: string, text: string): void {
  void window.electronAPI.agents.prompt({ sessionId, text })
}
