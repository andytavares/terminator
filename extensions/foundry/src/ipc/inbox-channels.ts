import { z } from 'zod'
import { decide, applyDefault, isOverdue } from '../gates/rules.js'
import { rankInbox, summariseInbox } from '../gates/rank.js'
import { isLive, silencedRules } from '../gates/autonomy.js'
import type { Autonomy } from '../gates/autonomy.js'
import type { Gate } from '../gates/rules.js'
import type { GateStore } from '../gates/store.js'
import type { OrderStore } from '../order/store.js'

// The one surface the operator is required to visit.
//
// Everything here is ranked by how much work the decision unblocks, and every
// row names the rule that raised it. Nothing reaches this list that a rule did
// not produce, which is what makes "nothing needs you" a state worth trusting.

const DecidePayload = z.object({
  gateId: z.string(),
  option: z.string(),
  note: z.string().optional(),
})

export interface InboxDeps {
  readonly gates: GateStore
  readonly orders: OrderStore
  readonly autonomy: () => Autonomy
  readonly now: () => string
  /** Appends the decision to the order's own ledger. */
  readonly record: (
    orderId: string,
    action: string,
    subject: string,
    reason: string
  ) => Promise<void>
  /**
   * Carry out what the decision means — mark a pull request ready, resume a
   * held run.
   *
   * A seam rather than a call so this file keeps knowing nothing about shells
   * or pull requests. Its failure is reported and never unmakes the decision:
   * the decision was the operator's and is already in the ledger; `gh` being
   * unreachable is a separate problem with a separate fix.
   */
  readonly act?: (gate: Gate, option: string) => Promise<void>
}

export interface InboxChannels {
  list(): Promise<unknown>
  decide(payload: unknown): Promise<unknown>
}

export function createInboxChannels(deps: InboxDeps): InboxChannels {
  async function list(): Promise<unknown> {
    const autonomy = deps.autonomy()
    const all = await deps.gates.list()
    const now = deps.now()

    // A gate whose rule this setting silences is not shown, and a gate whose
    // deadline has passed takes its stated default rather than sitting there
    // for ever pretending to wait.
    const live = all.filter((gate) => isLive(gate.rule, autonomy))
    const settled = live.map((gate) => (isOverdue(gate, now) ? applyDefault(gate, now) : gate))

    for (const gate of settled) {
      const original = live.find((g) => g.id === gate.id)
      if (original?.decision === null && gate.decision !== null) {
        await deps.gates.save(gate)
        await deps.record(
          gate.orderId,
          'gate.default',
          gate.id,
          `${gate.rule}: no answer by the deadline`
        )
        // Acted on, not only recorded. A default that changes the row and
        // leaves the run halted is not a default — the line waits for ever on
        // a decision that has already been taken, and the record says it was
        // taken. Same seam the operator's own decision goes through, and the
        // same treatment for a failure: written down, never thrown at a caller
        // that was only asking what is waiting.
        try {
          await deps.act?.(gate, gate.decision.option)
        } catch (error) {
          await deps.record(gate.orderId, 'gate.action_failed', gate.id, (error as Error).message)
        }
      }
    }

    const orders = await deps.orders.list()
    return {
      gates: rankInbox(settled),
      // What this setting is *not* asking about. "Nothing needs you" means
      // something different at each rung of the dial, and an operator who
      // cannot see which rules are silenced cannot tell a quiet factory from
      // a deaf one.
      autonomy,
      silenced: silencedRules(autonomy),
      summary: {
        ...summariseInbox(settled),
        building: orders.filter((o) => o.status === 'running').length,
        converging: orders.filter((o) => o.status === 'draft').length,
      },
    }
  }

  async function decideGate(raw: unknown): Promise<unknown> {
    const parsed = DecidePayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }

    const gate = await deps.gates.get(parsed.data.gateId)
    if (gate === null) return { error: `No gate ${parsed.data.gateId}.` }
    if (gate.decision !== null) {
      return { error: `Gate ${gate.id} was already decided (${gate.decision.option}).` }
    }

    let decided
    try {
      decided = decide(gate, parsed.data.option, parsed.data.note ?? '', deps.now())
    } catch (error) {
      return { error: (error as Error).message }
    }

    // Recorded before it is acted on: a decision that changed the world but
    // left no trace is the one nobody can explain afterwards.
    await deps.record(
      gate.orderId,
      'gate.decided',
      gate.id,
      `${gate.rule} -> ${parsed.data.option}${parsed.data.note === undefined ? '' : `: ${parsed.data.note}`}`
    )
    await deps.gates.save(decided)

    try {
      await deps.act?.(decided, parsed.data.option)
    } catch (error) {
      const reason = (error as Error).message
      await deps.record(gate.orderId, 'gate.action_failed', gate.id, reason)
      return { ok: true, gate: decided, actionError: reason }
    }
    return { ok: true, gate: decided }
  }

  return { list, decide: decideGate }
}
