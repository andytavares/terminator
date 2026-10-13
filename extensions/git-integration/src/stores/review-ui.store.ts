import { create, type StoreApi } from 'zustand'
import { SORT_MODES, type SortMode } from '../review/sort-prs'
import type { AgentRun, AgentScope } from '../schemas/review-agent.schema'

type AgentRequest = 'review' | 'explain' | 'ask'

export type CommentVisibility = 'all' | 'unresolved' | 'hidden'
type DiffRange = 'since' | 'whole'
export type DiffViewMode = 'unified' | 'split'

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

// Keyboard actions the surface-level key handler (useReviewKeys) raises and the
// diff pane performs, because only the pane knows its hunks and selection.
export const REVIEW_KEY_EVENTS = {
  nextHunk: 'review:next-hunk',
  prevHunk: 'review:prev-hunk',
  askAgent: 'review:ask-agent',
  explain: 'review:explain',
  comment: 'review:comment',
  note: 'review:note',
  peekDefinition: 'review:peek-definition',
} as const

const PREFS_KEY = 'git-integration.review-ui.prefs'

interface Prefs {
  commentVisibility: CommentVisibility
  agentNotesOn: boolean
  diffRange: DiffRange
  fileListHidden: boolean
  diffViewMode: DiffViewMode
  hideFormattingHunks: boolean
  queueSort: SortMode
  dashboardSort: SortMode
}

const DEFAULT_PREFS: Prefs = {
  commentVisibility: 'all',
  agentNotesOn: true,
  diffRange: 'since',
  fileListHidden: false,
  diffViewMode: 'unified',
  hideFormattingHunks: true,
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

  setCommentVisibility(v: CommentVisibility): void
  cycleCommentVisibility(): void
  setAgentNotesOn(on: boolean): void
  setDiffRange(r: DiffRange): void
  toggleFileList(): void
  setDiffViewMode(mode: DiffViewMode): void
  setHideFormattingHunks(on: boolean): void
  setQueueSort(mode: SortMode): void
  setDashboardSort(mode: SortMode): void
  setSelection(s: LineSelection | null): void
  requestComposer(r: ComposerRequest | null): void
  setAgentRuns(runs: AgentRun[]): void
  upsertAgentRun(run: AgentRun): void
  openAgentPanel(scope: AgentScope | null, request?: AgentRequest, autoStart?: boolean): void
  setKeyboardHelpOpen(open: boolean): void
  setInsightsOpen(open: boolean): void
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

const CYCLE: CommentVisibility[] = ['all', 'unresolved', 'hidden']

type SetState = StoreApi<ReviewUiStore>['setState']
type GetState = StoreApi<ReviewUiStore>['getState']

/** The preference fields of the store, as savePrefs keeps them. */
function prefsOf(state: ReviewUiStore): Prefs {
  return {
    commentVisibility: state.commentVisibility,
    agentNotesOn: state.agentNotesOn,
    diffRange: state.diffRange,
    fileListHidden: state.fileListHidden,
    diffViewMode: state.diffViewMode,
    hideFormattingHunks: state.hideFormattingHunks,
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
    setCommentVisibility: (v: CommentVisibility) => persist({ commentVisibility: v }),
    cycleCommentVisibility: () => {
      const i = CYCLE.indexOf(get().commentVisibility)
      persist({ commentVisibility: CYCLE[(i + 1) % CYCLE.length] })
    },
    setAgentNotesOn: (on: boolean) => persist({ agentNotesOn: on }),
    setDiffRange: (r: DiffRange) => persist({ diffRange: r }),
    toggleFileList: () => persist({ fileListHidden: !get().fileListHidden }),
    setDiffViewMode: (mode: DiffViewMode) => persist({ diffViewMode: mode }),
    setHideFormattingHunks: (on: boolean) => persist({ hideFormattingHunks: on }),
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
  agentPanelRequest: 'review',
  agentPanelAutoStart: false,
  ...prefActions(set, get),
  ...uiSessionActions(set),
}))
