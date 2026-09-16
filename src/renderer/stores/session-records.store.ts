import { create } from 'zustand'
import type { SessionRecord, SessionSnapshot, WorkItemRef } from '../../shared/types/index'

// The renderer's mirror of the main process's session records: what the
// operator wrote about each session and the ticket they pinned to it.

interface SessionRecordsState {
  records: Map<string, SessionRecord>
  load: () => Promise<void>
  subscribe: () => () => void
  /** Resolves false when the write was refused, leaving the mirror as it was. */
  setDescription: (session: SessionSnapshot, description: string | null) => Promise<boolean>
  setLink: (session: SessionSnapshot, link: WorkItemRef | null) => Promise<boolean>
}

type WriteResult = { data: SessionRecord | null } | { error: string; message: string }

function api(): Partial<Window['electronAPI']['sessionRecords']> {
  return window.electronAPI?.sessionRecords ?? {}
}

export const useSessionRecordsStore = create<SessionRecordsState>((set) => {
  function apply(sessionId: string, record: SessionRecord | null): void {
    set((state) => {
      const records = new Map(state.records)
      if (record === null) records.delete(sessionId)
      else records.set(sessionId, record)
      return { records }
    })
  }

  async function write(
    sessionId: string,
    call: Promise<WriteResult> | undefined
  ): Promise<boolean> {
    const result = await call
    if (result === undefined || 'error' in result) return false
    apply(sessionId, result.data)
    return true
  }

  return {
    records: new Map(),

    load: async () => {
      try {
        const result = await api().list?.()
        if (result === undefined) return
        set({ records: new Map(result.data.map((r) => [r.sessionId, r])) })
      } catch {
        // Keep the last known history rather than blanking Home.
      }
    },

    subscribe: () => {
      const on = api().onChanged
      if (typeof on !== 'function') return () => {}
      return on(({ sessionId, record }) => apply(sessionId, record))
    },

    setDescription: (session, description) =>
      write(session.sessionId, api().setDescription?.({ session, description })),

    setLink: (session, link) => write(session.sessionId, api().setLink?.({ session, link })),
  }
})
