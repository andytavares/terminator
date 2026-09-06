import { z } from 'zod'
import { queryEntries } from '../ledger/append.js'
import type { LedgerEntry } from '../ledger/append.js'
import { propose } from '../ledger/curator.js'
import { ledgerPath } from '../data-root.js'
import {
  acceptProposal,
  declineProposal,
  declinedProposals,
  declinedWithReasons,
  removeRule,
} from '../verify/rules.js'
import type { OrderStore } from '../order/store.js'

// The record, and what the operator can ask it for.
//
// `propose` is deliberately a channel and not a subscription: proposals appear
// when the operator presses the button and at no other time (FR-076). Nothing
// in this file is called by the append path, by a timer, or by a run.

const QueryPayload = z.object({
  orderId: z.string().optional(),
  actor: z.string().optional(),
  action: z.string().optional(),
  since: z.string().optional(),
  limit: z.number().int().min(1).max(2000).optional(),
})

const ProposePayload = z.object({ orderId: z.string().optional() })

const DecidePayload = z.object({
  proposalId: z.string(),
  accept: z.boolean(),
  reason: z.string().optional(),
})

const RemovePayload = z.object({ ruleId: z.string(), reason: z.string().optional() })

/** A check the operator accepted, as the surface that can remove it needs it. */
export interface AcceptedRule {
  readonly id: string
  readonly asserts: string
  readonly rung: string
  readonly origin: string
}

export interface LedgerDeps {
  readonly store: OrderStore
  /** Resolved on every call: the records location follows the open workspace. */
  readonly dataRoot: () => string
  /** Rule ids already in force, so nothing already covered is proposed. */
  readonly existingRuleIds: () => readonly string[]
  /**
   * The checks the operator accepted — those read from the records location
   * rather than shipped with the tool. Only these can be removed: a built-in
   * is not the operator's to delete, and a repository's own rule belongs to
   * that repository.
   */
  readonly acceptedRules: () => readonly AcceptedRule[]
  readonly now: () => string
}

export interface LedgerChannels {
  query(payload: unknown): Promise<unknown>
  proposeRules(payload: unknown): Promise<unknown>
  decideProposal(payload: unknown): Promise<unknown>
  rulesInForce(payload: unknown): Promise<unknown>
  removeAcceptedRule(payload: unknown): Promise<unknown>
}

export function createLedgerChannels(deps: LedgerDeps): LedgerChannels {
  /**
   * Every entry across every order, or one order's own.
   *
   * Read per order because that is how the ledger is stored — one file each,
   * which is what makes concurrent appends safe. Reading them all is a fan-out
   * rather than one big file, and a corrupt line in one order costs that order
   * rather than the record.
   */
  async function entriesFor(orderId: string | undefined): Promise<LedgerEntry[]> {
    const ids =
      orderId === undefined ? (await deps.store.list()).map((order) => order.id) : [orderId]
    const perOrder = await Promise.all(
      ids.map((id) => queryEntries(ledgerPath(deps.dataRoot(), id)))
    )
    return perOrder.flat().sort((a, b) => a.at.localeCompare(b.at))
  }

  async function query(raw: unknown): Promise<unknown> {
    const parsed = QueryPayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }
    const { orderId, actor, action, since, limit } = parsed.data

    const all = await entriesFor(orderId)
    const matched = all.filter((entry) => {
      if (actor !== undefined && actor !== '' && entry.actor !== actor) return false
      if (action !== undefined && action !== '' && entry.action !== action) return false
      if (since !== undefined && since !== '' && entry.at < since) return false
      return true
    })

    return {
      // Newest first: the record is read from the top, unlike the file, which
      // is written from the bottom.
      entries: [...(limit === undefined ? matched : matched.slice(-limit))].reverse(),
      total: matched.length,
      // The values that actually occur, so a filter never offers a choice that
      // matches nothing.
      actors: [...new Set(all.map((entry) => entry.actor))].sort(),
      actions: [...new Set(all.map((entry) => entry.action))].sort(),
      orders: [...new Set(all.map((entry) => entry.orderId))].sort(),
    }
  }

  async function proposeRules(raw: unknown): Promise<unknown> {
    const parsed = ProposePayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }

    const proposals = propose({
      entries: await entriesFor(parsed.data.orderId),
      existingRuleIds: deps.existingRuleIds(),
      rejectedIds: await declinedProposals(deps.dataRoot()),
    })
    return { proposals }
  }

  async function decideProposal(raw: unknown): Promise<unknown> {
    const parsed = DecidePayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }
    const { proposalId, accept, reason } = parsed.data

    // Re-derived rather than carried in from the surface: a proposal the
    // renderer held onto could name citations the ledger no longer supports,
    // and a rule accepted on stale evidence is one nobody can justify.
    const found = propose({
      entries: await entriesFor(undefined),
      rejectedIds: accept ? await declinedProposals(deps.dataRoot()) : [],
    }).find((candidate) => candidate.id === proposalId)

    if (found === undefined) {
      return { error: `The ledger no longer supports ${proposalId}. Ask again for proposals.` }
    }

    if (!accept) {
      await declineProposal(deps.dataRoot(), proposalId, reason ?? 'declined by the operator')
      return { ok: true, accepted: false }
    }

    const file = await acceptProposal(deps.dataRoot(), found)
    return { ok: true, accepted: true, file, rule: found.id }
  }

  /**
   * The checks in force that the operator put there, and the ones they turned
   * down — the two halves of the record FR-081 asks for.
   */
  async function rulesInForce(): Promise<unknown> {
    return {
      rules: deps.acceptedRules(),
      declined: await declinedWithReasons(deps.dataRoot()),
    }
  }

  /**
   * Remove an accepted check.
   *
   * Refused for anything the operator did not accept: deleting a built-in
   * would leave the tool quietly weaker than the one it ships as, and a
   * removal that silently did nothing is worse than a refusal that says why.
   */
  async function removeAcceptedRule(raw: unknown): Promise<unknown> {
    const parsed = RemovePayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }
    const { ruleId } = parsed.data

    const accepted = deps.acceptedRules().find((rule) => rule.id === ruleId)
    if (accepted === undefined) {
      return {
        error: `${ruleId} is not one of the checks you accepted, so it is not yours to remove.`,
      }
    }

    const reason = parsed.data.reason ?? 'removed by the operator'
    const removed = await removeRule(deps.dataRoot(), ruleId, reason)
    return { ok: true, removed, reason, at: deps.now() }
  }

  return { query, proposeRules, decideProposal, rulesInForce, removeAcceptedRule }
}
