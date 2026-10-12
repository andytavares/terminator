import { vi, type Mock } from 'vitest'
import type { StoreApi } from 'zustand'
import type {
  Issue,
  IssueSummary,
  Project,
  SessionRecordListing,
  SessionSnapshot,
  TerminalSession,
  TrackerConnection,
  Workspace,
} from '../../src/shared/types/index'

const CREATED = '2026-01-01T00:00:00.000Z'

/** A complete workspace for store state; `overrides` names what the spec cares about. */
export function workspaceOf(overrides: Partial<Workspace> & Pick<Workspace, 'id'>): Workspace {
  return {
    name: overrides.id,
    folderPath: `/repos/${overrides.id}`,
    color: '#4A90E2',
    tags: [],
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  }
}

/** A complete project for store state. */
export function projectOf(
  overrides: Partial<Project> & Pick<Project, 'id' | 'workspaceId'>
): Project {
  return {
    name: overrides.id,
    isWorktree: false,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  }
}

/** A complete terminal session for store state. */
export function terminalSessionOf(
  overrides: Partial<TerminalSession> & Pick<TerminalSession, 'id' | 'projectId'>
): TerminalSession {
  return {
    tabTitle: overrides.id,
    status: 'active',
    type: 'human',
    scrollbackLimit: 10_000,
    createdAt: CREATED,
    lastActivityAt: 0,
    agentState: 'idle',
    ...overrides,
  }
}

/** A connected Linear tracker, for the integrations store's `connections`. */
export function trackerConnectionOf(overrides: Partial<TrackerConnection> = {}): TrackerConnection {
  return {
    tracker: 'linear',
    connected: true,
    account: { name: 'Andrew', email: 'a@b.co' },
    site: null,
    mine: { kind: 'assignee', email: null },
    lastError: null,
    ...overrides,
  }
}

/** A complete issue summary, as `listMine` and `searchIssues` return them. */
export function issueSummaryOf(overrides: Partial<IssueSummary> = {}): IssueSummary {
  const key = overrides.key ?? 'TAV-42'
  return {
    tracker: 'linear',
    id: `id-${key}`,
    key,
    title: 'Unify Linear connections',
    url: `https://linear.app/tav/issue/${key}`,
    state: { name: 'In Progress', type: 'started' },
    assignee: null,
    branchName: null,
    ...overrides,
  }
}

/** A complete issue, as the integrations store holds a project's linked one. */
export function issueOf(overrides: Partial<Issue> = {}): Issue {
  return {
    ...issueSummaryOf(overrides),
    description: '',
    labels: [],
    completed: false,
    updatedAt: CREATED,
    comments: [],
    ...overrides,
  }
}

/** The record the main process keeps for a session, as the session-records store holds it. */
export function sessionRecordOf(
  snapshot: SessionSnapshot,
  overrides: Partial<SessionRecordListing> = {}
): SessionRecordListing {
  return {
    ...snapshot,
    description: null,
    link: null,
    agent: null,
    resumable: false,
    updatedAt: CREATED,
    ...overrides,
  }
}

/**
 * Put a real renderer store back in its initial state, with `overrides` on
 * top. Its own actions and getters stay, so a spec sees what the store does;
 * `overrides` replaces only what it names (an action that reaches the main
 * process, say).
 */
export function resetStore<State extends object>(
  store: Pick<StoreApi<State>, 'getInitialState' | 'setState'>,
  overrides: Partial<State> = {}
): void {
  store.setState({ ...store.getInitialState(), ...overrides }, true)
}

/** A store's state with every function a `vi.fn()` of the same signature. */
export type Seeded<State> = {
  [Key in keyof State]: State[Key] extends (...args: infer Args) => infer Result
    ? State[Key] & Mock<(...args: Args) => Result>
    : State[Key]
}

/** What `seedStore(useXStore)` returns: `let workspaces: SeededStore<typeof useWorkspaceStore>`. */
export type SeededStore<Hook extends { getState: () => object }> = Seeded<
  ReturnType<Hook['getState']>
>

/**
 * Put a real renderer store (`useWorkspaceStore`, `useSessionStore`, ...) in a
 * known state for one spec, and return that state.
 *
 * The state starts from the store's own initial state, so every field is there
 * with its real type; every function in it becomes a `vi.fn()`, because the
 * real actions call `window.electronAPI`; `overrides` sets the rest. Components
 * read it through the real hook, selectors and `getState()` included.
 *
 *   const workspaces = seedStore(useWorkspaceStore, { workspaces: [ws] })
 *   expect(workspaces.createWorkspace).toHaveBeenCalledWith(...)
 */
export function seedStore<State extends object>(
  store: Pick<StoreApi<State>, 'getInitialState' | 'setState'>,
  overrides: Partial<State> = {}
): Seeded<State> {
  const stubbed = Object.fromEntries(
    Object.entries(store.getInitialState()).map(([key, value]) => [
      key,
      typeof value === 'function' ? vi.fn() : value,
    ])
  )
  const state = { ...stubbed, ...overrides } as Seeded<State>
  store.setState(state, true)
  return state
}
