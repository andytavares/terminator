import { z } from 'zod'
import { handleChannel } from './channel-registrar.js'
import {
  supervisedSessionSchema,
  type SupervisedSession,
} from '../../shared/schemas/supervision.js'

// Read-only supervision channels. Runtime state is derived from observed agent
// activity, so nothing here accepts a state assertion from the renderer — the
// surfaces render what the substrate observed and never the other way round.

export const SUPERVISION_CHANNELS = {
  listSessions: 'supervision:listSessions',
  getSession: 'supervision:getSession',
  provision: 'supervision:provision',
  archive: 'supervision:archive',
  openInEditor: 'supervision:openInEditor',
  setShadowMode: 'supervision:setShadowMode',
  judgeFiring: 'supervision:judgeFiring',
  resolvePermission: 'supervision:resolvePermission',
  listFeed: 'supervision:listFeed',
  listFirings: 'supervision:listFirings',
  listReview: 'supervision:listReview',
  listUnattendedMerges: 'supervision:listUnattendedMerges',
  listWorkItems: 'supervision:listWorkItems',
  replyToSession: 'supervision:replyToSession',
  getReviewDetail: 'supervision:getReviewDetail',
  decideHunk: 'supervision:decideHunk',
  advanceReview: 'supervision:advanceReview',
  getLanes: 'supervision:getLanes',
  mergeLane: 'supervision:mergeLane',
  getProvisioning: 'supervision:getProvisioning',
  getSinceLastLooked: 'supervision:getSinceLastLooked',
  precheckBackpressure: 'supervision:precheckBackpressure',
  entityIndex: 'supervision:entityIndex',
  intake: 'supervision:intake',
  removeFeedEntry: 'supervision:removeFeedEntry',
  removeFiring: 'supervision:removeFiring',
  listIntake: 'supervision:listIntake',
  removeIntake: 'supervision:removeIntake',
  pullFromLinear: 'supervision:pullFromLinear',
  assign: 'supervision:assign',
  producerAction: 'supervision:producerAction',
  getDigest: 'supervision:getDigest',
  interruptSession: 'supervision:interruptSession',
  discardSession: 'supervision:discardSession',
  stopSession: 'supervision:stopSession',
  listReclaimable: 'supervision:listReclaimable',
  reclaimWorktree: 'supervision:reclaimWorktree',
} as const

/**
 * Where session data comes from. Injected rather than imported so the handlers
 * can be tested without standing up the registry, and so the registry stays
 * free of any IPC concern.
 */
