import { join } from 'path'
import { createEventBus, type EventBus } from './events/event-bus.js'
import {
  createSessionRegistry,
  type SessionRegistry,
  type RegistryStore,
} from './state/session-registry.js'
import { createSessionDriver, type SessionDriver } from './agent-runtime/driver.js'
import { createFiringLog, type FiringLog } from './stall/firing-log.js'
import { createStallSurfacer, type StallSurfacer, type ShadowStore } from './stall/surface-stall.js'
import { createStallScheduler, type StallScheduler } from './stall/stall-scheduler.js'
import { readTranscript } from './agent-runtime/transcript-tailer.js'
import { staleLanes } from './lanes/lane-coordination.js'
import { parseHunks } from './review/parse-hunks.js'
import type { Hunk } from './review/hunk-decisions.js'
import { reconcile } from './state/reconcile.js'
import { applyEvent, initialSessionState } from './state/state-machine.js'
import { channelFor, buildDigest } from './feed/digest.js'
import { buildEntityIndex } from './query/entity-index.js'
import { mayBeginImplementation } from './workitems/gates.js'
import { intakeFromUrl, intakeFromDocument, type IntakeResult } from './workitems/intake.js'
import { createBackpressureGate, type BackpressureGate } from './review/backpressure.js'
import { createMergePolicy, type MergePolicy } from './review/merge-policy.js'
import { loadRepoConfig } from './worktree/repo-config.js'
import { createReviewQueue, type ReviewQueue } from './review/review-queue.js'
import { createFeedLog, type FeedLog, type FeedEntry } from './feed/feed-log.js'
import { createLaneBindings, type LaneBindings } from './workitems/lane-bindings.js'
import {
  createProducerRegistry,
  type ProducerRegistry,
  type ProducerAction,
  type ActionResult,
} from './workitems/producer-commands.js'
import {
  watchPublications,
  publicationRoot,
  type WatcherHandle,
} from './workitems/publication-watcher.js'
import { createProvisioner, type GitWorktreeOps } from './worktree/provisioner.js'
import type { PortSpan } from './worktree/port-allocator.js'
import {
  createCodeHostClient,
  runCommand,
  type CodeHostClient,
} from '../codehost/codehost-client.js'
import { readDiffSummary, readChangedFiles } from './state/session-metrics.js'
import { createFeedReply } from './feed/feed-reply.js'
import { createAssigner } from './assign-agent.js'
import { createDecisionSet, type DecisionSet } from './review/hunk-decisions.js'
import { detectMilestones, describeMilestone } from './feed/milestone-summary.js'
import type { SessionEvent } from './events/session-event.js'
import type { SupervisedSession } from '../../shared/types/supervision.js'

// Composition root for the supervision substrate. Everything below is wired
// here and nowhere else, so each part stays independently testable and this
// file stays the only place that knows how they fit together.

export interface SupervisionServiceOptions {
  /** Application user-data directory. Logs and registry state live under it. */
  userDataPath: string
  registryStore: RegistryStore
  shadowStore: ShadowStore
  bindingStore?: RegistryStore
  /** Injected so the service can be built without Electron in a test. */
  git?: GitWorktreeOps
  worktreeRoot?: string
  sendToSession?: (sessionId: string, message: string) => Promise<void>
  /** Injected so the review-queue path can be exercised without a real repository. */
  readDiff?: typeof readDiffSummary
  readFiles?: typeof readChangedFiles
  run?: typeof runCommand
  codeHost?: CodeHostClient
  now?: () => number
  onStateChanged?: (change: { sessionId: string; to: string; at: number }) => void
  /**
   * A producer wrote, changed or removed a work item. FR-071: the board must
   * reflect it without the operator refreshing anything, and the watcher's
   * whole purpose is to say so rather than be polled.
   */
  onPublicationsChanged?: () => void
  notify?: (entry: { sessionId: string; summary: string }) => void
}

