import type {
  ArtifactRef,
  BoardStage,
  CardBrief,
  CardComment,
  CardSummary,
  Feature,
  HistoryEntry,
  KnowledgeRef,
  PhaseId,
  PilotState,
  RunMode,
  SelfReviewResult,
  Ticket,
  TicketRef,
} from './speckit.types.js'

export interface SpeckitAPI {
  featureList(payload: { repoRoot: string }): Promise<{ features: Feature[] } | { error: string }>
  checkArtifacts(payload: {
    featureDir: string
    repoRoot: string
  }): Promise<{ exists: Record<string, boolean> } | { error: string }>
  fileWrite(payload: {
    filePath: string
    content: string
  }): Promise<{ ok: true } | { error: string }>
  pilotState(payload: {
    featureDir: string
  }): Promise<{ state: PilotState } | { error: string } | { notFound: true }>
  phaseApprove(payload: {
    featureDir: string
    phase: PhaseId
    note?: string
  }): Promise<{ state: PilotState } | { error: string }>
  phaseReject(payload: {
    featureDir: string
    phase: PhaseId
    reason: string
  }): Promise<{ state: PilotState } | { error: string }>
  phaseRevoke(payload: {
    featureDir: string
    phase: PhaseId
    note?: string
  }): Promise<{ state: PilotState } | { error: string }>
  artifactRead(payload: {
    filePath: string
    featureDir?: string
    repoRoot?: string
    commit?: string
  }): Promise<{ current: string | null; approved: string | null } | { error: string }>
  historyLoad(payload: {
    featureDir: string
  }): Promise<{ entries: HistoryEntry[] } | { error: string }>
  sessionList(): Promise<{ sessions: { id: string; name: string }[] }>
  implementStop(payload: {
    featureDir: string
    phase?: PhaseId
  }): Promise<{ ok: true } | { error: string }>
  checkpointCreate(payload: {
    featureDir: string
    repoRoot?: string
  }): Promise<{ commitHash: string } | { error: string }>
  implementFileDecision(payload: {
    filePath: string
    decision: 'approve' | 'skip'
    featureDir: string
    repoRoot?: string
  }): Promise<{ ok: true } | { error: string }>
  phaseSkip(payload: {
    featureDir: string
    phase: PhaseId
    note?: string
  }): Promise<{ state: PilotState } | { error: string }>
  phaseUnskip(payload: {
    featureDir: string
    phase: PhaseId
    note?: string
  }): Promise<{ state: PilotState } | { error: string }>
  ticketList(): Promise<{ tickets: Ticket[] } | { error: string }>
  credentialsSet(
    payload:
      | { source: 'linear'; apiKey?: string; email?: string }
      | { source: 'jira'; domain: string; email: string; apiToken: string; jql: string }
  ): Promise<{ ok: true } | { error: string }>
  credentialsStatus(payload: {
    source: 'linear' | 'jira'
  }): Promise<{ connected: boolean; email?: string; domain?: string } | { error: string }>
  dispatch(payload: {
    ticket: TicketRef
    workspacePath: string
    autonomyLevel?: 'guided' | 'standard' | 'fast'
    baseBranch?: string
    mode?: RunMode
  }): Promise<{ featureDir: string; queued: boolean } | { error: string }>
  runCancel(payload: {
    featureDir: string
    workspacePath: string
    deleteWorktree?: boolean
  }): Promise<{ ok: true; state?: PilotState } | { error: string }>
  openPr(payload: {
    featureDir: string
    workspacePath: string
    title: string
    baseBranch?: string
  }): Promise<{ prUrl: string } | { error: string }>
  checkinDecision(payload: {
    featureDir: string
    decision: 'continue' | 'pause' | 'split'
    batchIndex?: number
  }): Promise<{ ok: true } | { error: string }>
  selfReviewRead(payload: {
    featureDir: string
  }): Promise<{ result: SelfReviewResult } | { notFound: true; error: string } | { error: string }>
  phaseRequestChanges(payload: {
    featureDir: string
    phase: PhaseId
    note: string
  }): Promise<{ state: PilotState } | { error: string }>
  phaseComment(payload: {
    featureDir: string
    phase: PhaseId
    note: string
  }): Promise<{ ok: true; state: PilotState } | { error: string }>
  cardList(payload: { repoRoot: string }): Promise<{ cards: CardSummary[] } | { error: string }>
  cardCreate(payload: {
    repoRoot: string
    brief: Partial<CardBrief> & { title: string }
    ticket?: TicketRef
  }): Promise<{ featureDir: string } | { error: string; message?: string }>
  cardUpdate(payload: {
    featureDir: string
    brief: Partial<CardBrief>
  }): Promise<{ ok: true } | { error: string; message?: string }>
  cardMove(payload: {
    featureDir: string
    workspacePath: string
    toStage: BoardStage
  }): Promise<{ ok: true } | { error: string; message?: string }>
  cardHandoff(payload: {
    featureDir: string
    workspacePath: string
    baseBranch?: string
    mode?: RunMode
    /** Start anyway, with the queue depth recorded at the moment it was ignored. */
    overrideBackpressure?: boolean
  }): Promise<
    | { ok: true; dispatched: true; queued: boolean }
    | { ok: false; error: 'backpressure'; reason?: string | null }
    | { error: string; message?: string }
  >
  cardReset(payload: {
    featureDir: string
    workspacePath?: string
  }): Promise<{ ok: true; state: PilotState } | { error: string }>
  cardComment(payload: {
    featureDir: string
    body: string
  }): Promise<{ comment: CardComment } | { error: string; message?: string }>
  commentList(payload: {
    featureDir: string
  }): Promise<{ comments: CardComment[] } | { error: string }>
  runOutputRead(payload: {
    featureDir: string
    phase: PhaseId
  }): Promise<{ lines: string[] } | { error: string }>
  runReply(payload: { featureDir: string; text: string }): Promise<{ ok: true } | { error: string }>
  /** Tool calls a supervised run is holding until somebody decides. */
  permissionsList(): Promise<{ pending: PendingAskView[] }>
  permissionResolve(payload: {
    requestId: string
    decision: 'allow' | 'deny'
    /** Words back to the agent, for a request that is a question. */
    answer?: string
  }): Promise<{ ok: boolean; reason?: string }>
  /** Answer it in the terminal instead, where the agent is. */
  permissionHandBack(payload: { requestId: string }): Promise<{ ok: boolean }>
  /** What is running, what is waiting to be reviewed, and whether the gate is open. */
  supervisionSnapshot(): Promise<SupervisionSnapshot>
  stallsList(): Promise<{ firings: StallFiringView[]; shadowMode: boolean }>
  feedList(): Promise<{ entries: FeedEntryView[]; mutes: MuteRuleView[] }>
  /** Drops one line from the feed. Anything shown as a list should be prunable. */
  feedDismiss(payload: { id: string }): Promise<{ ok: boolean }>
  /** Stops a run interrupting you. The record of what it did stays. */
  feedMute(payload: {
    sessionId?: string
    author?: 'agent' | 'console'
  }): Promise<{ mutes: MuteRuleView[] }>
  feedUnmute(payload: {
    sessionId?: string
    author?: 'agent' | 'console'
  }): Promise<{ mutes: MuteRuleView[] }>
  /** What happened between two moments, rolled up rather than replayed. */
  feedDigest(payload: { from: number; to?: number }): Promise<DigestView>
  reviewHunks(payload: { sessionId: string }): Promise<{
    files: HunkFileView[]
    complete: boolean
    fullReject?: boolean
  }>
  reviewDecideHunk(payload: {
    sessionId: string
    hunkId: string
    decision: 'accept' | 'reject'
  }): Promise<{ ok: boolean }>
  /** Takes the rejected hunks back out of the working copy. */
  reviewApply(payload: {
    sessionId: string
  }): Promise<{ ok: boolean; reverted: number; error: string | null }>
  reviewDone(payload: { sessionId: string }): Promise<{ ok: boolean }>
  /** Where a run is running, so a surface can go there rather than describe it. */
  runTerminal(payload: { sessionId: string }): Promise<{ terminalSessionId: string | null }>
  /** What it was doing, in its own words. */
  runTranscript(payload: {
    sessionId: string
    limit?: number
  }): Promise<{ lines: TranscriptLineView[] }>
  /** Ends the turn, keeping the session so the next message lands. */
  runInterrupt(payload: { sessionId: string }): Promise<{ ok: boolean }>
  /** Asking what is wrong, or saying what to do instead. */
  runRedirect(payload: { sessionId: string; message: string }): Promise<{ ok: boolean }>
  runStop(payload: { sessionId: string; reason?: string }): Promise<{ ok: boolean }>
  /** Kill and discard: the run ends and its worktree and branch go with it. */
  runDiscard(payload: { sessionId: string; workspacePath: string }): Promise<{ ok: boolean }>
  /** Where a review has got to: intent → risk → structure → tests. */
  reviewAdvance(payload: { sessionId: string }): Promise<{ step: ReviewStepView | null }>
  /** The request set against the agent's own account of what it did. */
  reviewIntent(payload: {
    sessionId: string
    request: string
    agentAccount: string
  }): Promise<{ intent: IntentReviewView | null }>
  /** A card's lanes, from the work item its plan phase wrote. */
  lanes(payload: { featureDir: string }): Promise<{ lanes: LaneViewJson[] }>
  laneMayMerge(payload: {
    featureDir: string
    ord: number
    merged: number[]
  }): Promise<{ allowed: boolean; reason: string | null; blockingLane: number | null }>
  artifactList(payload: {
    featureDir: string
  }): Promise<{ artifacts: ArtifactRef[] } | { error: string }>
  knowledgeSearch(payload: {
    repoRoot: string
    query: string
  }): Promise<{ results: KnowledgeRef[] } | { error: string }>
  onStateChanged(handler: (data: unknown) => void): () => void
  /** A supervised run raised or cleared a request. */
  onPermissionsChanged(handler: () => void): () => void
  onRunOutput(
    handler: (data: { featureDir: string; phase?: string; line: string; ts: string }) => void
  ): () => void
  onDispatchStarted(
    handler: (data: { featureDir: string; branchName: string; worktreePath?: string }) => void
  ): () => void
  /** The palette was used to jump to a run or a queued diff. */
  onPaletteGoto(handler: (data: PaletteGotoView) => void): () => void
  onCheckinReady(
    handler: (data: { featureDir: string; batchIndex: number; diffSummary: string }) => void
  ): () => void
}

