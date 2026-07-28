import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSupervisionStore } from '../stores/supervision.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import type { AttentionItem } from '../../shared/supervision/rank-attention'
import type { StatusSummary } from '../../shared/schemas/supervision'
import type { AutonomyLevel, RuntimeState, SupervisedSession } from '../../shared/types/supervision'
import type { SupervisionScreenProps } from '../components/supervision/SupervisionScreen'
import type { PaletteEntity } from '../components/supervision/SupervisionPalette'
import type { ReclaimableWorktreeView } from '../components/supervision/WorktreeReclaim'
import type { QueuedIntakeView } from '../components/supervision/WorkItemBoard'
import type {
  BackpressureDecision,
  FeedEntry,
  RecordedFiring,
  Digest,
  PrecisionReport,
  ReviewItem,
  UnattendedMergeRecord,
  HunkDecision,
} from '../../shared/supervision/view-types'

// Binds the supervision substrate to the app shell: loads state, keeps the
// clock moving so elapsed times stay honest, and assembles the props every
// surface needs.

// SC-001 requires a blocked session to be visible within 2 seconds. Polling at
// that interval would consume the whole budget before IPC, so the main process
// pushes state changes and this is only the backstop.
const BACKSTOP_MS = 5_000

/** How far back the progress digest reaches (FR-028). */
const DIGEST_WINDOW_MINUTES = 60

/** Elapsed times re-render on this tick; it is not the freshness mechanism. */
const TICK_MS = 1_000

interface SupervisionBridge {
  listSessions(): Promise<SupervisedSession[]>
  onStateChanged?(handler: (change: unknown) => void): () => void
  /** A producer wrote a work item; the board reflects it without a refresh. */
  onWorkItemsChanged?(handler: () => void): () => void
  resolvePermission?(payload: {
    sessionId: string
    requestId: string
    decision: 'allow' | 'deny'
    answer?: string
  }): Promise<unknown>
  setShadowMode?(payload: { value: boolean }): Promise<unknown>
  judgeFiring?(payload: { firingId: string; judgement: 'correct' | 'incorrect' }): Promise<unknown>
  openInEditor?(payload: { sessionId: string }): Promise<unknown>
  listFeed?(): Promise<FeedEntry[]>
  listFirings?(): Promise<{ firings: RecordedFiring[]; precision: PrecisionReport }>
  listReview?(): Promise<ReviewItem[]>
  listUnattendedMerges?(): Promise<UnattendedMergeRecord[]>
  entityIndex?(): Promise<PaletteEntity[]>
  listWorkItems?(): Promise<{
    items: SupervisionScreenProps['workItems']
    unreadable: SupervisionScreenProps['unreadable']
    conflicts: SupervisionScreenProps['conflicts']
    canAct: boolean
  }>
  replyToSession?(payload: { sessionId: string; message: string }): Promise<unknown>
  getReviewDetail?(payload: { sessionId: string }): Promise<SupervisionScreenProps['activeReview']>
  decideHunk?(payload: {
    sessionId: string
    hunkId: string
    decision: HunkDecision
  }): Promise<unknown>
  advanceReview?(payload: { sessionId: string }): Promise<unknown>
  getLanes?(payload: { workItemId: string }): Promise<{
    lanes: SupervisionScreenProps['lanes']
    mergedOrds: number[]
    staleOrds: number[]
    blockedReasons: Record<number, string>
  }>
  mergeLane?(payload: { workItemId: string; ord: number }): Promise<unknown>
  getProvisioning?(payload: { sessionId: string }): Promise<SupervisionScreenProps['provisioning']>
  getSinceLastLooked?(payload: { sessionId: string }): Promise<{
    lastViewedAt: number | null
    entries: FeedEntry[]
    stateChanges: Array<{ to: RuntimeState; at: number }>
    diffDelta: { files: number; added: number; removed: number } | null
  }>
  precheckBackpressure?(): Promise<BackpressureDecision | null>
  assign?(request: {
    repoPath: string
    branch: string
    isNewBranch?: boolean
    autonomyLevel: AutonomyLevel
    workItemId?: string
    laneOrd?: number
    instruction?: string
    overrideBackpressure?: boolean
  }): Promise<{
    ok: boolean
    reason?: string
    worktreePath?: string
    backpressure?: BackpressureDecision
  }>
  intake?(input: { url?: string; filePath?: string }): Promise<{
    ok: boolean
    reason?: string
    id?: string
  }>
  removeFeedEntry?(payload: { id: string }): Promise<unknown>
  removeFiring?(payload: { id: string }): Promise<unknown>
  listIntake?(): Promise<QueuedIntakeView[]>
  removeIntake?(payload: { id: string }): Promise<unknown>
  pullFromLinear?(): Promise<{ ok: boolean; added: number; reason: string | null }>
  getDigest?(payload: { windowMs: number }): Promise<Digest | null>
  interruptSession?(payload: {
    sessionId: string
    redirect?: string
  }): Promise<{ ok: boolean; reason: string | null }>
  discardSession?(payload: { sessionId: string }): Promise<{ ok: boolean; reason: string | null }>
  stopSession?(payload: {
    sessionId: string
    reason?: string
  }): Promise<{ ok: boolean; reason: string | null }>
  listReclaimable?(): Promise<ReclaimableWorktreeView[]>
  reclaimWorktree?(payload: { path: string }): Promise<{ ok: boolean; reason: string | null }>
  producerAction?(payload: {
    workItemId: string
    action: 'approveGate' | 'rejectGate' | 'advancePhase' | 'sendBack'
    args: unknown[]
  }): Promise<{ ok: boolean; reason: string | null }>
}

