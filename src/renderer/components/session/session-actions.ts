import type { SessionActions } from '../../sidebar/session-facts'
import { useSessionRecordsStore } from '../../stores/session-records.store'
import { revealSession } from '../../terminal/navigate-to-session'
import { closeSessionFromFacts } from '../../terminal/close-session'
import { resumeSession } from '../../terminal/start-session'

/** What a session row or tile does on Home and the wall, the same everywhere: open it, save its
 * description, resume, close, or forget a closed one. */
export const SESSION_ACTIONS: SessionActions = {
  onOpen: (sessionId) => revealSession(sessionId),
  onSaveDescription: (target, description) =>
    void useSessionRecordsStore.getState().setDescription(target.snapshot, description),
  onResume: (facts) => void resumeSession(facts),
  onCloseSession: (facts) => void closeSessionFromFacts(facts),
  onForgetSession: (facts) => void useSessionRecordsStore.getState().forget(facts.sessionId),
}
