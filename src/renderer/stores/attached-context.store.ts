import { create, type StoreApi } from 'zustand'
import { useToastStore } from './toast.store'
import { recordUse } from '../usage/record'
import {
  noAttachedContext,
  resolveSessionContext,
  type AttachedContext,
  type Citation,
  type SessionContext,
} from '../components/agent/attached-context'

// What each agent tab will send with its next prompt, keyed by the tab's session id. A store, not
// composer state: the tab bar and the transcript add items from outside the composer.

interface AttachedContextState {
  byTab: Map<string, AttachedContext>
  /** Counts each request to send a tab's composer now, so the composer can react to a new one. */
  sendRequests: Map<string, number>
  addSessions: (tabId: string, contexts: SessionContext[]) => void
  removeSession: (tabId: string, sessionId: string) => void
  addCitation: (tabId: string, citation: Citation) => void
  updateCitation: (tabId: string, index: number, comment: string) => void
  removeCitation: (tabId: string, index: number) => void
  set: (tabId: string, attached: AttachedContext) => void
  clear: (tabId: string) => void
  requestSend: (tabId: string) => void
}

type Change = (attached: AttachedContext) => AttachedContext
type SetState = StoreApi<AttachedContextState>['setState']

/** Applies `change` to `tabId`'s attached context. */
function changeTab(set: SetState, tabId: string, change: Change): void {
  set((state) => {
    const byTab = new Map(state.byTab)
    byTab.set(tabId, change(state.byTab.get(tabId) ?? noAttachedContext))
    return { byTab }
  })
}

/** `contexts` added after `attached`'s sessions, leaving out the tab itself and any already there. */
function withSessions(tabId: string, contexts: SessionContext[]): Change {
  return (attached) => {
    const sessions = [...attached.sessions]
    for (const context of contexts) {
      const known = sessions.some((s) => s.sessionId === context.sessionId)
      if (context.sessionId !== tabId && !known) sessions.push(context)
    }
    return { ...attached, sessions }
  }
}

const withoutSession =
  (sessionId: string): Change =>
  (attached) => ({
    ...attached,
    sessions: attached.sessions.filter((context) => context.sessionId !== sessionId),
  })

const withCitations =
  (change: (citations: Citation[]) => Citation[]): Change =>
  (attached) => ({ ...attached, citations: change(attached.citations) })

const commentedAt = (index: number, comment: string): Change =>
  withCitations((citations) => citations.map((c, i) => (i === index ? { ...c, comment } : c)))

function clearTab(set: SetState, tabId: string): void {
  set((state) => {
    const byTab = new Map(state.byTab)
    byTab.delete(tabId)
    return { byTab }
  })
}

export const useAttachedContextStore = create<AttachedContextState>((set) => ({
  byTab: new Map(),
  sendRequests: new Map(),
  addSessions: (tabId, contexts) => changeTab(set, tabId, withSessions(tabId, contexts)),
  removeSession: (tabId, sessionId) => changeTab(set, tabId, withoutSession(sessionId)),
  addCitation: (tabId, citation) =>
    changeTab(
      set,
      tabId,
      withCitations((citations) => [...citations, citation])
    ),
  updateCitation: (tabId, index, comment) => changeTab(set, tabId, commentedAt(index, comment)),
  removeCitation: (tabId, index) =>
    changeTab(
      set,
      tabId,
      withCitations((citations) => citations.filter((_, i) => i !== index))
    ),
  set: (tabId, attached) => changeTab(set, tabId, () => attached),
  clear: (tabId) => clearTab(set, tabId),
  requestSend: (tabId) =>
    set((s) => ({
      sendRequests: new Map(s.sendRequests).set(tabId, (s.sendRequests.get(tabId) ?? 0) + 1),
    })),
}))

/** A selector for one tab's attached context; the same empty value when it has none. */
export const attachedOf =
  (tabId: string) =>
  (state: AttachedContextState): AttachedContext =>
    state.byTab.get(tabId) ?? noAttachedContext

/** Attaches each session that has a conversation to `tabId`, and says so when one has none. */
export async function attachSessions(tabId: string, sessionIds: string[]): Promise<void> {
  const others = sessionIds.filter((sessionId) => sessionId !== tabId)
  const resolved = await Promise.all(others.map(resolveSessionContext))
  const found = resolved.filter((context): context is SessionContext => context !== null)
  if (found.length > 0) {
    useAttachedContextStore.getState().addSessions(tabId, found)
    recordUse('core.agent.attach-session')
  }
  if (found.length < resolved.length) {
    useToastStore
      .getState()
      .addToast({ type: 'info', message: 'This session has no conversation to attach.' })
  }
}
