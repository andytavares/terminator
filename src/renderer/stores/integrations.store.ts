import { create } from 'zustand'
import type {
  Issue,
  IssueLink,
  IssueListResult,
  MineSelector,
  TrackerConnection,
  TrackerId,
} from '../../shared/types/index'

// Renderer-side view of the issue-tracker integrations.
//
// Holds no secret and never asks for one back: the main process reports
// whether a tracker is connected and which account proved it, and that is all
// any surface here needs to render.

export interface ConnectLinearInput {
  tracker: 'linear'
  apiKey: string
  email?: string | null
}

export interface ConnectJiraInput {
  tracker: 'jira'
  site: string
  email: string
  apiToken: string
  jql: string
}

interface IntegrationsState {
  connections: TrackerConnection[]
  /** Per-project links, keyed by project id. Populated as projects are seen. */
  links: Map<string, IssueLink | null>
  /**
   * The issue behind each link, when it could be read. A link with no issue
   * here renders as unavailable rather than disappearing.
   */
  issues: Map<string, Issue | null>
  loading: boolean
  /**
   * Which project's link picker is open, if any.
   *
   * Held here rather than in a component because two surfaces open the same
   * dialog — the sidebar's context menu and the command palette — and only one
   * of them renders it.
   */
  linkDialogProjectId: string | null
  /** Which project's issue drawer is open, if any. Same reasoning as above. */
  drawerProjectId: string | null
  /** Last failure from a connect attempt, per tracker, for inline display. */
  connectError: Partial<Record<TrackerId, string>>

  loadConnections: () => Promise<void>
  loadLink: (projectId: string) => Promise<void>
  linkIssue: (
    projectId: string,
    tracker: TrackerId,
    key: string,
    injectContext?: boolean
  ) => Promise<boolean>
  unlinkIssue: (projectId: string) => Promise<void>
  listMine: (opts?: { limit?: number }) => Promise<IssueListResult>
  searchIssues: (term: string) => Promise<IssueListResult>
  connect: (input: ConnectLinearInput | ConnectJiraInput) => Promise<boolean>
  disconnect: (tracker: TrackerId) => Promise<void>
  setMine: (tracker: TrackerId, mine: MineSelector) => Promise<void>
  clearConnectError: (tracker: TrackerId) => void
  openLinkDialog: (projectId: string) => void
  closeLinkDialog: () => void
  openDrawer: (projectId: string) => void
  closeDrawer: () => void
  subscribe: () => () => void

  connectionFor: (tracker: TrackerId) => TrackerConnection | undefined
  linkFor: (projectId: string) => IssueLink | null
  issueFor: (projectId: string) => Issue | null
  isAnyConnected: () => boolean
}

const EMPTY_RESULT: IssueListResult = { issues: [], failures: [] }

interface ErrorEnvelope {
  error: string
  message?: string
}

function isError(result: unknown): result is ErrorEnvelope {
  return typeof result === 'object' && result !== null && 'error' in result
}

/**
 * The value, or null when the call failed or the transport does not carry it.
 *
 * Callers get one thing to check instead of two, and a method missing from a
 * transport reads exactly like a call that failed — which, from the store's
 * point of view, it is.
 */
function ok<T>(result: T | ErrorEnvelope | undefined): T | null {
  if (result === undefined || isError(result)) return null
  return result
}

/**
 * The integrations surface, or nothing.
 *
 * Not every transport carries every method: the remote `/app/` shim omits
 * `connect` and `disconnect` by design, since a LAN client has no business
 * writing tracker credentials. A store that assumed the whole namespace was
 * present would break that surface on load, so every call goes through here
 * and a missing method is a no-op rather than a crash.
 */
type IntegrationsApi = Window['electronAPI']['integrations']

function api(): Partial<IntegrationsApi> {
  return (window.electronAPI?.integrations ?? {}) as Partial<IntegrationsApi>
}

