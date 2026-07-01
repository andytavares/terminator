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
  }): Promise<{ ok: true; dispatched: true; queued: boolean } | { error: string; message?: string }>
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
  artifactList(payload: {
    featureDir: string
  }): Promise<{ artifacts: ArtifactRef[] } | { error: string }>
  knowledgeSearch(payload: {
    repoRoot: string
    query: string
  }): Promise<{ results: KnowledgeRef[] } | { error: string }>
  onStateChanged(handler: (data: unknown) => void): () => void
  onRunOutput(
    handler: (data: { featureDir: string; phase?: string; line: string; ts: string }) => void
  ): () => void
  onDispatchStarted(
    handler: (data: { featureDir: string; branchName: string; worktreePath?: string }) => void
  ): () => void
  onCheckinReady(
    handler: (data: { featureDir: string; batchIndex: number; diffSummary: string }) => void
  ): () => void
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
    artifactList: (payload) =>
      bridge.invoke('speckit:artifact-list', payload) as Promise<
        { artifacts: ArtifactRef[] } | { error: string }
      >,
    knowledgeSearch: (payload) =>
      bridge.invoke('speckit:knowledge-search', payload) as Promise<
        { results: KnowledgeRef[] } | { error: string }
      >,
    onStateChanged: (handler) => bridge.on('speckit:state-changed', handler),
    onRunOutput: (handler) => bridge.on('speckit:run-output', handler),
    onDispatchStarted: (handler) =>
      bridge.on('speckit:dispatch-started', handler as (data: unknown) => void),
    onCheckinReady: (handler) => bridge.on('speckit:checkin-ready', handler),
  }
}