export interface SupervisionSource {
  listSessions(): readonly SupervisedSession[]
  getSession(sessionId: string): SupervisedSession | null
  /** Optional: absent in tests that only exercise the read surface. */
  provision?(request: {
    sessionId: string
    workItemId: string
    repoPath: string
    branch: string
  }): Promise<{ worktreePath: string; ok: boolean }>
  archive?(sessionId: string): Promise<{ allowed: boolean; reason: string | null }>
  openInEditor?(sessionId: string): Promise<{ ok: boolean; reason: string | null }>
  setShadowMode?(value: boolean): void
  judgeFiring?(firingId: string, judgement: 'correct' | 'incorrect'): void
  resolvePermission?(
    sessionId: string,
    requestId: string,
    decision: 'allow' | 'deny',
    answer?: string
  ): void
  listFeed?(): readonly unknown[]
  listFirings?(): { firings: readonly unknown[]; precision: unknown }
  listReview?(): readonly unknown[]
  listUnattendedMerges?(): readonly unknown[]
  listWorkItems?(): {
    items: readonly unknown[]
    unreadable: readonly unknown[]
    conflicts: readonly unknown[]
    canAct: boolean
  }
  replyToSession?(
    sessionId: string,
    message: string
  ): Promise<{ ok: boolean; reason: string | null }>
  getReviewDetail?(sessionId: string): unknown | null
  decideHunk?(sessionId: string, hunkId: string, decision: 'accept' | 'reject'): void
  advanceReview?(sessionId: string): void
  getLanes?(workItemId: string): unknown
  mergeLane?(workItemId: string, ord: number): Promise<{ ok: boolean; reason: string | null }>
  getProvisioning?(sessionId: string): unknown | null
  getSinceLastLooked?(sessionId: string): unknown
  precheckBackpressure?(): unknown
  entityIndex?(): readonly unknown[]
  intake?(input: { url?: string; filePath?: string; contents?: string }): unknown
  removeFeedEntry?(id: string): void
  removeFiring?(id: string): void
  listIntake?(): readonly unknown[]
  removeIntake?(id: string): void
  pullFromLinear?(): Promise<{ ok: boolean; added: number; reason: string | null }>
  assign?(request: unknown): Promise<unknown>
  getDigest?(windowMs: number): unknown
  interruptSession?(
    sessionId: string,
    redirect?: string
  ): Promise<{ ok: boolean; reason: string | null }>
  discardSession?(sessionId: string): Promise<{ ok: boolean; reason: string | null }>
  stopSession?(sessionId: string, reason?: string): Promise<{ ok: boolean; reason: string | null }>
  listReclaimable?(): readonly unknown[]
  reclaimWorktree?(path: string): Promise<{ ok: boolean; reason: string | null }>
  producerAction?(
    workItemId: string,
    action: 'approveGate' | 'rejectGate' | 'advancePhase' | 'sendBack',
    args: readonly unknown[]
  ): Promise<{ ok: boolean; reason: string | null }>
}

const getSessionPayload = z.object({ sessionId: z.string().min(1) })

/**
 * Validates on the way out as well as in. A session that fails the schema is
 * dropped rather than served: one malformed row must not take down a listing
 * surface that would otherwise render correctly.
 */
function validOnly(sessions: readonly SupervisedSession[]): SupervisedSession[] {
  return sessions.filter((session) => supervisedSessionSchema.safeParse(session).success)
}

const provisionPayload = z.object({
  sessionId: z.string().min(1),
  workItemId: z.string().min(1),
  repoPath: z.string().min(1),
  branch: z.string().min(1),
})

const sessionPayload = z.object({ sessionId: z.string().min(1) })
const shadowPayload = z.object({ value: z.boolean() })
const permissionPayload = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  decision: z.enum(['allow', 'deny']),
  /** A real answer, for a request that is a question rather than a yes/no. */
  answer: z.string().optional(),
})
const replyPayload = z.object({ sessionId: z.string().min(1), message: z.string().min(1) })
const hunkPayload = z.object({
  sessionId: z.string().min(1),
  hunkId: z.string().min(1),
  decision: z.enum(['accept', 'reject']),
})
const workItemPayload = z.object({ workItemId: z.string().min(1) })
const lanePayload = z.object({ workItemId: z.string().min(1), ord: z.number().int().positive() })
const intakePayload = z.object({
  url: z.string().optional(),
  filePath: z.string().optional(),
  contents: z.string().optional(),
})
const assignPayload = z.object({
  repoPath: z.string().min(1),
  branch: z.string().min(1),
  autonomyLevel: z.enum(['read', 'edit', 'build', 'ship']),
  workItemId: z.string().optional(),
  laneOrd: z.number().int().positive().optional(),
  instruction: z.string().optional(),
  overrideBackpressure: z.boolean().optional(),
  /** Absent means a new branch, which is what an agent normally wants. */
  isNewBranch: z.boolean().optional(),
  /**
   * The workspace the session's project and terminal should appear in. Passed
   * by the renderer, which is the only part that knows which one the operator
   * is looking at — guessing would open an agent's terminal somewhere else.
   */
  workspaceId: z.string().nullable().optional(),
})
// The action set is closed: an unknown action must be refused here rather than
// forwarded to a producer that would have to guess what it means.
const producerActionPayload = z.object({
  workItemId: z.string().min(1),
  action: z.enum(['approveGate', 'rejectGate', 'advancePhase', 'sendBack']),
  args: z.array(z.unknown()).default([]),
})
// Zero or a negative window would produce an empty digest that reads as "no
// progress" rather than "you asked for nothing".
const digestPayload = z.object({ windowMs: z.number().int().positive() })
const reclaimPayload = z.object({ path: z.string().min(1) })
const intakeIdPayload = z.object({ id: z.string().min(1) })
const stopPayload = z.object({ sessionId: z.string().min(1), reason: z.string().optional() })
const interruptPayload = z.object({
  sessionId: z.string().min(1),
  redirect: z.string().optional(),
})
const judgePayload = z.object({
  firingId: z.string().min(1),
  judgement: z.enum(['correct', 'incorrect']),
})