/** A tool call waiting on the operator, as a surface needs it. */
export interface PendingAskView {
  featureDir: string
  sessionId: string
  requestId: string
  toolName: string
  /** One line naming what is actually being asked. */
  summary: string
  /** The ask in full — every field the tool was given. */
  detail: string | null
  questions?: Array<{ question: string; options: string[] }>
  targetHost?: string
  at: number
}

/** A supervised run, as a surface needs it. */
export interface RunView {
  sessionId: string
  featureDir: string
  phase: string
  branch: string
  worktreePath: string
  terminalSessionId: string
  state: 'working' | 'waiting' | 'stalled' | 'ready' | 'finished'
  stateSince: number
  turns: number
  asked: number
  diff: { files: number; added: number; removed: number }
}

export interface ReviewItemView {
  sessionId: string
  branch: string
  grade: 'P0' | 'P1' | 'P2' | 'P3'
  /** Why it graded that way — the trigger, not just the letter. */
  gradeTrigger: string
  diffSummary: { files: number; added: number; removed: number }
  queuedAt: number
}

export interface SupervisionSnapshot {
  runs: RunView[]
  review: ReviewItemView[]
  backpressure: { allowed: boolean; unreviewed: number; limit: number; reason?: string | null }
}

export interface StallFiringView {
  firing: {
    sessionId: string
    signal: 'silence' | 'loop' | 'revert'
    firedAt: number
    inputs: { toolSilenceMs: number; shellInFlight: boolean }
  }
  featureDir: string
  /** Recorded rather than surfaced, while the thresholds are being judged. */
  shadow: boolean
}

