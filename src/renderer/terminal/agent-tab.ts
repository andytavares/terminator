import type { AgentStarted } from '@terminator/extension-sdk'

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
  return 'data' in reply ? reply.data : null
}

/** Sends the first words to an agent tab without waiting for its turn to end. */
export function promptAgentTab(sessionId: string, text: string): void {
  void window.electronAPI.agents.prompt({ sessionId, text })
}
