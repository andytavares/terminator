import { create, type StoreApi } from 'zustand'
import type { SessionRecordListing, SessionSnapshot, WorkItemRef } from '../../shared/types/index'

// The renderer's mirror of the main process's session records: what the
// operator wrote about each session and the ticket they pinned to it.

interface SessionRecordsState {
  records: Map<string, SessionRecordListing>
  load: () => Promise<void>
  subscribe: () => () => void
  /** Resolves false when the write was refused, leaving the mirror as it was. */
  setDescription: (session: SessionSnapshot, description: string | null) => Promise<boolean>
  setLink: (session: SessionSnapshot, link: WorkItemRef | null) => Promise<boolean>
  /** Moves a session's context onto the session that resumed it. */
  transfer: (fromSessionId: string, session: SessionSnapshot) => Promise<boolean>
  /** Drops a closed session's record, taking it out of the list for good. */
  forget: (sessionId: string) => Promise<boolean>
}

type WriteResult = { data: SessionRecordListing | null } | { error: string; message: string }

function api(): Partial<Window['electronAPI']['sessionRecords']> {
  return window.electronAPI?.sessionRecords ?? {}
}

type SetRecords = StoreApi<SessionRecordsState>['setState']

/** The records with `sessionId`'s set to `record`, or removed when it is null. */
function withRecord(
  state: SessionRecordsState,
  sessionId: string,
  record: SessionRecordListing | null
): Pick<SessionRecordsState, 'records'> {
  const records = new Map(state.records)
  if (record === null) records.delete(sessionId)
  else records.set(sessionId, record)
  return { records }
}

/** Mirrors a write main accepted; false when it was refused or not carried. */
async function write(
  set: SetRecords,
  sessionId: string,
  call: Promise<WriteResult> | undefined
): Promise<boolean> {
  const result = await call
  if (result === undefined || 'error' in result) return false
  set((state) => withRecord(state, sessionId, result.data))
  return true
}

async function load(set: SetRecords): Promise<void> {
  try {
    const result = await api().list?.()
    if (result === undefined) return
    set({ records: new Map(result.data.map((r) => [r.sessionId, r])) })
  } catch {
    // Keep the last known history rather than blanking Home.
  }
}

async function transferRecord(
  set: SetRecords,
  fromSessionId: string,
  session: SessionSnapshot
): Promise<boolean> {
  const result = await api().transfer?.({ fromSessionId, session })
  if (result === undefined || 'error' in result) return false
  set((state) => {
    const records = new Map(state.records)
    records.delete(fromSessionId)
    if (result.data !== null) records.set(session.sessionId, result.data)
    return { records }
  })
  return true
}

async function forgetRecord(set: SetRecords, sessionId: string): Promise<boolean> {
  const result = await api().forget?.({ sessionId })
  if (result === undefined || 'error' in result || result.data !== true) return false
  set((state) => withRecord(state, sessionId, null))
  return true
}

export const useSessionRecordsStore = create<SessionRecordsState>((set) => ({
  records: new Map(),
  load: () => load(set),
  subscribe: () => {
    const on = api().onChanged
    if (typeof on !== 'function') return () => {}
    return on(({ sessionId, record }) => set((state) => withRecord(state, sessionId, record)))
  },
  setDescription: (session, description) =>
    write(set, session.sessionId, api().setDescription?.({ session, description })),
  setLink: (session, link) => write(set, session.sessionId, api().setLink?.({ session, link })),
  transfer: (fromSessionId, session) => transferRecord(set, fromSessionId, session),
  forget: (sessionId) => forgetRecord(set, sessionId),
}))
