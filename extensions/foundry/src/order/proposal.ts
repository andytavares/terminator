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
export const FindingsSchema = z
  .object({
    entryPoints: z.array(z.string()).optional(),
    conventions: z.array(z.string()).optional(),
    priorArt: z.array(z.string()).optional(),
  })
  .strict()

// The object-valued fields merge key by key, because an amending turn is told
// to send only what it changed: `plan.units` alone is an edit, not a plan with
// no lanes.
const ProposalSchema = z
  .object({
    intent: orderShape.intent.partial().optional(),
    findings: FindingsSchema.optional(),
    acceptance: orderShape.acceptance.optional(),
    risk: orderShape.risk.partial().optional(),
    // Read and never applied. Refusing it would throw away the whole turn over
    // a field an architect that saw budgets in a rendered order may still write.
    budgets: orderShape.budgets.optional(),
    plan: orderShape.plan.partial().optional(),
    assumptions: orderShape.assumptions.optional(),
    openQuestions: orderShape.openQuestions.optional(),
    // Lists merge by id, so dropping a criterion or a unit has to be said by id.
    remove: z
      .object({ acceptance: z.array(z.string()).optional(), units: z.array(z.string()).optional() })
      .strict()
      .optional(),
    // Findings the architect is sure do not apply. Only low and medium ones are
    // honoured, and only at the confidence bar (spec 062); `redTeam` itself
    // stays out of reach.
    dismissFindings: z
      .array(
        z
          .object({ id: z.string(), reason: z.string(), confidence: z.number().min(0).max(1) })
          .strict()
      )
      .optional(),
    // Findings the architect changed the order to clear, and how. A reviewer's
    // finding is judgement, not re-derivable like a structural one, so without
    // this a redraft that answered it left it open and looking untouched.
    resolveFindings: z
      .array(z.object({ id: z.string(), how: z.string().trim().min(1) }).strict())
      .optional(),
    /** What the agent changed and why, for the ledger. */
    note: z.string().default(''),
  })
  .strict()

export type Proposal = z.infer<typeof ProposalSchema>

/** The proposal's JSON Schema, for Claude to hold its answer to. */
export function proposalJsonSchema(): object {
  return z.toJSONSchema(ProposalSchema, { target: 'draft-7', io: 'input' })
}

const REFUSED = 'The proposal was refused: '

// The parts of a proposal an operator can find on the order, by the name the
// Forge shows them under. Any other path segment is a field inside one of them.
const PART_NAMES: Record<string, string> = {
  acceptance: 'acceptance criterion',
  units: 'unit',
  lanes: 'lane',
  verify: 'check',
  assumptions: 'assumption',
  openQuestions: 'question',
  triggers: 'risk trigger',
  evidence: 'evidence',
}

/**
 * Where a refused proposal went wrong, in the Forge's own words, or null when
 * the reason is not a schema refusal. `plan.units.0.verify.1` reads "unit 1,
 * check 2".
 */
export function refusedParts(reason: string): string[] | null {
  if (!reason.startsWith(REFUSED)) return null
  const parts = reason
    .slice(REFUSED.length)
    .split('; ')
    .map((issue) => {
      const segments = issue.slice(0, issue.indexOf(':')).split('.')
      const named = segments.flatMap((segment, i) => {
        const name = PART_NAMES[segment]
        if (name === undefined) return []
        const index = Number(segments[i + 1])
        return [Number.isInteger(index) ? `${name} ${index + 1}` : name]
      })
      return named.length === 0 ? 'the plan' : named.join(', ')
    })
  return [...new Set(parts)]
}