/** Subscribing to a channel this transport does not carry unsubscribes to nothing. */
function subscribeTo(
  method: 'onStatusChanged' | 'onLinkChanged',
  handler: (payload: unknown) => void
): () => void {
  const fn = api()[method]
  return typeof fn === 'function' ? fn(handler) : () => {}
}

export const useIntegrationsStore = create<IntegrationsState>((set, get) => ({
  connections: [],
  links: new Map(),
  issues: new Map(),
  loading: false,
  linkDialogProjectId: null,
  drawerProjectId: null,
  connectError: {},

  loadConnections: async () => {
    set({ loading: true })
    const result = ok(await api().status?.({}))
    set({ loading: false })
    if (result === null) return
    set({ connections: result.connections })
  },

  connect: async (input) => {
    const result = await api().connect?.(input)
    if (result === undefined || isError(result)) {
      // Shown against the field the operator just filled in, rather than as a
      // toast they have to go and find.
      set((state) => ({
        connectError: {
          ...state.connectError,
          [input.tracker]: (result as ErrorEnvelope | undefined)?.message ?? 'Could not connect',
        },
      }))
      return false
    }
    set((state) => ({ connectError: { ...state.connectError, [input.tracker]: undefined } }))
    await get().loadConnections()
    return true
  },

  loadLink: async (projectId) => {
    const result = ok(await api().linkGet?.({ projectId }))
    if (result === null) return
    set((state) => ({
      links: new Map(state.links).set(projectId, result.link),
      issues: new Map(state.issues).set(projectId, result.issue),
    }))
  },

  linkIssue: async (projectId, tracker, key, injectContext) => {
    const result = ok(await api().linkSet?.({ projectId, tracker, key, injectContext }))
    if (result === null) return false
    // Read back rather than trusting the write: the badge needs the issue's
    // state, which only the read returns.
    await get().loadLink(projectId)
    return true
  },

  unlinkIssue: async (projectId) => {
    await api().linkClear?.({ projectId })
    set((state) => ({
      links: new Map(state.links).set(projectId, null),
      issues: new Map(state.issues).set(projectId, null),
    }))
  },

  listMine: async (opts = {}) => {
    return ok(await api().listMine?.({ limit: opts.limit })) ?? EMPTY_RESULT
  },

  searchIssues: async (term) => {
    return ok(await api().search?.({ term })) ?? EMPTY_RESULT
  },

  disconnect: async (tracker) => {
    await api().disconnect?.({ tracker })
    await get().loadConnections()
  },

  setMine: async (tracker, mine) => {
    await api().setMine?.({ tracker, mine })
    await get().loadConnections()
  },

  openLinkDialog: (projectId) => set({ linkDialogProjectId: projectId }),

  closeLinkDialog: () => set({ linkDialogProjectId: null }),

  openDrawer: (projectId) => set({ drawerProjectId: projectId }),

  closeDrawer: () => set({ drawerProjectId: null }),

  clearConnectError: (tracker) => {
    set((state) => ({ connectError: { ...state.connectError, [tracker]: undefined } }))
  },

  subscribe: () => {
    const offStatus = subscribeTo('onStatusChanged', (payload) => {
      const connections = (payload as { connections?: TrackerConnection[] } | undefined)
        ?.connections
      if (Array.isArray(connections)) set({ connections })
    })
    const offLink = subscribeTo('onLinkChanged', (payload) => {
      const event = payload as { projectId?: string; link?: IssueLink | null } | undefined
      if (typeof event?.projectId !== 'string') return
      set((state) => ({ links: new Map(state.links).set(event.projectId!, event.link ?? null) }))
      // A link that changed elsewhere needs its issue re-read for the badge.
      if (event.link != null) void get().loadLink(event.projectId)
    })
    return () => {
      offStatus()
      offLink()
    }
  },

  connectionFor: (tracker) => get().connections.find((c) => c.tracker === tracker),

  linkFor: (projectId) => get().links.get(projectId) ?? null,

  issueFor: (projectId) => get().issues.get(projectId) ?? null,

  isAnyConnected: () => get().connections.some((c) => c.connected),
}))