function bridge(): SupervisionBridge | null {
  const api = (globalThis as { electronAPI?: { supervision?: SupervisionBridge } }).electronAPI
  return api?.supervision ?? null
}

const EMPTY_PRECISION: PrecisionReport = { total: 0, judged: 0, incorrect: 0, incorrectRate: null }

export interface UseSupervision {
  loaded: boolean
  attention: AttentionItem[]
  summary: StatusSummary
  screenProps: SupervisionScreenProps
}

export interface UseSupervisionOptions {
  /**
   * Opens a terminal in a session's working copy with its conversation
   * resumed. The console drives agents headlessly, so there is no terminal to
   * attach to — this is the shell's job, not the console's.
   */
  onAttachTerminal?: (session: SupervisedSession) => void
  /**
   * The app shell's own reaction to a session being opened — focusing its tab,
   * for instance. Passed in rather than broadcast on a window event, so a
   * listener that does not exist is a compile error instead of silence.
   */
  onOpenSessionInShell?: (sessionId: string) => void
  /** Called after the palette has navigated, for anything the shell must do. */
  onNavigate?: (entity: PaletteEntity) => void
}

export function useSupervision(options: UseSupervisionOptions = {}): UseSupervision {
  const { onOpenSessionInShell, onNavigate, onAttachTerminal } = options
  const [now, setNow] = useState(() => Date.now())
  const [autonomy, setAutonomy] = useState<AutonomyLevel>('edit')
  const [muted, setMuted] = useState<string[]>([])
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [firings, setFirings] = useState<RecordedFiring[]>([])
  const [precision, setPrecision] = useState<PrecisionReport>(EMPTY_PRECISION)
  const [shadowMode, setShadow] = useState(true)
  const [review, setReview] = useState<ReviewItem[]>([])
  const [merges, setMerges] = useState<UnattendedMergeRecord[]>([])
  const [board, setBoard] = useState<{
    items: SupervisionScreenProps['workItems']
    unreadable: SupervisionScreenProps['unreadable']
    conflicts: SupervisionScreenProps['conflicts']
    canAct: boolean
  }>({ items: [], unreadable: [], conflicts: [], canAct: false })
  const [openSession, setOpenSession] = useState<string | null>(null)
  const [openWorkItem, setOpenWorkItem] = useState<string | null>(null)
  const [activeReview, setActiveReview] = useState<SupervisionScreenProps['activeReview']>(null)
  const [hunkDecisions, setHunkDecisions] = useState<Record<string, HunkDecision>>({})
  const [laneState, setLaneState] = useState<{
    lanes: SupervisionScreenProps['lanes']
    mergedOrds: number[]
    staleOrds: number[]
    blockedReasons: Record<number, string>
  }>({ lanes: [], mergedOrds: [], staleOrds: [], blockedReasons: {} })
  const [provisioning, setProvisioning] = useState<SupervisionScreenProps['provisioning']>(null)
  const [since, setSince] = useState<{
    lastViewedAt: number | null
    entries: FeedEntry[]
    stateChanges: Array<{ to: RuntimeState; at: number }>
    diffDelta: { files: number; added: number; removed: number } | null
  }>({ lastViewedAt: null, entries: [], stateChanges: [], diffDelta: null })
  const [backpressure, setBackpressure] = useState<BackpressureDecision | null>(null)

  const [assignRepo, setAssignRepo] = useState<string | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)

  // The repositories the operator has already opened. Retyping a path the app
  // is displaying two panels away is how you get a typo in the one field that
  // cannot be wrong.
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const repos = useMemo(
    () =>
      // Guarded: the supervision panel must not be able to take the whole app
      // down over the shape of somebody else's store.
      (Array.isArray(workspaces) ? workspaces : [])
        .filter((workspace) => typeof workspace?.folderPath === 'string')
        .map((workspace) => ({ path: workspace.folderPath, label: workspace.name })),
    [workspaces]
  )

  // Its own branches, read the same way the sidebar reads them.
  useEffect(() => {
    const repoPath = assignRepo ?? repos[0]?.path
    if (repoPath === undefined) return

    let cancelled = false
    void window.electronAPI?.git
      ?.listBranches?.(repoPath)
      .then((result) => {
        if (cancelled) return
        const local = result.branches.filter((branch) => !branch.isRemote)
        setBranches(local.map((branch) => branch.name))
        setCurrentBranch(local.find((branch) => branch.isCurrent)?.name ?? null)
      })
      .catch(() => {
        // Not a repository, or git is unavailable: offer no branches rather
        // than a stale list from whichever repository was chosen before.
        if (cancelled) return
        setBranches([])
        setCurrentBranch(null)
      })
    return () => {
      cancelled = true
    }
  }, [assignRepo, repos])

  const loaded = useSupervisionStore((state) => state.loaded)
  const load = useSupervisionStore((state) => state.load)
  const sessions = useSupervisionStore((state) => state.sessions)
  const attentionOf = useSupervisionStore((state) => state.attention)
  const summaryOf = useSupervisionStore((state) => state.statusSummary)

  useEffect(() => {
    const transport = bridge()
    if (transport === null) return

    const refresh = (): void => {
      void load({ listSessions: () => transport.listSessions() })
      void transport.listFeed?.().then(setFeed)
      void transport.listReview?.().then(setReview)
      void transport.listUnattendedMerges?.().then(setMerges)
      void transport.listWorkItems?.().then(setBoard)
      void transport.listFirings?.().then((result) => {
        setFirings(result.firings)
        setPrecision(result.precision)
      })
      void transport.getDigest?.({ windowMs: DIGEST_WINDOW_MINUTES * 60_000 }).then(setDigest)
      void transport.listReclaimable?.().then(setReclaimable)
      void transport.listIntake?.().then(setQueuedIntake)
      void transport.precheckBackpressure?.().then((decision) =>
        // Shown only while it would actually refuse a start.
        setBackpressure(decision !== null && decision.allowed ? null : decision)
      )
    }

    refresh()
    // Pushed the moment the substrate observes a change, so a permission
    // request reaches this surface in one IPC hop rather than a poll interval.
    const unsubscribe = transport.onStateChanged?.(() => refresh())
    const unsubscribeItems = transport.onWorkItemsChanged?.(() => {
      void transport.listWorkItems?.().then(setBoard)
    })
    const backstop = setInterval(refresh, BACKSTOP_MS)
    const tick = setInterval(() => setNow(Date.now()), TICK_MS)

    return () => {
      unsubscribe?.()
      unsubscribeItems?.()
      clearInterval(backstop)
      clearInterval(tick)
    }
  }, [load])

  // Opening a session pulls the detail the review, provisioning and
  // "since you last looked" surfaces need — they are inert without it.
  useEffect(() => {
    const transport = bridge()
    if (transport === null || openSession === null) return
    void transport.getReviewDetail?.({ sessionId: openSession }).then(setActiveReview)
    void transport.getProvisioning?.({ sessionId: openSession }).then(setProvisioning)
    void transport.getSinceLastLooked?.({ sessionId: openSession }).then(setSince)
  }, [openSession])

  useEffect(() => {
    const transport = bridge()
    if (transport === null || openWorkItem === null) return
    void transport.getLanes?.({ workItemId: openWorkItem }).then(setLaneState)
  }, [openWorkItem])

  const resolve = useCallback(
    (sessionId: string, requestId: string, decision: 'allow' | 'deny', answer?: string) => {
      void bridge()?.resolvePermission?.({ sessionId, requestId, decision, answer })
    },
    []
  )

  const [digest, setDigest] = useState<Digest | null>(null)
  const [reclaimable, setReclaimable] = useState<ReclaimableWorktreeView[]>([])
  const [reclaimBusy, setReclaimBusy] = useState<string | null>(null)
  const [reclaimError, setReclaimError] = useState<string | null>(null)
  const [assignResult, setAssignResult] = useState<{
    ok: boolean
    reason?: string
    worktreePath?: string
  } | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [queuedIntake, setQueuedIntake] = useState<QueuedIntakeView[]>([])
  const [pulling, setPulling] = useState(false)
  const [intakeResult, setIntakeResult] = useState<{
    ok: boolean
    reason?: string
    id?: string
  } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const refreshAll = useCallback(() => {
    const transport = bridge()
    if (transport === null) return
    void load({ listSessions: () => transport.listSessions() })
    void transport.listReview?.().then(setReview)
    void transport
      .precheckBackpressure?.()
      .then((decision) => setBackpressure(decision !== null && decision.allowed ? null : decision))
  }, [load])

  const refreshReclaimable = useCallback(() => {
    void bridge()?.listReclaimable?.().then(setReclaimable)
  }, [])

  const reclaim = useCallback(async (path: string): Promise<void> => {
    const transport = bridge()
    if (transport?.reclaimWorktree === undefined) return
    setReclaimBusy(path)
    try {
      const result = await transport.reclaimWorktree({ path })
      // A refusal is stated: teardown failing, or a copy that turned out to
      // be in use, must not look like a silent success.
      setReclaimError(result.ok ? null : (result.reason ?? 'could not reclaim that copy'))
    } finally {
      setReclaimBusy(null)
      void transport.listReclaimable?.().then(setReclaimable)
      void transport.listIntake?.().then(setQueuedIntake)
    }
  }, [])

  const refreshDigest = useCallback(() => {
    void bridge()
      ?.getDigest?.({ windowMs: DIGEST_WINDOW_MINUTES * 60_000 })
      .then(setDigest)
  }, [])

  // A producer refusing, or not providing the command at all, is reported —
  // never swallowed. A button that silently does nothing is worse than one
  // that explains itself (FR-078).
  const act = useCallback(
    async (
      workItemId: string,
      action: 'approveGate' | 'rejectGate' | 'advancePhase' | 'sendBack',
      args: unknown[]
    ): Promise<void> => {
      const transport = bridge()
      if (transport?.producerAction === undefined) {
        setActionError('No producer is registered to act on this item.')
        return
      }
      const result = await transport.producerAction({ workItemId, action, args })
      setActionError(result.ok ? null : (result.reason ?? 'the producer refused'))
      if (result.ok) void transport.listWorkItems?.().then(setBoard)
    },
    []
  )

  const [remoteEntities, setRemoteEntities] = useState<PaletteEntity[] | null>(null)

  // Built once in the main process over every entity it knows about; the local
  // derivation below is only the fallback before the first call returns.
  useEffect(() => {
    void bridge()?.entityIndex?.().then(setRemoteEntities)
  }, [sessions, board.items])

  const localEntities = useMemo<PaletteEntity[]>(() => {
    const list: PaletteEntity[] = []
    const repos = new Set<string>()
    for (const session of sessions) {
      list.push({
        id: session.id,
        kind: 'session',
        label: session.branch,
        detail: `${session.repoPath.split('/').pop()} · ${session.runtimeState}`,
      })
      list.push({
        id: session.worktreePath,
        kind: 'worktree',
        label: session.worktreePath.split('/').pop() ?? session.worktreePath,
        detail: session.worktreePath,
      })
      repos.add(session.repoPath)
    }
    for (const entry of board.items) {
      list.push({
        id: entry.item.id,
        kind: 'workItem',
        label: entry.item.id,
        detail: entry.item.title,
      })
    }
    for (const repo of repos) {
      list.push({
        id: repo,
        kind: 'repository',
        label: repo.split('/').pop() ?? repo,
        detail: repo,
      })
    }
    list.push({ id: 'toggle-shadow', kind: 'command', label: 'Toggle stall shadow mode' })
    return list
  }, [sessions, board.items])

  const nextLaneOrd =
    laneState.lanes.find(
      (view) =>
        !laneState.mergedOrds.includes(view.lane.ord) &&
        laneState.blockedReasons[view.lane.ord] === undefined
    )?.lane.ord ?? null

  const entities = remoteEntities ?? localEntities
  const attention = attentionOf(now)
  const summary = summaryOf(now)

  const screenProps: SupervisionScreenProps = {
    now,
    loaded,
    attention,
    workingCount: summary.working,
    onApprove: (sessionId, requestId) => resolve(sessionId, requestId, 'allow'),
    onDeny: (sessionId, requestId) => resolve(sessionId, requestId, 'deny'),
    // A question is not a yes/no. The answer reaches the agent as the message
    // on a denial, which is the only channel the runtime gives us that carries
    // words — the tool call does not run and the agent reads what you said.
    onAnswer: (sessionId, requestId, answer) => resolve(sessionId, requestId, 'deny', answer),
    onOpenSession: (sessionId) => {
      setOpenSession(sessionId)
      onOpenSessionInShell?.(sessionId)
    },

    sessions,
    onAttach: (session: SupervisedSession) => onAttachTerminal?.(session),
    onStop: (sessionId: string, reason?: string) => {
      void bridge()
        ?.stopSession?.({ sessionId, reason })
        .then(() => refreshAll())
    },

    review,
    activeReview,
    decisionFor: (hunkId) => hunkDecisions[hunkId] ?? null,
    onDecideHunk: (hunkId, decision) => {
      setHunkDecisions((current) => ({ ...current, [hunkId]: decision }))
      if (openSession !== null) {
        void bridge()?.decideHunk?.({ sessionId: openSession, hunkId, decision })
      }
    },
    onAdvanceReview: () => {
      if (openSession === null) return
      void bridge()
        ?.advanceReview?.({ sessionId: openSession })
        .then(() => bridge()?.getReviewDetail?.({ sessionId: openSession }).then(setActiveReview))
    },
    unattendedMerges: merges,

    workItems: board.items,
    unreadable: board.unreadable,
    conflicts: board.conflicts,
    canAct: board.canAct,
    // FR-083/FR-084. Without these the gate can never be satisfied and no
    // session bound to a work item could ever start.
    onApproveGate: (workItemId, gate) => {
      void act(workItemId, 'approveGate', [workItemId, gate])
    },
    onRejectGate: (workItemId, gate, notes) => {
      void act(workItemId, 'rejectGate', [workItemId, gate, notes])
    },
    onSendBack: (workItemId, phase, notes) => {
      void act(workItemId, 'sendBack', [workItemId, phase, notes])
    },
    onAdvancePhase: (workItemId) => {
      void act(workItemId, 'advancePhase', [workItemId])
    },
    actionError,
    onDismissActionError: () => setActionError(null),

    selectedWorkItemId: openWorkItem,
    // The next lane to start: the lowest ordinal nothing has merged yet and
    // nothing is blocking. Merge order is left to right, so that is the only
    // lane it would be correct to start next (FR-088).
    selectedLaneOrd: nextLaneOrd,
    onOpenWorkItem: (workItemId) => {
      setOpenWorkItem(workItemId)
    },

    lanes: laneState.lanes,
    mergedOrds: laneState.mergedOrds,
    staleOrds: laneState.staleOrds,
    blockedReasons: laneState.blockedReasons,
    onMergeLane: (ord) => {
      if (openWorkItem === null) return
      void bridge()
        ?.mergeLane?.({ workItemId: openWorkItem, ord })
        .then(() => bridge()?.getLanes?.({ workItemId: openWorkItem }).then(setLaneState))
    },

    feed,
    digest,
    digestWindowMinutes: DIGEST_WINDOW_MINUTES,
    onRefreshDigest: refreshDigest,
    mutedSessions: muted,
    onReply: (sessionId, message) => {
      void bridge()?.replyToSession?.({ sessionId, message })
    },
    onRemoveFeedEntry: (id: string) => {
      const transport = bridge()
      void transport?.removeFeedEntry?.({ id }).then(() => transport.listFeed?.().then(setFeed))
    },
    onToggleMute: (sessionId) =>
      setMuted((current) =>
        current.includes(sessionId)
          ? current.filter((id) => id !== sessionId)
          : [...current, sessionId]
      ),

    shadowMode,
    firings,
    precision,
    onSetShadowMode: (value) => {
      setShadow(value)
      void bridge()?.setShadowMode?.({ value })
    },
    // FR-029: the four actions a stall must offer. Without these a stalled
    // session told you it was stuck and gave you nothing to do about it.
    onAskWhatIsWrong: (sessionId) => {
      void bridge()?.replyToSession?.({
        sessionId,
        message: 'You appear to be stuck. What is blocking you?',
      })
    },
    onShowActivity: (sessionId) => {
      setOpenSession(sessionId)
      onOpenSessionInShell?.(sessionId)
    },
    onInterrupt: (sessionId, redirect) => {
      void bridge()
        ?.interruptSession?.({ sessionId, redirect })
        .then(() => refreshAll())
    },
    onDiscard: (sessionId) => {
      void bridge()
        ?.discardSession?.({ sessionId })
        .then(() => refreshAll())
    },

    onRemoveFiring: (id: string) => {
      const transport = bridge()
      void transport?.removeFiring?.({ id }).then(() =>
        transport.listFirings?.().then((result) => {
          setFirings(result.firings)
          setPrecision(result.precision)
        })
      )
    },
    onJudge: (firingId, judgement) => {
      void bridge()?.judgeFiring?.({ firingId, judgement })
    },

    entities,
    // FR-026: one keystroke to get anywhere. Dispatching an event nothing
    // listens for is the same as doing nothing.
    onChooseEntity: (entity) => {
      if (entity.kind === 'session') {
        setOpenSession(entity.id)
      } else if (entity.kind === 'workItem') {
        setOpenWorkItem(entity.id)
      } else if (entity.kind === 'command' && entity.id === 'toggle-shadow') {
        setShadow((current) => {
          void bridge()?.setShadowMode?.({ value: !current })
          return !current
        })
      }
      // A repository or a worktree has no surface of its own yet; choosing one
      // opens the session that owns it, which does.
      if (entity.kind === 'repository' || entity.kind === 'worktree') {
        const owner = sessions.find(
          (session) => session.repoPath === entity.id || session.worktreePath === entity.id
        )
        if (owner !== undefined) setOpenSession(owner.id)
      }
      onNavigate?.(entity)
    },

    backpressure,
    // Dismissing the refusal is the override the operator takes knowingly; the
    // record of it is written in the main process (FR-054).
    onOverrideBackpressure: () => setBackpressure(null),
    onCancelAssign: () => setBackpressure(null),
    autonomy,
    onAutonomyChange: setAutonomy,

    // The front door. Everything else in the console supervises what this
    // creates; without it the substrate has nothing to watch.
    assigning,
    assignResult,
    repos,
    branches,
    currentBranch,
    onRepoChange: setAssignRepo,
    onAssign: (request: {
      repoPath: string
      branch: string
      isNewBranch?: boolean
      instruction?: string
      workItemId?: string
      laneOrd?: number
    }) => {
      const transport = bridge()
      if (transport?.assign === undefined) {
        setAssignResult({ ok: false, reason: 'This build cannot start agents.' })
        return
      }
      setAssigning(true)
      void transport
        .assign({ ...request, autonomyLevel: autonomy })
        .then((result) => {
          setAssignResult(result)
          // A refusal by the review queue is shown as the refusal dialog, not
          // as a line of text — being told why is the whole mechanism (FR-053).
          if (result.backpressure !== undefined) setBackpressure(result.backpressure)
          if (result.ok) void transport.listSessions().then(() => refreshAll())
        })
        .finally(() => setAssigning(false))
    },

    queuedIntake,
    pulling,
    onRemoveIntake: (id: string) => {
      const transport = bridge()
      void transport
        ?.removeIntake?.({ id })
        .then(() => transport.listIntake?.().then(setQueuedIntake))
    },
    onPullFromLinear: () => {
      const transport = bridge()
      if (transport?.pullFromLinear === undefined) {
        setIntakeResult({ ok: false, reason: 'This build cannot pull from Linear.' })
        return
      }
      setPulling(true)
      void transport
        .pullFromLinear()
        .then((result) => {
          // A key that is missing or rejected must say so: an empty list would
          // otherwise read as "you have no issues".
          setIntakeResult(
            result.ok
              ? {
                  ok: true,
                  reason: `Pulled ${result.added} ${result.added === 1 ? 'issue' : 'issues'} from Linear.`,
                }
              : { ok: false, reason: result.reason ?? 'could not reach Linear' }
          )
          return transport.listIntake?.().then(setQueuedIntake)
        })
        .finally(() => setPulling(false))
    },

    intakeResult,
    onIntake: (input: { url?: string; filePath?: string }) => {
      const transport = bridge()
      if (transport?.intake === undefined) {
        setIntakeResult({ ok: false, reason: 'This build cannot take in tickets.' })
        return
      }
      void transport.intake(input).then((result) => {
        setIntakeResult(result)
        if (result.ok) {
          void transport.listWorkItems?.().then(setBoard)
          void transport.listIntake?.().then(setQueuedIntake)
        }
      })
    },

    reclaimable,
    reclaimBusy,
    reclaimError,
    onReclaim: (path: string) => void reclaim(path),
    onReclaimAll: () => {
      void (async () => {
        // Sequentially: each runs a teardown script and a git command, and
        // several at once against one repository is how you get lock errors.
        for (const worktree of reclaimable) await reclaim(worktree.path)
      })()
    },
    onRefreshReclaimable: refreshReclaimable,

    provisioning,
    onOpenInEditor: () => {
      if (openSession === null) return
      void bridge()?.openInEditor?.({ sessionId: openSession })
    },

    lastViewedAt: since.lastViewedAt,
    sinceEntries: since.entries,
    sinceStateChanges: since.stateChanges,
    sinceDiffDelta: since.diffDelta,
  }

  return {
    loaded,
    attention,
    summary,
    screenProps,
  }
}
