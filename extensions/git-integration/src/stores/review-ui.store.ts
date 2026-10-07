import { create } from 'zustand'
import { SORT_MODES, type SortMode } from '../review/sort-prs'
import type { AgentRun, AgentScope } from '../schemas/review-agent.schema'

export type AgentRequest = 'review' | 'explain' | 'ask'

export type CommentVisibility = 'all' | 'unresolved' | 'hidden'
export type DiffRange = 'since' | 'whole'
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

const CYCLE: CommentVisibility[] = ['all', 'unresolved', 'hidden']

export const useReviewUiStore = create<ReviewUiStore>((set, get) => {
  const persist = (patch: Partial<Prefs>) => {
    set(patch)
    const s = get()
    savePrefs({
      commentVisibility: s.commentVisibility,
      agentNotesOn: s.agentNotesOn,
      diffRange: s.diffRange,
      fileListHidden: s.fileListHidden,
      diffViewMode: s.diffViewMode,
      hideFormattingHunks: s.hideFormattingHunks,
      queueSort: s.queueSort,
      dashboardSort: s.dashboardSort,
    })
  }
  return {
    ...loadPrefs(),
    selection: null,
    composerRequest: null,
    agentRuns: [],
    agentPanelScope: null,
    agentPanelRequest: 'review',
    agentPanelAutoStart: false,
    keyboardHelpOpen: false,
    insightsOpen: false,

    setCommentVisibility: (v) => persist({ commentVisibility: v }),
    cycleCommentVisibility: () => {
      const i = CYCLE.indexOf(get().commentVisibility)
      persist({ commentVisibility: CYCLE[(i + 1) % CYCLE.length] })
    },
    setAgentNotesOn: (on) => persist({ agentNotesOn: on }),
    setDiffRange: (r) => persist({ diffRange: r }),
    toggleFileList: () => persist({ fileListHidden: !get().fileListHidden }),
    setDiffViewMode: (mode) => persist({ diffViewMode: mode }),
    setHideFormattingHunks: (on) => persist({ hideFormattingHunks: on }),
    setQueueSort: (mode) => persist({ queueSort: mode }),
    setDashboardSort: (mode) => persist({ dashboardSort: mode }),
    setSelection: (s) => set({ selection: s }),
    requestComposer: (r) => set({ composerRequest: r }),
    setAgentRuns: (runs) => set({ agentRuns: runs }),
    upsertAgentRun: (run) =>
      set((state) => {
        const rest = state.agentRuns.filter((r) => r.id !== run.id)
        return { agentRuns: [run, ...rest] }
      }),
    openAgentPanel: (scope, request = 'review', autoStart = false) =>
      set({ agentPanelScope: scope, agentPanelRequest: request, agentPanelAutoStart: autoStart }),
    setKeyboardHelpOpen: (open) => set({ keyboardHelpOpen: open }),
    setInsightsOpen: (open) => set({ insightsOpen: open }),
    resetForPr: () =>
      set({
        selection: null,
        composerRequest: null,
        agentRuns: [],
        agentPanelScope: null,
        keyboardHelpOpen: false,
        insightsOpen: false,
      }),
  }
})
