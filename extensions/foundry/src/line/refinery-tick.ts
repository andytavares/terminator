import { laterOverlapping } from './refinery.js'
import type { QueueEntry } from './refinery.js'
import type { RefineryState } from './refinery-state.js'
import type { RestackResult } from './restack.js'

// The refinery running: watch for merges, restack what queued behind, recheck
// it.
//
// Nothing here talks to git, `gh` or a gate store directly — every externality
// is a `deps` function, so the four outcomes a restack can have (nothing to
// do, rebased and re-checked, conflict, or a transient failure) are each one
// assertion against a fake, not a real checkout.

export interface RefineryCandidate {
  readonly order: { readonly id: string; readonly title: string }
  /** The pulls this order has opened. Empty means nothing to watch yet. */
  readonly pulls: readonly { readonly url: string }[]
}

export interface RefineryLane {
  readonly cwd: string
  readonly branch: string
  readonly base: string
}

export interface RefineryTickDeps {
  /** Every shipped/running order that has opened at least one pull. */
  readonly candidates: () => Promise<readonly RefineryCandidate[]>
  readonly readState: (orderId: string) => Promise<RefineryState>
  readonly writeState: (orderId: string, state: RefineryState) => Promise<void>
  /** `gh pr view <url> --json state,mergedAt,baseRefName`, already interpreted. */
  readonly viewPr: (url: string) => Promise<{ readonly merged: boolean }>
  /** Every in-flight order's queue entries, for `laterOverlapping`. */
  readonly entries: () => Promise<readonly QueueEntry[]>
  /** The lanes to restack for one overlapping order. */
  readonly lanesFor: (orderId: string) => Promise<readonly RefineryLane[]>
  readonly restack: (lane: RefineryLane) => Promise<RestackResult>
  /** One CI watch for the order's drafts, once its lanes are rebased. */
  readonly watchCi: (orderId: string) => Promise<void>
  readonly raiseConflict: (orderId: string, why: string, files: readonly string[]) => Promise<void>
  readonly record: (
    orderId: string,
    action: string,
    subject: string,
    reason: string
  ) => Promise<void>
  readonly titleOf: (orderId: string) => Promise<string>
  readonly now: () => string
}

export async function refineryTick(deps: RefineryTickDeps): Promise<void> {
  const candidates = await deps.candidates()
  const mergedIds: string[] = []

  for (const { order, pulls } of candidates) {
    if (pulls.length === 0) continue
    let state = await deps.readState(order.id)

    if (state.mergedAt === null) {
      let merged = true
      for (const pull of pulls) {
        const result = await deps.viewPr(pull.url)
        if (!result.merged) {
          merged = false
          break
        }
      }
      if (merged) {
        state = { ...state, mergedAt: deps.now() }
        await deps.writeState(order.id, state)
        await deps.record(order.id, 'refinery.merged', order.id, `${order.title} merged`)
      }
    }

    if (state.mergedAt !== null) mergedIds.push(order.id)
  }

  if (mergedIds.length === 0) return

  const entries = await deps.entries()

  for (const mergedId of mergedIds) {
    const overlapping = laterOverlapping(entries, mergedId)
    if (overlapping.length === 0) continue

    const mergedTitle = await deps.titleOf(mergedId)

    for (const { orderId, files } of overlapping) {
      const state = await deps.readState(orderId)
      if (state.restackedFor.includes(mergedId)) continue

      const lanes = await deps.lanesFor(orderId)
      let conflictFiles: readonly string[] | null = null
      let failedReason: string | null = null

      for (const lane of lanes) {
        const result = await deps.restack(lane)
        if (result.kind === 'conflict') {
          conflictFiles = result.files
          break
        }
        if (result.kind === 'failed') {
          failedReason = result.reason
          break
        }
      }

      if (conflictFiles !== null) {
        const title = await deps.titleOf(orderId)
        const why = `${title} no longer rebases onto its base after ${mergedTitle} merged`
        await deps.raiseConflict(orderId, why, conflictFiles)
        await deps.record(orderId, 'refinery.conflict', orderId, why)
        continue
      }

      if (failedReason !== null) {
        await deps.record(orderId, 'refinery.failed', orderId, failedReason)
        continue
      }

      await deps.writeState(orderId, {
        ...state,
        restackedFor: [...state.restackedFor, mergedId],
      })
      await deps.record(
        orderId,
        'refinery.rebased',
        orderId,
        `Rebased onto its base after ${mergedTitle} merged; shared files: ${files.join(', ')}.`
      )
      await deps.watchCi(orderId)
    }
  }
}
