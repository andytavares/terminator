import { onProjectDelete } from '../extensions/workspace-events.js'
import type { SessionInfo } from './pty-manager.js'

// A deleted project takes its terminals with it, whoever deleted it — the
// sidebar, or an extension removing a checkout it made. Left running, a
// session has no project to show it in, and an agent keeps working in a
// directory that is being removed.
export function closeSessionsOfDeletedProjects(deps: {
  pty: { listSessions(): SessionInfo[]; kill(sessionId: string): void }
  markClosed: (sessionId: string, at: Date) => Promise<void>
  now?: () => Date
}): () => void {
  const now = deps.now ?? (() => new Date())
  return onProjectDelete((projectId) => {
    for (const session of deps.pty.listSessions()) {
      if (session.projectId !== projectId) continue
      deps.pty.kill(session.sessionId)
      void deps.markClosed(session.sessionId, now())
    }
  })
}
