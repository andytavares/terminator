import { vi } from 'vitest'
import type { SessionInfo, SpawnSessionOptions } from '../../../src/types'

// Stateful fake of the v1.4.0 PtyManagerAPI session authority: real session
// map + data/exit fan-out, with vi.fn spies on every method so tests can both
// drive realistic flows (emitData/emitExit) and assert call shapes.
export function createFakePtyManager() {
  const sessions = new Map<string, SessionInfo>()
  const dataListeners = new Map<string, Set<(data: string) => void>>()
  const exitListeners = new Map<string, Set<(code: number) => void>>()

  function listenerSet<T>(map: Map<string, Set<T>>, id: string): Set<T> {
    let set = map.get(id)
    if (!set) {
      set = new Set()
      map.set(id, set)
    }
    return set
  }

  const fake = {
    sessions,
    /** Seeds a pre-existing session (e.g. one the Electron app created). */
    addSession(info: Partial<SessionInfo> & { sessionId: string }): void {
      sessions.set(info.sessionId, {
        cwd: '/',
        type: 'human',
        origin: 'app',
        createdAt: '2026-01-01T00:00:00.000Z',
        pid: 100,
        ...info,
      })
    },
    /** Emits PTY output to all onData subscribers. */
    emitData(sessionId: string, data: string): void {
      dataListeners.get(sessionId)?.forEach((l) => l(data))
    },
    /** Simulates the PTY exiting: session removed first, then listeners fire. */
    emitExit(sessionId: string, code = 0): void {
      sessions.delete(sessionId)
      const listeners = exitListeners.get(sessionId)
      exitListeners.delete(sessionId)
      dataListeners.delete(sessionId)
      listeners?.forEach((l) => l(code))
    },
    dataListenerCount(sessionId: string): number {
      return dataListeners.get(sessionId)?.size ?? 0
    },

    spawnSession: vi.fn((opts: SpawnSessionOptions): SessionInfo => {
      const info: SessionInfo = {
        sessionId: opts.sessionId,
        cwd: opts.cwd,
        type: opts.type,
        origin: opts.origin,
        createdAt: new Date().toISOString(),
        pid: 111,
        projectId: opts.projectId,
        tabTitle: opts.tabTitle,
      }
      sessions.set(opts.sessionId, info)
      return { ...info }
    }),
    onData: vi.fn((sessionId: string, listener: (data: string) => void) => {
      if (!sessions.has(sessionId)) return null
      const set = listenerSet(dataListeners, sessionId)
      set.add(listener)
      return () => set.delete(listener)
    }),
    onExit: vi.fn((sessionId: string, listener: (code: number) => void) => {
      if (!sessions.has(sessionId)) return null
      const set = listenerSet(exitListeners, sessionId)
      set.add(listener)
      return () => set.delete(listener)
    }),
    getSession: vi.fn((sessionId: string): SessionInfo | undefined => {
      const info = sessions.get(sessionId)
      return info ? { ...info } : undefined
    }),
    setWorkspace: vi.fn((sessionId: string, workspaceId: string | null): boolean => {
      const info = sessions.get(sessionId)
      if (!info) return false
      info.workspaceId = workspaceId ?? undefined
      return true
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn((sessionId: string) => {
      fake.emitExit(sessionId, 0)
    }),
    listSessions: vi.fn((): SessionInfo[] => [...sessions.values()].map((s) => ({ ...s }))),
  }
  return fake
}

export type FakePtyManager = ReturnType<typeof createFakePtyManager>
