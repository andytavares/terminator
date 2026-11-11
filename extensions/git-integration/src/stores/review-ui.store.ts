import { create, type StoreApi } from 'zustand'
import { SORT_MODES, type SortMode } from '../review/sort-prs'
import type { AgentRun, AgentScope } from '../schemas/review-agent.schema'

type AgentRequest = 'review' | 'explain' | 'ask'

type DiffRange = 'since' | 'whole'
type GroupBy = 'chapters' | 'all'

/** A line range the reviewer has selected in the diff, for the float bar and the agent. */
export interface LineSelection {
  path: string
  side: 'LEFT' | 'RIGHT'
  startLine: number
  endLine: number
}

/** A composer opened from somewhere other than the gutter (an agent finding, the float bar). */
export interface ComposerRequest {
  path: string
  side: 'LEFT' | 'RIGHT'
  line: number
  startLine: number | null
  body: string
  fromFindingId: string | null
}

/** A hunk the reviewer put off with `l`, to come back to after the last hunk. */
export interface LaterHunk {
  path: string
  header: string
}

/** The key laterHunks keeps a pull request's later hunks under. */
export function laterKey(repoRoot: string, prNumber: number): string {
  return `${repoRoot}#${prNumber}`
}

// Keyboard actions the surface-level key handler (useReviewKeys) raises and the
// diff pane performs, because only the pane knows its hunks and selection.
export const REVIEW_KEY_EVENTS = {
  nextHunk: 'review:next-hunk',
  prevHunk: 'review:prev-hunk',
  markHunkRead: 'review:mark-hunk-read',
  later: 'review:later-hunk',
  comment: 'review:comment',
} as const

const PREFS_KEY = 'git-integration.review-ui.prefs'

interface Prefs {
  diffRange: DiffRange
  groupBy: GroupBy
  queueSort: SortMode
  dashboardSort: SortMode
}

const DEFAULT_PREFS: Prefs = {
  diffRange: 'since',
  groupBy: 'all',
  queueSort: 'newest',
  dashboardSort: 'newest',
}

interface ReviewUiStore extends Prefs {
  selection: LineSelection | null
  composerRequest: ComposerRequest | null
  /** Agent runs for the open PR, newest first. */
  agentRuns: AgentRun[]
  /** The scope the agent panel is showing, before or while it runs. */
  agentPanelScope: AgentScope | null
  /** What the panel asks for when it opens; autoStart runs it without a click (Explain). */
  agentPanelRequest: AgentRequest
  agentPanelAutoStart: boolean
  keyboardHelpOpen: boolean
  insightsOpen: boolean
  /** Later hunks per pull request (laterKey), in the order they were put off. Kept in memory only. */
  laterHunks: Record<string, LaterHunk[]>
  /** A later hunk the review came back to; the diff pane scrolls to it, then clears it. */
  revisitHunk: LaterHunk | null

  setDiffRange(r: DiffRange): void
  setGroupBy(groupBy: GroupBy): void
  setQueueSort(mode: SortMode): void
  setDashboardSort(mode: SortMode): void
  setSelection(s: LineSelection | null): void
  requestComposer(r: ComposerRequest | null): void
  setAgentRuns(runs: AgentRun[]): void
  upsertAgentRun(run: AgentRun): void
  openAgentPanel(scope: AgentScope | null, request?: AgentRequest, autoStart?: boolean): void
  setKeyboardHelpOpen(open: boolean): void
  setInsightsOpen(open: boolean): void
  deferHunk(key: string, hunk: LaterHunk): void
  takeLaterHunk(key: string): LaterHunk | null
  clearRevisitHunk(): void
  resetForPr(): void
}

function loadPrefs(): Prefs {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const prefs = { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) }
    const known = (mode: SortMode) => SORT_MODES.includes(mode)
    return {
      ...prefs,
      queueSort: known(prefs.queueSort) ? prefs.queueSort : DEFAULT_PREFS.queueSort,
      dashboardSort: known(prefs.dashboardSort) ? prefs.dashboardSort : DEFAULT_PREFS.dashboardSort,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Preferences are a convenience; a blocked store keeps the defaults.
  }
}

type SetState = StoreApi<ReviewUiStore>['setState']
type GetState = StoreApi<ReviewUiStore>['getState']

/** The preference fields of the store, as savePrefs keeps them. */
function prefsOf(state: ReviewUiStore): Prefs {
  return {
    diffRange: state.diffRange,
    groupBy: state.groupBy,
    queueSort: state.queueSort,
    dashboardSort: state.dashboardSort,
  }
}

/** Setters for the preferences, each saved as it changes. */
function prefActions(set: SetState, get: GetState) {
  const persist = (patch: Partial<Prefs>) => {
    set(patch)
    savePrefs(prefsOf(get()))
  }
  return {
    setDiffRange: (r: DiffRange) => persist({ diffRange: r }),
    setGroupBy: (groupBy: GroupBy) => persist({ groupBy }),
    setQueueSort: (mode: SortMode) => persist({ queueSort: mode }),
    setDashboardSort: (mode: SortMode) => persist({ dashboardSort: mode }),
  }
}

/** What resetForPr clears: everything about the PR that was open. */
const NO_PR_STATE = {
  selection: null,
  composerRequest: null,
  agentRuns: [],
  agentPanelScope: null,
  keyboardHelpOpen: false,
  insightsOpen: false,
  revisitHunk: null,
}

const isSameHunk = (a: LaterHunk, b: LaterHunk) => a.path === b.path && a.header === b.header

/** Putting hunks off with `l` and coming back to them after the last hunk. */
function laterActions(set: SetState, get: GetState) {
  const listFor = (key: string) => get().laterHunks[key] ?? []
  const setList = (key: string, list: LaterHunk[]) =>
    set((state) => ({ laterHunks: { ...state.laterHunks, [key]: list } }))
  return {
    deferHunk: (key: string, hunk: LaterHunk) =>
      setList(key, [...listFor(key).filter((h) => !isSameHunk(h, hunk)), hunk]),
    takeLaterHunk: (key: string) => {
      const [first, ...rest] = listFor(key)
      if (!first) return null
      setList(key, rest)
      set({ revisitHunk: first })
      return first
    },
    clearRevisitHunk: () => set({ revisitHunk: null }),
  }
}

function uiSessionActions(set: SetState) {
  return {
    setSelection: (s: LineSelection | null) => set({ selection: s }),
    requestComposer: (r: ComposerRequest | null) => set({ composerRequest: r }),
    setAgentRuns: (runs: AgentRun[]) => set({ agentRuns: runs }),
    upsertAgentRun: (run: AgentRun) =>
      set((state) => ({ agentRuns: [run, ...state.agentRuns.filter((r) => r.id !== run.id)] })),
    openAgentPanel: (
      scope: AgentScope | null,
      request: AgentRequest = 'review',
      autoStart = false
    ) =>
      set({ agentPanelScope: scope, agentPanelRequest: request, agentPanelAutoStart: autoStart }),
    setKeyboardHelpOpen: (open: boolean) => set({ keyboardHelpOpen: open }),
    setInsightsOpen: (open: boolean) => set({ insightsOpen: open }),
    resetForPr: () => set(NO_PR_STATE),
  }
}

export const useReviewUiStore = create<ReviewUiStore>((set, get) => ({
  ...loadPrefs(),
  ...NO_PR_STATE,
  laterHunks: {},
  agentPanelRequest: 'review',
  agentPanelAutoStart: false,
  ...prefActions(set, get),
  ...uiSessionActions(set),
  ...laterActions(set, get),
}))