export interface FeedEntryView {
  id: string
  at: number
  sessionId: string
  author: 'agent' | 'console'
  summary: string
  replyable: boolean
}

/** One hunk of a run's diff, and what has been decided about it. */
export interface HunkView {
  id: string
  newStart: number
  lines: string[]
  decision: 'accept' | 'reject' | null
}

/** A file's hunks, in the order the diff has them. */
export interface HunkFileView {
  file: string
  hunks: HunkView[]
}

/**
 * The four steps of a review, in the order they are taken.
 *
 * `advance` answers null past the last one, which is how a surface knows the
 * review is finished rather than stuck on "tests".
 */
export type ReviewStepView = 'intent' | 'risk' | 'structure' | 'tests'

/**
 * The step every diff viewer skips: what was asked for, against what the agent
 * says it did, against what it actually changed.
 */
export interface IntentReviewView {
  request: string
  agentAccount: string
  /** Touched but not anticipated by the request. The scope-creep signal. */
  unexpectedFiles: string[]
  /** Anticipated but never touched — often means the task was not actually done. */
  untouchedFiles: string[]
  hasScopeConcern: boolean
}

/** One lane of a multi-repository card, with what it collides with. */
export interface LaneViewJson {
  lane: {
    ord: number
    repo: string
    branch: string
    role?: 'producer' | 'consumer'
    blocks: number[]
    blocked_by: number[]
  }
  collisions: string[]
  blockedBy: number[]
}

