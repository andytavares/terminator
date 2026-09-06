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

/**
 * The half of context an agent may propose.
 *
 * What Foundry *measured* — the repositories, the probed toolchain, the house
 * documents it found — is not the agent's to overwrite. What the agent *read*
 * is: the entry points a change would touch, the conventions the surrounding
 * code keeps, and the prior art it found. Those are findings, and nothing else
 * fills them: Scout runs after agreement, which is too late to inform one.
 */
const FindingsSchema = z
  .object({
    entryPoints: z.array(z.string()).optional(),
    conventions: z.array(z.string()).optional(),
    priorArt: z.array(z.string()).optional(),
  })
  .strict()

export const ProposalSchema = z
  .object({
    intent: orderShape.intent.optional(),
    findings: FindingsSchema.optional(),
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
 * `status`, `id`, `source`, `provenance` and `redTeam` are not reachable from
 * here at all. The first two would let an agent agree its own work, and
 * `redTeam` is written by a reader who is not allowed to fix what it finds.
 * Of `context`, only the findings half is reachable — see `FindingsSchema`.
 */
export function applyProposal(order: WorkOrder, proposal: Proposal, at: string): WorkOrder {
  const next: WorkOrder = {
    ...order,
    intent: proposal.intent ?? order.intent,
    // Findings only. `repos`, `toolchain` and `houseDocs` are what Foundry
    // measured, and an agent that could rewrite them could tell the ladder a
    // command exists that does not.
    context: {
      ...order.context,
      entryPoints: proposal.findings?.entryPoints ?? order.context.entryPoints,
      conventions: proposal.findings?.conventions ?? order.context.conventions,
      priorArt: proposal.findings?.priorArt ?? order.context.priorArt,
    },
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