export class ProposalRejected extends Error {
  readonly code = 'PROPOSAL_REJECTED'
  constructor(reason: string) {
    super(`${REFUSED}${reason}`)
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

// Findings only: `repos`, `toolchain` and `houseDocs` are Foundry's measurements, and
// an agent rewriting them could tell the ladder a command exists that does not.
function contextWithFindings(
  context: WorkOrder['context'],
  findings: Proposal['findings']
): WorkOrder['context'] {
  return {
    ...context,
    entryPoints: findings?.entryPoints ?? context.entryPoints,
    conventions: findings?.conventions ?? context.conventions,
    priorArt: findings?.priorArt ?? context.priorArt,
  }
}

// A sent item replaces the one with its id, a new id is added, and the rest stay: the schema
// has no way to say "remove", so a partial list must not drop what it leaves out.
function mergedById<T extends { id: string }>(
  current: readonly T[],
  sent: readonly T[],
  removed: readonly string[] = []
): T[] {
  const replaced = current.map((item) => sent.find((s) => s.id === item.id) ?? item)
  const merged = [...replaced, ...sent.filter((s) => !current.some((item) => item.id === s.id))]
  return merged.filter((item) => !removed.includes(item.id))
}

// The proposal's plan over the order's, keeping a lane branch the ticket fixed when
// the proposal leaves it blank.
function mergedPlan(
  plan: WorkOrder['plan'],
  proposed: Proposal['plan'],
  removedUnits: readonly string[]
): WorkOrder['plan'] {
  const merged = {
    ...plan,
    ...proposed,
    units: mergedById(plan.units, proposed?.units ?? [], removedUnits),
  }
  if (proposed?.lanes === undefined) return merged
  const lanes = proposed.lanes.map((lane) => {
    const kept = plan.lanes.find((l) => l.ord === lane.ord)?.branch ?? ''
    return lane.branch.trim() === '' && kept !== '' ? { ...lane, branch: kept } : lane
  })
  return { ...merged, lanes }
}

/** An assumption the operator struck stays struck whatever the proposal says. */
function keptStruck(
  current: WorkOrder['assumptions'],
  proposed: WorkOrder['assumptions']
): WorkOrder['assumptions'] {
  return proposed.map((assumption) => {
    const existing = current.find((a) => a.id === assumption.id)
    return existing?.struck === true ? { ...assumption, struck: true } : assumption
  })
}

/** Likewise an answered question stays answered. */
function keptAnswered(
  current: WorkOrder['openQuestions'],
  proposed: WorkOrder['openQuestions']
): WorkOrder['openQuestions'] {
  return proposed.map((question) => {
    const existing = current.find((q) => q.id === question.id)
    return existing?.answer !== null && existing?.answer !== undefined
      ? { ...question, answer: existing.answer }
      : question
  })
}

/** What the architect said it did, or that it redrafted the plan when it said nothing. */
function noteOf(proposal: Proposal): string {
  const note = proposal.note.trim()
  return note === '' ? 'redrafted the plan' : note
}

/**
 * Merge a proposal into an order.
 *
 * Field by field, and only the fields the schema names. Everything the agent
 * did not propose is left exactly as it was — a proposal is an edit, not a
 * replacement, so an operator's struck assumption is not undone by the next
 * redraft.
 *
 * `status`, `id`, `source`, `provenance`, `redTeam` and `budgets` are not
 * reachable from here at all. The first two would let an agent agree its own
 * work, `redTeam` is written by a reader who is not allowed to fix what it
 * finds, and budgets are the operator's limit on the agent.
 * Of `context`, only the findings half is reachable — see `FindingsSchema`.
 */
export function applyProposal(order: WorkOrder, proposal: Proposal, at: string): WorkOrder {
  const next: WorkOrder = {
    ...order,
    intent: { ...order.intent, ...proposal.intent },
    context: contextWithFindings(order.context, proposal.findings),
    acceptance: mergedById(
      order.acceptance,
      proposal.acceptance ?? [],
      proposal.remove?.acceptance
    ),
    risk: { ...order.risk, ...proposal.risk },
    plan: mergedPlan(order.plan, proposal.plan, proposal.remove?.units ?? []),
    assumptions: keptStruck(order.assumptions, proposal.assumptions ?? order.assumptions),
    openQuestions: keptAnswered(order.openQuestions, proposal.openQuestions ?? order.openQuestions),
    provenance: {
      ...order.provenance,
      decisions: [...order.provenance.decisions, `${at} architect: ${noteOf(proposal)}`],
    },
  }

  // The merged result has to be a readable order, not merely a readable
  // proposal — the two can differ, and the next reader is the compile gate.
  return WorkOrderSchema.parse(next)
}
