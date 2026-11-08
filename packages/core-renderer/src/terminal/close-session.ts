import { useSessionStore } from '../stores/session.store'
import type { SessionFacts } from '../sidebar/session-facts'

/**
 * End a session from a surface that only knows its facts.
 *
 * Leaves the split layout first and then ends the session, which is what Cmd+W
 * and the sidebar's close already do: ending it without leaving the split
 * leaves a pane pointing at a terminal that has gone.
 *
 * A closed session is not ended again — it survives only as a record, and its
 * description and conversation stay on it either way.
 */
export async function closeSessionFromFacts(facts: SessionFacts): Promise<void> {
  if (facts.isClosed) return
  const store = useSessionStore.getState()
  if (facts.projectId !== null) store.closeSplitLeaf(facts.projectId, facts.sessionId)
  await store.closeSession(facts.sessionId)
}