/**
 * A run, or a whole author, that may not interrupt you.
 *
 * Suppresses the notification and never the entry — the record of what happened
 * stays complete whether or not it interrupted anyone.
 */
export interface MuteRuleView {
  sessionId?: string
  author?: 'agent' | 'console'
}

/** What happened while you were away. */
export interface DigestView {
  from: number
  to: number
  entryCount: number
  sessionCount: number
  bySession: Array<{ sessionId: string; entries: FeedEntryView[] }>
}

/** Where the palette wants to take you. */
export interface PaletteGotoView {
  kind: 'run' | 'review'
  sessionId: string
  /** Null once the run has ended, so the surface shows it instead of jumping. */
  terminalSessionId: string | null
}

/** One thing said in a run, flattened to words a surface can render. */
export interface TranscriptLineView {
  role: 'user' | 'assistant'
  text: string
  at: number
}

export function getSpeckitAPI(): SpeckitAPI {
  const bridge = window.electronAPI.extensionBridge
  return {
    featureList: (payload) =>
      bridge.invoke('speckit:feature-list', payload) as Promise<
        { features: Feature[] } | { error: string }
      >,
    checkArtifacts: (payload) =>
      bridge.invoke('speckit:check-artifacts', payload) as Promise<
        { exists: Record<string, boolean> } | { error: string }
      >,
    fileWrite: (payload) =>
      bridge.invoke('speckit:file-write', payload) as Promise<{ ok: true } | { error: string }>,
    pilotState: (payload) =>
      bridge.invoke('speckit:pilot-state', payload) as Promise<
        { state: PilotState } | { error: string } | { notFound: true }
      >,
    phaseApprove: (payload) =>
      bridge.invoke('speckit:phase-approve', payload) as Promise<
        { state: PilotState } | { error: string }
      >,
    phaseReject: (payload) =>
      bridge.invoke('speckit:phase-reject', payload) as Promise<
        { state: PilotState } | { error: string }
      >,
    phaseRevoke: (payload) =>
      bridge.invoke('speckit:phase-revoke', payload) as Promise<
        { state: PilotState } | { error: string }
      >,
    artifactRead: (payload) =>
      bridge.invoke('speckit:artifact-read', payload) as Promise<
        { current: string | null; approved: string | null } | { error: string }
      >,
    historyLoad: (payload) =>
      bridge.invoke('speckit:history-load', payload) as Promise<
        { entries: HistoryEntry[] } | { error: string }
      >,
    sessionList: () =>
      bridge.invoke('speckit:session-list', {}) as Promise<{
        sessions: { id: string; name: string }[]
      }>,
    implementStop: (payload) =>
      bridge.invoke('speckit:implement-stop', payload) as Promise<{ ok: true } | { error: string }>,
    checkpointCreate: (payload) =>
      bridge.invoke('speckit:checkpoint-create', payload) as Promise<
        { commitHash: string } | { error: string }
      >,
    implementFileDecision: (payload) =>
      bridge.invoke('speckit:implement-file-decision', payload) as Promise<
        { ok: true } | { error: string }
      >,
    phaseSkip: (payload) =>
      bridge.invoke('speckit:phase-skip', payload) as Promise<
        { state: PilotState } | { error: string }
      >,
    phaseUnskip: (payload) =>
      bridge.invoke('speckit:phase-unskip', payload) as Promise<
        { state: PilotState } | { error: string }
      >,
    ticketList: () =>
      bridge.invoke('speckit:ticket-list', {}) as Promise<
        { tickets: Ticket[] } | { error: string }
      >,
    credentialsSet: (payload) =>
      bridge.invoke('speckit:credentials-set', payload) as Promise<
        { ok: true } | { error: string }
      >,
    credentialsStatus: (payload) =>
      bridge.invoke('speckit:credentials-status', payload) as Promise<
        { connected: boolean; email?: string; domain?: string } | { error: string }
      >,
    dispatch: (payload) =>
      bridge.invoke('speckit:dispatch', payload) as Promise<
        { featureDir: string; queued: boolean } | { error: string }
      >,
    runCancel: (payload) =>
      bridge.invoke('speckit:run-cancel', payload) as Promise<
        { ok: true; state?: PilotState } | { error: string }
      >,
    openPr: (payload) =>
      bridge.invoke('speckit:open-pr', payload) as Promise<{ prUrl: string } | { error: string }>,
    checkinDecision: (payload) =>
      bridge.invoke('speckit:checkin-decision', payload) as Promise<
        { ok: true } | { error: string }
      >,
    selfReviewRead: (payload) =>
      bridge.invoke('speckit:self-review-read', payload) as Promise<
        { result: SelfReviewResult } | { notFound: true; error: string } | { error: string }
      >,
    phaseRequestChanges: (payload) =>
      bridge.invoke('speckit:phase-request-changes', payload) as Promise<
        { state: PilotState } | { error: string }
      >,
    phaseComment: (payload) =>
      bridge.invoke('speckit:phase-comment', payload) as Promise<
        { ok: true; state: PilotState } | { error: string }
      >,
    cardList: (payload) =>
      bridge.invoke('speckit:card-list', payload) as Promise<
        { cards: CardSummary[] } | { error: string }
      >,
    cardCreate: (payload) =>
      bridge.invoke('speckit:card-create', payload) as Promise<
        { featureDir: string } | { error: string; message?: string }
      >,
    cardUpdate: (payload) =>
      bridge.invoke('speckit:card-update', payload) as Promise<
        { ok: true } | { error: string; message?: string }
      >,
    cardMove: (payload) =>
      bridge.invoke('speckit:card-move', payload) as Promise<
        { ok: true } | { error: string; message?: string }
      >,
    cardHandoff: (payload) =>
      bridge.invoke('speckit:card-handoff', payload) as Promise<
        { ok: true; dispatched: true; queued: boolean } | { error: string; message?: string }
      >,
    cardReset: (payload) =>
      bridge.invoke('speckit:card-reset', payload) as Promise<
        { ok: true; state: PilotState } | { error: string }
      >,
    cardComment: (payload) =>
      bridge.invoke('speckit:card-comment', payload) as Promise<
        { comment: CardComment } | { error: string; message?: string }
      >,
    commentList: (payload) =>
      bridge.invoke('speckit:comment-list', payload) as Promise<
        { comments: CardComment[] } | { error: string }
      >,
    runOutputRead: (payload) =>
      bridge.invoke('speckit:run-output-read', payload) as Promise<
        { lines: string[] } | { error: string }
      >,
    runReply: (payload) =>
      bridge.invoke('speckit:run-reply', payload) as Promise<{ ok: true } | { error: string }>,
    permissionsList: () =>
      bridge.invoke('speckit:permissions-list', {}) as Promise<{ pending: PendingAskView[] }>,
    permissionResolve: (payload) =>
      bridge.invoke('speckit:permission-resolve', payload) as Promise<{
        ok: boolean
        reason?: string
      }>,
    permissionHandBack: (payload) =>
      bridge.invoke('speckit:permission-hand-back', payload) as Promise<{ ok: boolean }>,
    supervisionSnapshot: () =>
      bridge.invoke('speckit:supervision-snapshot', {}) as Promise<SupervisionSnapshot>,
    stallsList: () =>
      bridge.invoke('speckit:stalls-list', {}) as Promise<{
        firings: StallFiringView[]
        shadowMode: boolean
      }>,
    feedList: () =>
      bridge.invoke('speckit:feed-list', {}) as Promise<{
        entries: FeedEntryView[]
        mutes: MuteRuleView[]
      }>,
    feedDismiss: (payload) =>
      bridge.invoke('speckit:feed-dismiss', payload) as Promise<{ ok: boolean }>,
    feedMute: (payload) =>
      bridge.invoke('speckit:feed-mute', payload) as Promise<{ mutes: MuteRuleView[] }>,
    feedUnmute: (payload) =>
      bridge.invoke('speckit:feed-unmute', payload) as Promise<{ mutes: MuteRuleView[] }>,
    feedDigest: (payload) => bridge.invoke('speckit:feed-digest', payload) as Promise<DigestView>,
    reviewHunks: (payload) =>
      bridge.invoke('speckit:review-hunks', payload) as Promise<{
        files: HunkFileView[]
        complete: boolean
        fullReject?: boolean
      }>,
    reviewDecideHunk: (payload) =>
      bridge.invoke('speckit:review-decide-hunk', payload) as Promise<{ ok: boolean }>,
    reviewApply: (payload) =>
      bridge.invoke('speckit:review-apply', payload) as Promise<{
        ok: boolean
        reverted: number
        error: string | null
      }>,
    reviewDone: (payload) =>
      bridge.invoke('speckit:review-done', payload) as Promise<{ ok: boolean }>,
    runTerminal: (payload) =>
      bridge.invoke('speckit:run-terminal', payload) as Promise<{
        terminalSessionId: string | null
      }>,
    runTranscript: (payload) =>
      bridge.invoke('speckit:run-transcript', payload) as Promise<{
        lines: TranscriptLineView[]
      }>,
    runInterrupt: (payload) =>
      bridge.invoke('speckit:run-interrupt', payload) as Promise<{ ok: boolean }>,
    runRedirect: (payload) =>
      bridge.invoke('speckit:run-redirect', payload) as Promise<{ ok: boolean }>,
    runStop: (payload) => bridge.invoke('speckit:run-stop', payload) as Promise<{ ok: boolean }>,
    runDiscard: (payload) =>
      bridge.invoke('speckit:run-discard', payload) as Promise<{ ok: boolean }>,
    reviewAdvance: (payload) =>
      bridge.invoke('speckit:review-advance', payload) as Promise<{ step: ReviewStepView | null }>,
    reviewIntent: (payload) =>
      bridge.invoke('speckit:review-intent', payload) as Promise<{
        intent: IntentReviewView | null
      }>,
    lanes: (payload) =>
      bridge.invoke('speckit:lanes', payload) as Promise<{ lanes: LaneViewJson[] }>,
    laneMayMerge: (payload) =>
      bridge.invoke('speckit:lane-may-merge', payload) as Promise<{
        allowed: boolean
        reason: string | null
        blockingLane: number | null
      }>,
    artifactList: (payload) =>
      bridge.invoke('speckit:artifact-list', payload) as Promise<
        { artifacts: ArtifactRef[] } | { error: string }
      >,
    knowledgeSearch: (payload) =>
      bridge.invoke('speckit:knowledge-search', payload) as Promise<
        { results: KnowledgeRef[] } | { error: string }
      >,
    onStateChanged: (handler) => bridge.on('speckit:state-changed', handler),
    onPermissionsChanged: (handler) => {
      // Raised and cleared are two channels; a surface only cares that the set
      // changed and re-reads it either way.
      const raised = bridge.on('speckit:permission-requested', () => handler())
      const answered = bridge.on('speckit:permission-resolved', () => handler())
      return () => {
        raised()
        answered()
      }
    },
    onRunOutput: (handler) => bridge.on('speckit:run-output', handler as (data: unknown) => void),
    onDispatchStarted: (handler) =>
      bridge.on('speckit:dispatch-started', handler as (data: unknown) => void),
    onPaletteGoto: (handler) =>
      bridge.on('speckit:palette-goto', handler as (data: unknown) => void),
    onCheckinReady: (handler) =>
      bridge.on('speckit:checkin-ready', handler as (data: unknown) => void),
  }
}
