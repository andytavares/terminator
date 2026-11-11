import type React from 'react'
import { useSessionStore } from '../../stores/session.store'
import { useSessionRecordsStore } from '../../stores/session-records.store'
import { useToastStore } from '../../stores/toast.store'
import { recordUse } from '../../usage/record'
import {
  promptWithContext,
  resolveSessionContext,
  type SessionContext,
} from '../agent/attached-context'
import { SESSION_DRAG_TYPE } from '../agent/session-drag'

/** Whether `sessionId`'s terminal runs an agent: hooks reported a turn, or its record names one. */
export function runsAgent(sessionId: string): boolean {
  const session = useSessionStore.getState().sessions.get(sessionId)
  if (!session || session.status === 'closed' || session.surface === 'agent') return false
  if (session.agentTurn !== undefined) return true
  return Boolean(useSessionRecordsStore.getState().records.get(sessionId)?.agent)
}

/** Pastes one context block for the carried sessions into `sessionId`'s terminal, without Enter. */
export async function pasteSessionContext(sessionId: string, carriedIds: string[]): Promise<void> {
  const others = carriedIds.filter((carriedId) => carriedId !== sessionId)
  const resolved = await Promise.all(others.map(resolveSessionContext))
  const sessions = resolved.filter((context): context is SessionContext => context !== null)
  if (sessions.length === 0) {
    useToastStore.getState().addToast({
      type: 'info',
      message: 'Nothing to paste: these sessions have no conversation or output.',
    })
    return
  }
  const block = promptWithContext('', { sessions, citations: [] })
  useSessionStore.getState().getTerminalInstance(sessionId)?.terminal.paste(block)
  recordUse('core.terminal.paste-session-context')
}

/** Lets a session drag drop on `sessionId`'s terminal when an agent runs there; true when it does. */
export function allowSessionDrop(e: React.DragEvent, sessionId: string | null): boolean {
  if (!sessionId || !e.dataTransfer.types.includes(SESSION_DRAG_TYPE)) return false
  if (!runsAgent(sessionId)) return false
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  return true
}

/** Pastes the context of the sessions a drop carries; false when it carries none. */
export function dropSessions(e: React.DragEvent, sessionId: string): boolean {
  if (!e.dataTransfer.types.includes(SESSION_DRAG_TYPE) || !runsAgent(sessionId)) return false
  void pasteSessionContext(sessionId, e.dataTransfer.getData(SESSION_DRAG_TYPE).split('\n'))
  return true
}
