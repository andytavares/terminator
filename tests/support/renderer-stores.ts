import { vi, type Mock } from 'vitest'
import type { StoreApi } from 'zustand'
import type {
  Extension,
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
export function workspaceFixture(overrides: Partial<Workspace> & Pick<Workspace, 'id'>): Workspace {
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
export function projectFixture(
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

/** An installed extension, as main lists it. */
export function extensionOf(overrides: Partial<Extension> & Pick<Extension, 'id'>): Extension {
  return {
    name: overrides.id,
    version: '1.0.0',
    description: '',
    entryPoint: `/extensions/${overrides.id}/main.cjs`,
    status: 'enabled',
    installedAt: CREATED,
    ...overrides,
  }
}

/** A connected Linear tracker, for the integrations store's `connections`. */
export function trackerConnectionOf(overrides: Partial<TrackerConnection> = {}): TrackerConnection {
  return {
    tracker: 'linear',
    connected: true,
    account: { name: 'Andrew', email: 'a@b.co' },
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
export function issueFixture(overrides: Partial<Issue> = {}): Issue {
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

/** Puts a real renderer store back in its initial state with `overrides` on top; its own
 * actions stay, so a spec sees what the store does. */
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

/** Seeds a real renderer store from its initial state, with every function a `vi.fn()` (the
 * real actions call `window.electronAPI`) and `overrides` on top, and returns that state:
 * `seedStore(useWorkspaceStore, { workspaces: [ws] }).createWorkspace`. */
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
