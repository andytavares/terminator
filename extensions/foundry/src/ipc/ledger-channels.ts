import { z } from 'zod'
import type { LedgerEntry } from '../ledger/append.js'
import { propose } from '../ledger/curator.js'
import {
  acceptProposal,
  declineProposal,
  declinedProposals,
  declinedWithReasons,
  removeRule,
} from '../verify/rules.js'
import type { OrderStore } from '../order/store.js'
import { createGateStore } from '../gates/store.js'
import type { FoundryIndex } from '../state/foundry-index.js'
import { readRunGraph } from './run-channels.js'
import { factoryMetrics as computeFactoryMetrics } from '../factory/metrics.js'
import type { OrderRecords } from '../factory/metrics.js'
import { availableSkills } from '../recipe/resolve.js'
import type { ResolveSources } from '../recipe/resolve.js'
import { noPayload, type ChannelSpec } from '@terminator/extension-sdk'
import { foundryChannel } from './channel.js'

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

const FactoryMetricsPayload = z.object({ window: z.enum(['30d', 'all']).optional() })

const DecidePayload = z.object({
  proposalId: z.string(),
  accept: z.boolean(),
  reason: z.string().optional(),
})

const RemovePayload = z.object({ ruleId: z.string(), reason: z.string().optional() })

/** A check the operator accepted, as the surface that can remove it needs it. */
interface AcceptedRule {
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
  /**
   * Which repositories are open, for `availableSkills` — the same reason
   * `RunDeps` carries this: resolved on every call, since which `.foundry/`
   * directories are honoured changes when the operator switches workspace.
   */
  readonly sources: () => ResolveSources
  readonly now: () => string
  /** The in-memory index over this root's records; absent, every read parses the files. */
  readonly index?: (root: string) => FoundryIndex
}

export interface LedgerChannels {
  query(payload: z.infer<typeof QueryPayload>): Promise<unknown>
  proposeRules(payload: z.infer<typeof ProposePayload>): Promise<unknown>
  decideProposal(payload: z.infer<typeof DecidePayload>): Promise<unknown>
  rulesInForce(): Promise<unknown>
  removeAcceptedRule(payload: z.infer<typeof RemovePayload>): Promise<unknown>
  factoryMetrics(payload: z.infer<typeof FactoryMetricsPayload>): Promise<unknown>
}

export function createLedgerChannels(deps: LedgerDeps): LedgerChannels {
  return {
    query: (payload) => query(deps, payload),
    proposeRules: (payload) => proposeRules(deps, payload),
    decideProposal: (payload) => decideProposal(deps, payload),
    rulesInForce: () => rulesInForce(deps),
    removeAcceptedRule: (payload) => removeAcceptedRule(deps, payload),
    factoryMetrics: (payload) => factoryMetrics(deps, payload),
  }
}

/**
 * Every entry across every order, or one order's own.
 *
 * Read per order because that is how the ledger is stored — one file each,
 * which is what makes concurrent appends safe. Reading them all is a fan-out
 * rather than one big file, and a corrupt line in one order costs that order
 * rather than the record.
 */
async function entriesFor(deps: LedgerDeps, orderId: string | undefined): Promise<LedgerEntry[]> {
  const ids = orderId === undefined ? (await deps.store.list()).map((order) => order.id) : [orderId]
  const perOrder = await Promise.all(ids.map((id) => deps.store.entries(id)))
  return perOrder.flat().sort((a, b) => a.at.localeCompare(b.at))
}

