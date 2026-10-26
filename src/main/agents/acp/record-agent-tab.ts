import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentConversation, SessionSnapshot } from '../../../shared/types/index.js'
import { setAgent } from '../../sessions/session-record-store.js'
import { projectPlace } from '../../sessions/session-snapshot.js'

/** An agent session that opened a tab: the facts a session record needs. */
export interface AgentTab {
  sessionId: string
  agentId: string
  cwd: string
  tab: { projectId: string; title: string }
}

function realPath(target: string): string {
  try {
    return realpathSync(target)
  } catch {
    return target
  }
}

/** Where Claude Code keeps a session's transcript: a folder named after the resolved
 *  working directory, so `/var/...` on macOS is `-private-var-...`. @internal */
export function transcriptPathFor(cwd: string, sessionId: string, home = homedir()): string {
  const encoded = realPath(cwd).replace(/[/.]/g, '-')
  return join(home, '.claude', 'projects', encoded, `${sessionId}.jsonl`)
}

/** @internal */
export function conversationOfTab(session: AgentTab, capturedAt: string): AgentConversation {
  return {
    agentId: session.agentId,
    transport: 'acp',
    sessionId: session.sessionId,
    transcriptPath:
      session.agentId === 'claude' ? transcriptPathFor(session.cwd, session.sessionId) : null,
    cwd: session.cwd,
    capturedAt,
  }
}

/** Keeps the conversation of an agent tab on the session record, so Resume can bring it back. */
export function recordAgentTab(session: AgentTab, now: () => string): void {
  const startedAt = now()
  const snapshot: SessionSnapshot = {
    sessionId: session.sessionId,
    projectId: session.tab.projectId,
    ...projectPlace(session.tab.projectId),
    tabTitle: session.tab.title,
    shell: null,
    startedAt,
  }
  void setAgent(snapshot, conversationOfTab(session, startedAt))
}
