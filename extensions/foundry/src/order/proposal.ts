import { z } from 'zod'
import { WorkOrderSchema } from './schema.js'
import type { WorkOrder } from './schema.js'

// What an agent is allowed to write into an order.
//
// Not the order itself. An intake agent that could set `status` could agree
// its own work, and one that could rewrite `provenance` could erase how the
// order got that way — so this is the shape of a *proposal*, and merging it is
// what decides which fields it may reach.
//
// Validated with the order's own field schemas rather than looser ones, so a
// proposal that would produce an unreadable order is refused at the boundary
// it came through instead of at the next read.

const orderShape = WorkOrderSchema.shape

export const ProposalSchema = z
  .object({
    intent: orderShape.intent.optional(),
    acceptance: orderShape.acceptance.optional(),
    risk: orderShape.risk.optional(),
    budgets: orderShape.budgets.optional(),
    plan: orderShape.plan.optional(),
    assumptions: orderShape.assumptions.optional(),
    openQuestions: orderShape.openQuestions.optional(),
    /** What the agent changed and why, for the ledger. */
    note: z.string().default(''),
  })
  .strict()

export type Proposal = z.infer<typeof ProposalSchema>

export class ProposalRejected extends Error {
  readonly code = 'PROPOSAL_REJECTED'
  constructor(reason: string) {
    super(`The proposal was refused: ${reason}`)
    this.name = 'ProposalRejected'
  }
}

/**
 * Read what an agent wrote, or refuse it.
 *
 * `strict()` matters here: a proposal carrying `status: "agreed"` is refused
 * outright rather than having the field quietly dropped, because an agent that
 * tried it will try again and the operator should know it did.
 */
export function parseProposal(value: unknown): Proposal {
  const parsed = ProposalSchema.safeParse(value)
  if (!parsed.success) {
    throw new ProposalRejected(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    )
  }
  return parsed.data
}

/**
 * Merge a proposal into an order.
 *
 * Field by field, and only the fields the schema names. Everything the agent
 * did not propose is left exactly as it was — a proposal is an edit, not a
 * replacement, so an operator's struck assumption is not undone by the next
 * redraft.
 *
 * `status`, `id`, `source`, `provenance`, `context` and `redTeam` are not
 * reachable from here at all. The first two would let an agent agree its own
 * work; `context` is Scout's, read from the repository rather than decided;
 * and `redTeam` is written by a reader who is not allowed to fix what it finds.
 */
export function applyProposal(order: WorkOrder, proposal: Proposal, at: string): WorkOrder {
  const next: WorkOrder = {
    ...order,
    intent: proposal.intent ?? order.intent,
    acceptance: proposal.acceptance ?? order.acceptance,
    risk: proposal.risk ?? order.risk,
    budgets: proposal.budgets ?? order.budgets,
    plan: proposal.plan ?? order.plan,
    // An operator's struck assumption stays struck: the proposal's version of
    // one already on the order does not resurrect it.
    assumptions: (proposal.assumptions ?? order.assumptions).map((assumption) => {
      const existing = order.assumptions.find((a) => a.id === assumption.id)
      return existing?.struck === true ? { ...assumption, struck: true } : assumption
    }),
    // Likewise an answered question stays answered.
    openQuestions: (proposal.openQuestions ?? order.openQuestions).map((question) => {
      const existing = order.openQuestions.find((q) => q.id === question.id)
      return existing?.answer !== null && existing?.answer !== undefined
        ? { ...question, answer: existing.answer }
        : question
    }),
    provenance: {
      ...order.provenance,
      decisions: [
        ...order.provenance.decisions,
        `${at} architect: ${proposal.note.trim() === '' ? 'redrafted the plan' : proposal.note.trim()}`,
      ],
    },
  }

  // The merged result has to be a readable order, not merely a readable
  // proposal — the two can differ, and the next reader is the compile gate.
  return WorkOrderSchema.parse(next)
}

/** Where an intake agent writes what it proposes. One path, known to both. */
export const PROPOSAL_FILE = 'proposal.json'