async function query(deps: LedgerDeps, payload: z.infer<typeof QueryPayload>): Promise<unknown> {
  const { orderId, actor, action, since, limit } = payload

  const all = await entriesFor(deps, orderId)
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

async function proposeRules(
  deps: LedgerDeps,
  payload: z.infer<typeof ProposePayload>
): Promise<unknown> {
  const proposals = propose({
    entries: await entriesFor(deps, payload.orderId),
    existingRuleIds: deps.existingRuleIds(),
    rejectedIds: await declinedProposals(deps.dataRoot()),
  })
  return { proposals }
}

async function decideProposal(
  deps: LedgerDeps,
  payload: z.infer<typeof DecidePayload>
): Promise<unknown> {
  const { proposalId, accept, reason } = payload

  // Re-derived rather than carried in from the surface: a proposal the
  // renderer held onto could name citations the ledger no longer supports,
  // and a rule accepted on stale evidence is one nobody can justify.
  const found = propose({
    entries: await entriesFor(deps, undefined),
    rejectedIds: accept ? await declinedProposals(deps.dataRoot()) : [],
  }).find((candidate) => candidate.id === proposalId)

  if (found === undefined) {
    return { error: 'The ledger no longer supports that suggestion. Ask again for suggestions.' }
  }

  if (!accept) {
    await declineProposal(deps.dataRoot(), proposalId, {
      reason: reason ?? 'declined by the operator',
      asserts: found.asserts,
    })
    return { ok: true, accepted: false }
  }

  const file = await acceptProposal(deps.dataRoot(), found)
  return { ok: true, accepted: true, file, rule: found.id }
}

/**
 * The checks in force that the operator put there, and the ones they turned
 * down — the two halves of the record FR-081 asks for.
 */
async function rulesInForce(deps: LedgerDeps): Promise<unknown> {
  return {
    rules: deps.acceptedRules(),
    declined: await declinedWithReasons(deps.dataRoot()),
    skills: availableSkills(deps.sources()),
  }
}

/**
 * Remove an accepted check.
 *
 * Refused for anything the operator did not accept: deleting a built-in
 * would leave the tool quietly weaker than the one it ships as, and a
 * removal that silently did nothing is worse than a refusal that says why.
 */
async function removeAcceptedRule(
  deps: LedgerDeps,
  payload: z.infer<typeof RemovePayload>
): Promise<unknown> {
  const { ruleId } = payload

  const accepted = deps.acceptedRules().find((rule) => rule.id === ruleId)
  if (accepted === undefined) {
    return {
      error: 'That check is not one you accepted, so it is not yours to remove.',
    }
  }

  const reason = payload.reason ?? 'removed by the operator'
  const removed = await removeRule(deps.dataRoot(), ruleId, { reason, asserts: accepted.asserts })
  return { ok: true, removed, reason, at: deps.now() }
}

/**
 * The factory's own dashboard: every order's ledger, gates and run graph,
 * reduced by `factoryMetrics`. Nothing here is stored — it is recomputed on
 * every call from the same records the order screens already read.
 */
async function factoryMetrics(
  deps: LedgerDeps,
  payload: z.infer<typeof FactoryMetricsPayload>
): Promise<unknown> {
  const window = payload.window ?? '30d'

  const orders = await deps.store.list()
  const root = deps.dataRoot()
  const index = deps.index?.(root)
  const allGates = await createGateStore(root, index).list()
  const records: OrderRecords[] = await Promise.all(
    orders.map(async (order) => {
      const [ledger, graph] = await Promise.all([
        deps.store.entries(order.id),
        readRunGraph(root, order.id, index),
      ])
      return {
        order,
        ledger,
        gates: allGates.filter((g) => g.orderId === order.id),
        graph,
      }
    })
  )

  return computeFactoryMetrics(records, window, deps.now())
}

/** The record's channels, each with the schema its payload is parsed with (ADR 096). */
export function ledgerChannelSpecs(ledger: LedgerChannels): ChannelSpec[] {
  return [
    foundryChannel('foundry:ledger.query', QueryPayload, ledger.query),
    foundryChannel('foundry:factory.metrics', FactoryMetricsPayload, ledger.factoryMetrics),
    foundryChannel('foundry:rules.propose', ProposePayload, ledger.proposeRules),
    foundryChannel('foundry:rules.decide', DecidePayload, ledger.decideProposal),
    foundryChannel('foundry:rules.inForce', noPayload, ledger.rulesInForce),
    foundryChannel('foundry:rules.remove', RemovePayload, ledger.removeAcceptedRule),
  ]
}