export function registerSupervisionHandlers(source: SupervisionSource): void {
  handleChannel(SUPERVISION_CHANNELS.listSessions, async () => validOnly(source.listSessions()))

  handleChannel(SUPERVISION_CHANNELS.getSession, async (_event, payload: unknown) => {
    const parsed = getSessionPayload.safeParse(payload)
    if (!parsed.success) return null
    const session = source.getSession(parsed.data.sessionId)
    if (session === null) return null
    return supervisedSessionSchema.safeParse(session).success ? session : null
  })

  handleChannel(SUPERVISION_CHANNELS.provision, async (_event, payload: unknown) => {
    const parsed = provisionPayload.safeParse(payload)
    if (!parsed.success) return { worktreePath: null, ok: false }
    // Absent capability is reported, never thrown: a surface calling into a
    // console built without provisioning gets an answer, not a crash.
    if (source.provision === undefined) return { worktreePath: null, ok: false }
    return source.provision(parsed.data)
  })

  handleChannel(SUPERVISION_CHANNELS.archive, async (_event, payload: unknown) => {
    const parsed = sessionPayload.safeParse(payload)
    if (!parsed.success) return { allowed: false, reason: 'invalid request' }
    if (source.archive === undefined) return { allowed: false, reason: 'archiving is unavailable' }
    return source.archive(parsed.data.sessionId)
  })

  handleChannel(SUPERVISION_CHANNELS.openInEditor, async (_event, payload: unknown) => {
    const parsed = sessionPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, reason: 'invalid request' }
    if (source.openInEditor === undefined) {
      return { ok: false, reason: 'no external editor is configured' }
    }
    return source.openInEditor(parsed.data.sessionId)
  })

  handleChannel(SUPERVISION_CHANNELS.setShadowMode, async (_event, payload: unknown) => {
    const parsed = shadowPayload.safeParse(payload)
    if (!parsed.success) return { ok: false }
    source.setShadowMode?.(parsed.data.value)
    return { ok: true }
  })

  handleChannel(SUPERVISION_CHANNELS.judgeFiring, async (_event, payload: unknown) => {
    const parsed = judgePayload.safeParse(payload)
    if (!parsed.success) return { ok: false }
    source.judgeFiring?.(parsed.data.firingId, parsed.data.judgement)
    return { ok: true }
  })

  // Answering a permission request without opening the session (FR-023). The
  // decision travels to the main process, which owns the permission bridge —
  // the renderer never decides on the agent's behalf.
  handleChannel(SUPERVISION_CHANNELS.resolvePermission, async (_event, payload: unknown) => {
    const parsed = permissionPayload.safeParse(payload)
    if (!parsed.success) return { ok: false }
    source.resolvePermission?.(
      parsed.data.sessionId,
      parsed.data.requestId,
      parsed.data.decision,
      parsed.data.answer
    )
    return { ok: true }
  })

  handleChannel(SUPERVISION_CHANNELS.listFeed, async () => source.listFeed?.() ?? [])

  handleChannel(
    SUPERVISION_CHANNELS.listFirings,
    async () =>
      source.listFirings?.() ?? {
        firings: [],
        precision: { total: 0, judged: 0, incorrect: 0, incorrectRate: null },
      }
  )

  handleChannel(SUPERVISION_CHANNELS.listReview, async () => source.listReview?.() ?? [])

  handleChannel(
    SUPERVISION_CHANNELS.listUnattendedMerges,
    async () => source.listUnattendedMerges?.() ?? []
  )

  handleChannel(
    SUPERVISION_CHANNELS.listWorkItems,
    async () =>
      source.listWorkItems?.() ?? { items: [], unreadable: [], conflicts: [], canAct: false }
  )

  handleChannel(SUPERVISION_CHANNELS.getReviewDetail, async (_event, payload: unknown) => {
    const parsed = sessionPayload.safeParse(payload)
    return parsed.success ? (source.getReviewDetail?.(parsed.data.sessionId) ?? null) : null
  })

  handleChannel(SUPERVISION_CHANNELS.decideHunk, async (_event, payload: unknown) => {
    const parsed = hunkPayload.safeParse(payload)
    if (!parsed.success) return { ok: false }
    source.decideHunk?.(parsed.data.sessionId, parsed.data.hunkId, parsed.data.decision)
    return { ok: true }
  })

  handleChannel(SUPERVISION_CHANNELS.advanceReview, async (_event, payload: unknown) => {
    const parsed = sessionPayload.safeParse(payload)
    if (!parsed.success) return { ok: false }
    source.advanceReview?.(parsed.data.sessionId)
    return { ok: true }
  })

  handleChannel(SUPERVISION_CHANNELS.getLanes, async (_event, payload: unknown) => {
    const parsed = workItemPayload.safeParse(payload)
    return parsed.success
      ? (source.getLanes?.(parsed.data.workItemId) ?? {
          lanes: [],
          mergedOrds: [],
          staleOrds: [],
          blockedReasons: {},
        })
      : { lanes: [], mergedOrds: [], staleOrds: [], blockedReasons: {} }
  })

  handleChannel(SUPERVISION_CHANNELS.mergeLane, async (_event, payload: unknown) => {
    const parsed = lanePayload.safeParse(payload)
    if (!parsed.success) return { ok: false, reason: 'invalid request' }
    return (
      (await source.mergeLane?.(parsed.data.workItemId, parsed.data.ord)) ?? {
        ok: false,
        reason: 'merging is unavailable',
      }
    )
  })

  handleChannel(SUPERVISION_CHANNELS.getProvisioning, async (_event, payload: unknown) => {
    const parsed = sessionPayload.safeParse(payload)
    return parsed.success ? (source.getProvisioning?.(parsed.data.sessionId) ?? null) : null
  })

  handleChannel(SUPERVISION_CHANNELS.getSinceLastLooked, async (_event, payload: unknown) => {
    const parsed = sessionPayload.safeParse(payload)
    return parsed.success
      ? (source.getSinceLastLooked?.(parsed.data.sessionId) ?? {
          lastViewedAt: null,
          entries: [],
        })
      : { lastViewedAt: null, entries: [] }
  })

  handleChannel(
    SUPERVISION_CHANNELS.precheckBackpressure,
    async () => source.precheckBackpressure?.() ?? null
  )

  handleChannel(SUPERVISION_CHANNELS.entityIndex, async () => source.entityIndex?.() ?? [])

  handleChannel(SUPERVISION_CHANNELS.intake, async (_event, payload: unknown) => {
    const parsed = intakePayload.safeParse(payload)
    if (!parsed.success) return { ok: false, reason: 'invalid request' }
    return source.intake?.(parsed.data) ?? { ok: false, reason: 'intake is unavailable' }
  })

  handleChannel(SUPERVISION_CHANNELS.removeFeedEntry, async (_event, payload: unknown) => {
    const parsed = intakeIdPayload.safeParse(payload)
    if (!parsed.success) return { ok: false }
    source.removeFeedEntry?.(parsed.data.id)
    return { ok: true }
  })

  handleChannel(SUPERVISION_CHANNELS.removeFiring, async (_event, payload: unknown) => {
    const parsed = intakeIdPayload.safeParse(payload)
    if (!parsed.success) return { ok: false }
    source.removeFiring?.(parsed.data.id)
    return { ok: true }
  })

  handleChannel(SUPERVISION_CHANNELS.listIntake, async () => source.listIntake?.() ?? [])

  handleChannel(SUPERVISION_CHANNELS.removeIntake, async (_event, payload: unknown) => {
    const parsed = intakeIdPayload.safeParse(payload)
    if (!parsed.success) return { ok: false }
    source.removeIntake?.(parsed.data.id)
    return { ok: true }
  })

  handleChannel(
    SUPERVISION_CHANNELS.pullFromLinear,
    async () =>
      (await source.pullFromLinear?.()) ?? {
        ok: false,
        added: 0,
        reason: 'pulling from Linear is unavailable',
      }
  )

  handleChannel(SUPERVISION_CHANNELS.assign, async (_event, payload: unknown) => {
    const parsed = assignPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, reason: 'invalid request' }
    return (await source.assign?.(parsed.data)) ?? { ok: false, reason: 'assigning is unavailable' }
  })

  handleChannel(SUPERVISION_CHANNELS.getDigest, async (_event, payload: unknown) => {
    const parsed = digestPayload.safeParse(payload)
    if (!parsed.success) return null
    return source.getDigest?.(parsed.data.windowMs) ?? null
  })

  handleChannel(SUPERVISION_CHANNELS.interruptSession, async (_event, payload: unknown) => {
    const parsed = interruptPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, reason: 'invalid request' }
    return (
      (await source.interruptSession?.(parsed.data.sessionId, parsed.data.redirect)) ?? {
        ok: false,
        reason: 'interrupting is unavailable',
      }
    )
  })

  handleChannel(SUPERVISION_CHANNELS.discardSession, async (_event, payload: unknown) => {
    const parsed = sessionPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, reason: 'invalid request' }
    return (
      (await source.discardSession?.(parsed.data.sessionId)) ?? {
        ok: false,
        reason: 'discarding is unavailable',
      }
    )
  })

  handleChannel(SUPERVISION_CHANNELS.stopSession, async (_event, payload: unknown) => {
    const parsed = stopPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, reason: 'invalid request' }
    return (
      (await source.stopSession?.(parsed.data.sessionId, parsed.data.reason)) ?? {
        ok: false,
        reason: 'stopping is unavailable',
      }
    )
  })

  handleChannel(SUPERVISION_CHANNELS.listReclaimable, async () => source.listReclaimable?.() ?? [])

  handleChannel(SUPERVISION_CHANNELS.reclaimWorktree, async (_event, payload: unknown) => {
    const parsed = reclaimPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, reason: 'invalid request' }
    return (
      (await source.reclaimWorktree?.(parsed.data.path)) ?? {
        ok: false,
        reason: 'reclaiming is unavailable',
      }
    )
  })

  handleChannel(SUPERVISION_CHANNELS.producerAction, async (_event, payload: unknown) => {
    const parsed = producerActionPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, reason: 'invalid request' }
    return (
      (await source.producerAction?.(
        parsed.data.workItemId,
        parsed.data.action,
        parsed.data.args
      )) ?? {
        ok: false,
        reason: 'no producer is registered',
      }
    )
  })

  handleChannel(SUPERVISION_CHANNELS.replyToSession, async (_event, payload: unknown) => {
    const parsed = replyPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, reason: 'invalid reply' }
    return (
      (await source.replyToSession?.(parsed.data.sessionId, parsed.data.message)) ?? {
        ok: false,
        reason: 'replying is unavailable',
      }
    )
  })
}
