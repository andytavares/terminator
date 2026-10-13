import { vi } from 'vitest'
import type { SessionInfo, SpawnSessionOptions } from '@terminator/extension-sdk'

/** The fake's state: a real session map and the data/exit fan-out. */
interface FakePtyState {
  sessions: Map<string, SessionInfo>
  dataListeners: Map<string, Set<(data: string) => void>>
  exitListeners: Map<string, Set<(code: number) => void>>
}

// Stateful fake of the SDK 4.0.0 PtyManagerAPI session authority: real session
// map + data/exit fan-out, with vi.fn spies on every method so tests can both
// drive realistic flows (emitData/emitExit) and assert call shapes.
export function createFakePtyManager() {
  const state: FakePtyState = {
    sessions: new Map(),
    dataListeners: new Map(),
    exitListeners: new Map(),
  }
  return {
    sessions: state.sessions,
    ...fakePtyControls(state),
    ...fakeSessionLifecycle(state),
    ...fakeSessionQueries(state),
  }
}

export type FakePtyManager = ReturnType<typeof createFakePtyManager>

function listenerSet<T>(map: Map<string, Set<T>>, id: string): Set<T> {
  let set = map.get(id)
  if (!set) {
    set = new Set()
    map.set(id, set)
  }
  return set
}

/** Subscribes a listener to a live session; a session that is gone gets a no-op unsubscribe. */
function listenerAdder<T>(sessions: Map<string, SessionInfo>, map: Map<string, Set<T>>) {
  return (sessionId: string, listener: T) => {
    if (!sessions.has(sessionId)) return () => {}
    const set = listenerSet(map, sessionId)
    set.add(listener)
    return () => set.delete(listener)
  }
}

/** Simulates the PTY exiting: session removed first, then listeners fire. */
function emitPtyExit(state: FakePtyState, sessionId: string, code = 0): void {
  state.sessions.delete(sessionId)
  const listeners = state.exitListeners.get(sessionId)
  state.exitListeners.delete(sessionId)
  state.dataListeners.delete(sessionId)
  listeners?.forEach((l) => l(code))
}

/** What a test drives the fake with, beyond the API it stands in for. */
function fakePtyControls(state: FakePtyState) {
  return {
    /** Seeds a pre-existing session (e.g. one the Electron app created). */
    addSession(info: Partial<SessionInfo> & { sessionId: string }): void {
      state.sessions.set(info.sessionId, {
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
      state.dataListeners.get(sessionId)?.forEach((l) => l(data))
    },
    emitExit(sessionId: string, code = 0): void {
      emitPtyExit(state, sessionId, code)
    },
    dataListenerCount(sessionId: string): number {
      return state.dataListeners.get(sessionId)?.size ?? 0
    },
  }
}

function fakeSessionLifecycle(state: FakePtyState) {
  const { sessions } = state
  return {
    spawnSession: vi.fn(async (opts: SpawnSessionOptions): Promise<SessionInfo> => {
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
    onData: vi.fn(listenerAdder(sessions, state.dataListeners)),
    onExit: vi.fn(listenerAdder(sessions, state.exitListeners)),
  }
}

function fakeSessionQueries(state: FakePtyState) {
  const { sessions } = state
  return {
    getSession: vi.fn(async (sessionId: string): Promise<SessionInfo | undefined> => {
      const info = sessions.get(sessionId)
      return info ? { ...info } : undefined
    }),
    setWorkspace: vi.fn(async (sessionId: string, workspaceId: string | null): Promise<boolean> => {
      const info = sessions.get(sessionId)
      if (!info) return false
      info.workspaceId = workspaceId ?? undefined
      return true
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn((sessionId: string) => emitPtyExit(state, sessionId, 0)),
    listSessions: vi.fn(
      async (): Promise<SessionInfo[]> => [...sessions.values()].map((s) => ({ ...s }))
    ),
  }
}