export interface SupervisionService {
  readonly bus: EventBus
  readonly registry: SessionRegistry
  readonly driver: SessionDriver
  readonly firings: FiringLog
  readonly stalls: StallSurfacer
  readonly scheduler: StallScheduler
  readonly backpressure: BackpressureGate
  readonly mergePolicy: MergePolicy
  readonly reviewQueue: ReviewQueue
  readonly feed: FeedLog
  readonly laneBindings: LaneBindings
  readonly producers: ProducerRegistry
  readonly publications: WatcherHandle
  readonly provisioner: ReturnType<typeof createProvisioner>
  readonly codeHost: CodeHostClient
  readonly feedReply: ReturnType<typeof createFeedReply>
  readonly assigner: ReturnType<typeof createAssigner>
  /** Per-session hunk decisions, created on first use and kept until reviewed. */
  hunkDecisionsFor(sessionId: string): DecisionSet
  /** What provisioning produced for a session, for the status surface. */
  /**
   * Re-reads the agent's durable record and reconciles it against what the
   * driver reported. The transcript wins (FR-006), which is what keeps state
   * current when the driver process is gone and what rebuilds it after a
   * restart (FR-009, SC-010).
   */
  reconcileFromTranscript(sessionId: string): void
  /** Which channel an event may use — modal only for a blocking prompt (FR-028). */
  notificationChannelFor(
    kind: Parameters<typeof channelFor>[0]['kind'],
    sessionId: string
  ): ReturnType<typeof channelFor>
  digestSince(fromMs: number, toMs: number): ReturnType<typeof buildDigest>
  /** One ranked index over every entity, for the palette (FR-026). */
  entityIndex(
    commands: ReadonlyArray<{ id: string; label: string }>
  ): ReturnType<typeof buildEntityIndex>
  /** Refuses implementation until both gates are approved (FR-083). */
  mayBeginImplementation(workItemId: string): ReturnType<typeof mayBeginImplementation>
  /** Normalises a ticket URL or a dropped document into one shape (FR-068). */
  intake(input: { url?: string; filePath?: string; contents?: string }): IntakeResult
  /**
   * What changed while the operator was not looking, and marks it looked at
   * (FR-036). Assembled here rather than in the composition root so it is
   * testable and so "what did I miss" cannot silently answer "nothing".
   */
  sinceLastLooked(
    sessionId: string,
    at: number
  ): {
    lastViewedAt: number | null
    entries: readonly FeedEntry[]
    stateChanges: ReadonlyArray<{ to: string; at: number }>
    diffDelta: { files: number; added: number; removed: number } | null
  }
  /**
   * Directs an action at whichever producer published the item (FR-077). The
   * console never reaches into a producer by any other means, and never edits
   * the contract file itself (FR-076).
   */
  runProducerAction(
    workItemId: string,
    action: ProducerAction,
    args: readonly unknown[]
  ): Promise<ActionResult>
  /** Files a session changed, for the intent step and the grader. */
  changedFilesFor(sessionId: string): string[]
  /** Files the lane's work item implied, or empty for ad-hoc work. */
  expectedFilesFor(sessionId: string): string[]
  /** Per-hunk review units for the accept/reject surface (FR-052). */
  hunksFor(sessionId: string): Hunk[]
  /** Lanes left behind by an upstream merge to a shared file (FR-090). */
  staleLanesFor(workItemId: string): number[]
  provisioningFor(sessionId: string): {
    worktreePath: string | null
    ports: { portBase: number; portSpan: number } | null
    setup: { exitCode: number; output: string; durationMs: number } | null
    skipped: ReadonlyArray<{ path: string; reason: string }>
  } | null
  /** The directory a producer writes its contract files into (FR-070). */
  publicationDirectoryFor(producerId: string): string
  listSessions(): SupervisedSession[]
  getSession(sessionId: string): SupervisedSession | null
  start(): void
  stop(): void
}

const UNREVIEWED_LIMIT = 3

export function createSupervisionService(options: SupervisionServiceOptions): SupervisionService {
  const { userDataPath, registryStore, shadowStore } = options
  const now = options.now ?? Date.now
  const dir = join(userDataPath, 'supervision')

  const bus = createEventBus({
    onError: (error) => {
      // A subscriber blowing up must not stop the state machine seeing the rest
      // of the stream, but it must not vanish either.
      console.error('[supervision] subscriber failed', error)
    },
  })

  const registry = createSessionRegistry({ store: registryStore, now })
  const firings = createFiringLog(join(dir, 'stall-firings.jsonl'))

  const driver = createSessionDriver({
    publish: (event: SessionEvent) => bus.publish(event),
    now,
  })

  const stalls = createStallSurfacer({
    log: firings,
    setStalled: (sessionId) => {
      const session = registry.get(sessionId)
      if (session === null) return
      options.onStateChanged?.({ sessionId, to: 'stalled', at: now() })
    },
    postFeedEntry: (entry) => feed.post(entry),
    notify: (entry) => {
      // A stall is a non-blocking indicator, never a modal — only a blocking
      // permission request may interrupt (FR-028).
      if (channelFor({ kind: 'stalled', sessionId: entry.sessionId }) === 'digest') return
      options.notify?.({ sessionId: entry.sessionId, summary: entry.summary })
    },
    shadowStore,
  })

  const scheduler = createStallScheduler({
    listSessions: () => registry.list(),
    thresholdsFor: (repoPath) => loadRepoConfig(repoPath).stall,
    onFiring: (firing) => stalls.surface(firing),
    now,
  })

  // Reconcile against the durable record on the same tick. The driver can die,
  // lag, or be restarted; the transcript survives all three (FR-006).
  const reconcileTimer = setInterval(() => {
    for (const session of registry.list()) service.reconcileFromTranscript(session.id)
  }, 30_000)
  reconcileTimer.unref?.()

  const backpressure = createBackpressureGate({
    limit: UNREVIEWED_LIMIT,
    // Counted globally: the constraint is one operator's review capacity,
    // which does not partition by repository.
    countUnreviewed: () => reviewQueue.count(),
    overrideLogPath: join(dir, 'backpressure-overrides.jsonl'),
  })

  const feed = createFeedLog(join(dir, 'feed.jsonl'))
  const reviewQueue = createReviewQueue()
  const producers = createProducerRegistry()
  const laneBindings = createLaneBindings(
    options.bindingStore ?? { get: () => undefined, set: () => {} }
  )
  const publications = watchPublications(publicationRoot(userDataPath), () => {
    options.onPublicationsChanged?.()
  })
  const codeHost = options.codeHost ?? createCodeHostClient(options.run ?? runCommand)
  const readDiff = options.readDiff ?? readDiffSummary
  const readFiles = options.readFiles ?? readChangedFiles
  const run = options.run ?? runCommand

  // Port spans held by working copies that are already live, so a new one never
  // overlaps them (SC-008). Keyed by worktree so a released copy frees its span
  // — an array that is only ever read would let every session take port 4000.
  const spansByWorktree = new Map<string, PortSpan>()

  const baseProvisioner = createProvisioner({
    git: options.git ?? {
      createWorktree: async () => {
        throw new Error('git worktree operations were not provided')
      },
      removeWorktree: async () => {},
    },
    isPortFree: () => true,
    activeSpans: () => [...spansByWorktree.values()],
    publish: (event) => bus.publish(event),
    now,
  })

  // Records the allocation so the next provision sees it, and releases it so a
  // span is reusable once its worktree is gone.
  const provisioner = {
    async provision(request: Parameters<typeof baseProvisioner.provision>[0]) {
      const result = await baseProvisioner.provision(request)
      spansByWorktree.set(result.worktreePath, result.ports)
      // Kept so the provisioning surface can show the setup output without the
      // operator opening a transcript (FR-034).
      provisioningBySession.set(request.sessionId, {
        worktreePath: result.worktreePath,
        ports: result.ports,
        setup: result.setup,
        skipped: result.materialized.skipped,
      })
      return result
    },
    async release(request: Parameters<typeof baseProvisioner.release>[0]) {
      const released = await baseProvisioner.release(request)
      spansByWorktree.delete(request.worktreePath)
      return released
    },
  }

  const decisionsBySession = new Map<string, DecisionSet>()
  const changedFilesBySession = new Map<string, string[]>()
  const hunksBySession = new Map<string, Hunk[]>()
  const provisioningBySession = new Map<
    string,
    {
      worktreePath: string | null
      ports: { portBase: number; portSpan: number } | null
      setup: { exitCode: number; output: string; durationMs: number } | null
      skipped: ReadonlyArray<{ path: string; reason: string }>
    }
  >()

  const feedReply = createFeedReply({
    log: feed,
    sendToSession:
      options.sendToSession ??
      (async () => {
        throw new Error('this session is no longer running')
      }),
    now,
  })

  const mergePolicy = createMergePolicy({
    isUnattendedEnabledFor: (repoPath) =>
      loadRepoConfig(repoPath).review.unattendedMergeLowestGrade,
    auditLogPath: join(dir, 'unattended-merges.jsonl'),
  })

  // Every event reaches the registry; state changes are pushed to the renderer.
  const seenEvents: SessionEvent[] = []

  // What each session did while you were not looking (FR-036). Bounded: this
  // is a "what did I miss" panel, not an audit log, and an unbounded array on a
  // long-running session is a leak.
  const TRANSITION_HISTORY = 50
  const transitionsBySession = new Map<string, Array<{ to: string; at: number }>>()
  /** The diff as it stood when the operator last looked, for the delta. */
  const diffAtLastView = new Map<string, { files: number; added: number; removed: number }>()

  bus.subscribe((event) => {
    const before = registry.get(event.sessionId)?.runtimeState
    registry.apply(event)
    const after = registry.get(event.sessionId)?.runtimeState
    if (after !== undefined && after !== before) {
      const history = transitionsBySession.get(event.sessionId) ?? []
      history.push({ to: after, at: event.at })
      transitionsBySession.set(event.sessionId, history.slice(-TRANSITION_HISTORY))
      options.onStateChanged?.({ sessionId: event.sessionId, to: after, at: event.at })
    }

    // A milestone is worth a line in the feed; individual tool calls are not.
    seenEvents.push(event)
    const milestones = detectMilestones(seenEvents)
    const latest = milestones.at(-1)
    if (latest !== undefined && latest.at === event.at) {
      feed.post({
        at: latest.at,
        sessionId: latest.sessionId,
        author: 'agent',
        summary: describeMilestone(latest),
      })
    }

    // Reaching `ready` is what puts work in front of the operator. Without this
    // the queue stays empty and backpressure counts nothing (FR-045).
    if (after === 'ready' && before !== 'ready') {
      void enqueueForReview(event.sessionId)
    }
  })

  async function enqueueForReview(sessionId: string): Promise<void> {
    const session = registry.get(sessionId)
    if (session === null) return

    const config = loadRepoConfig(session.repoPath)
    const base = config.review.baseBranch

    const diffSummary = await readDiff(session.worktreePath, base, run)
    if (diffSummary.files === 0) return

    const checkState = await codeHost.checkState(session.repoPath, session.branch)
    // Without the file list the grader cannot see auth, payments, migrations or
    // a critical path, so every change would grade P2 and P0 could never fire.
    const files = await readFiles(session.worktreePath, base, run)
    changedFilesBySession.set(sessionId, files)

    // The unit of review is the hunk, not the file: one file routinely holds
    // both the change you asked for and the one you did not (FR-052).
    try {
      const patch = await run('git', ['diff', `${base}...HEAD`], session.worktreePath)
      hunksBySession.set(sessionId, patch.ok ? parseHunks(patch.stdout) : [])
    } catch {
      hunksBySession.set(sessionId, [])
    }

    // Shared contract files come from the work item this session's lane belongs
    // to, when there is one (FR-048).
    const binding = laneBindings.forSession(sessionId)
    const sharedContractFiles =
      binding === null
        ? []
        : (publications.snapshot().items.find((entry) => entry.item.id === binding.workItemId)?.item
            .contract?.shared_files ?? [])

    reviewQueue.enqueue({
      sessionId,
      repoPath: session.repoPath,
      branch: session.branch,
      diffSummary,
      change: {
        files,
        linesChanged: diffSummary.added + diffSummary.removed,
        checkState,
        sharedContractFiles,
        criticalPaths: config.review.criticalPaths,
      },
      queuedAt: now(),
    })
  }

  const service: SupervisionService = {
    bus,
    registry,
    driver,
    firings,
    stalls,
    scheduler,
    backpressure,
    mergePolicy,
    reviewQueue,
    feed,
    laneBindings,
    producers,
    publications,
    provisioner,
    codeHost,
    feedReply,
    // Assigned last: it needs the assembled service, and it is the only path
    // that actually starts a supervised session.
    get assigner() {
      return createAssigner(service, now)
    },
    hunkDecisionsFor: (sessionId: string) => {
      const existing = decisionsBySession.get(sessionId)
      if (existing !== undefined) return existing
      const created = createDecisionSet([])
      decisionsBySession.set(sessionId, created)
      return created
    },
    reconcileFromTranscript: (sessionId: string) => {
      const session = registry.get(sessionId)
      if (session === null || session.transcriptPath === null) return

      // Rebuild what the transcript alone implies, then let it win.
      const fromTranscript = readTranscript(sessionId, session.transcriptPath).reduce(
        applyEvent,
        initialSessionState(sessionId, session.stateSince)
      )
      const driverState = {
        ...initialSessionState(sessionId, session.stateSince),
        runtimeState: session.runtimeState,
        transcriptPath: session.transcriptPath,
        lastToolActivityAt: session.lastToolActivityAt,
        lastNetChangeAt: session.lastNetChangeAt,
        turns: session.turns,
        costUsd: session.costUsd,
        pendingPermission: session.pendingPermission,
      }
      const merged = reconcile(driverState, fromTranscript)
      if (merged.lastToolActivityAt === null) return
      bus.publish({
        kind: 'tool_finished',
        sessionId,
        callId: 'transcript-reconcile',
        ok: true,
        at: merged.lastToolActivityAt,
      })
    },

    notificationChannelFor: (kind, sessionId) => channelFor({ kind, sessionId }),

    digestSince: (fromMs: number, toMs: number) => buildDigest(feed.list(), fromMs, toMs),

    entityIndex: (commands) =>
      buildEntityIndex({
        sessions: registry.list(),
        workItems: publications.snapshot().items.map((entry) => entry.item),
        commands,
      }),

    mayBeginImplementation: (workItemId: string) => {
      const published = publications.snapshot().items.find((entry) => entry.item.id === workItemId)
      if (published === undefined) {
        return {
          allowed: false,
          missing: ['spec_approved_by_human', 'plan_approved_by_human'] as never,
          reason: 'no such work item',
        }
      }
      return mayBeginImplementation(published.item)
    },

    intake: (input) => {
      if (input.url !== undefined) return intakeFromUrl(input.url, now())
      if (input.filePath !== undefined) {
        return intakeFromDocument(input.filePath, input.contents ?? '', now())
      }
      return { ok: false, reason: 'nothing to bring in' }
    },

    sinceLastLooked: (sessionId, at) => {
      const session = registry.get(sessionId)
      const lastViewedAt = session?.lastViewedAt ?? null
      const previous = diffAtLastView.get(sessionId) ?? null
      const current = session?.diffSummary ?? null

      const result = {
        lastViewedAt,
        entries: feed
          .forSession(sessionId)
          .filter((entry) => lastViewedAt === null || entry.at > lastViewedAt),
        stateChanges: (transitionsBySession.get(sessionId) ?? []).filter(
          (change) => lastViewedAt === null || change.at > lastViewedAt
        ),
        // Null on a first look: there is no previous state to differ from, and
        // reporting the whole diff as "new since you looked" would be a lie.
        diffDelta:
          previous === null || current === null
            ? null
            : {
                files: current.files - previous.files,
                added: current.added - previous.added,
                removed: current.removed - previous.removed,
              },
      }

      registry.markViewed(sessionId, at)
      if (current !== null) diffAtLastView.set(sessionId, { ...current })
      return result
    },

    runProducerAction: async (workItemId, action, args) => {
      const published = publications.snapshot().items.find((entry) => entry.item.id === workItemId)
      if (published === undefined) {
        return { ok: false, reason: `no work item named ${workItemId} is published` }
      }
      return producers.invoke(published.producerId, action, args)
    },

    changedFilesFor: (sessionId: string) => changedFilesBySession.get(sessionId) ?? [],

    expectedFilesFor: (sessionId: string) => {
      const binding = laneBindings.forSession(sessionId)
      if (binding === null) return []
      const published = publications
        .snapshot()
        .items.find((entry) => entry.item.id === binding.workItemId)
      return published?.item.contract?.shared_files ?? []
    },

    hunksFor: (sessionId: string) => hunksBySession.get(sessionId) ?? [],

    staleLanesFor: (workItemId: string) => {
      const published = publications.snapshot().items.find((entry) => entry.item.id === workItemId)
      if (published === undefined) return []
      const merged = registry
        .list()
        .filter((session) => session.runtimeState === 'merged' && session.laneOrd !== null)
      if (merged.length === 0) return []
      const startedAt = new Map(
        registry
          .list()
          .filter((session) => session.laneOrd !== null)
          .map((session) => [session.laneOrd as number, session.stateSince])
      )
      // The most recently merged upstream lane is the one whose change the
      // downstream lanes may not have seen.
      const upstream = merged.reduce((a, b) => (a.stateSince > b.stateSince ? a : b))
      return staleLanes(published.item, upstream.laneOrd as number, upstream.stateSince, startedAt)
    },

    provisioningFor: (sessionId: string) => provisioningBySession.get(sessionId) ?? null,
    publicationDirectoryFor: (producerId: string) =>
      join(publicationRoot(userDataPath), producerId),
    listSessions: () => registry.list(),
    getSession: (sessionId: string) => registry.get(sessionId),
    start: () => scheduler.start(),
    stop: () => {
      scheduler.stop()
      clearInterval(reconcileTimer)
      publications.close()
    },
  }

  return service
}
