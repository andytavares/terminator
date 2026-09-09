import * as path from 'node:path'
import { z } from 'zod'
import { CHECK_NAMES } from '../verify/toolchain-probe.js'

// The work order: the only object that crosses from the Forge to the Line.
//
// Validated on every read because it is written by an agent and edited through
// a surface, so nothing about it is trustworthy by construction.
//
// This file answers *shape*, not *completeness*. An order with no criteria, no
// units, or a unit that satisfies nothing is well-formed and incomplete — the
// six compile checks are what refuse to hand it off (FR-010). Putting
// completeness here would make an empty draft unrepresentable, and a draft has
// to exist before the Architect has filled it in.

export const SCHEMA_VERSION = 1

export class SchemaVersionTooNewError extends Error {
  readonly code = 'ORDER_SCHEMA_TOO_NEW'
  constructor(found: number, known: number) {
    super(
      `This work order declares schema version ${found}; this build knows version ${known}. Refusing it rather than reading the parts it recognises — a half-understood agreement is worse than an unreadable one.`
    )
    this.name = 'SchemaVersionTooNewError'
  }
}

const nonEmpty = z.string().min(1)

export const TransitionIntentSchema = z.enum(['started', 'in_review', 'done'])
export const WriteBackSchema = z.enum(['summary_comment', 'status', 'pr_link'])

const SourceSchema = z.object({
  kind: z.enum(['typed', 'tracker', 'failing_run', 'review_comment', 'deferred']),
  tracker: z.enum(['linear', 'jira']).nullable().default(null),
  key: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
})

const IntentSchema = z.object({
  problem: z.string(),
  outcome: z.string(),
  // Required even when empty: an absent exclusions list and an empty one mean
  // different things, and only one of them is a decision.
  nonGoals: z.array(z.string()),
})

const ProbedCommandSchema = z.object({
  command: nonEmpty,
  source: z.enum(['package.json', 'config', 'makefile', 'ci']),
})

const ToolchainSchema = z.object(
  Object.fromEntries(CHECK_NAMES.map((name) => [name, ProbedCommandSchema.nullable()])) as Record<
    (typeof CHECK_NAMES)[number],
    z.ZodNullable<typeof ProbedCommandSchema>
  >
)

const RepoRefSchema = z.object({
  name: nonEmpty,
  path: nonEmpty,
  lane: z.number().int().min(1),
  baseBranch: z.string(),
  headBranch: z.string(),
})

const ContextSchema = z.object({
  repos: z.array(RepoRefSchema).min(1),
  toolchain: ToolchainSchema,
  entryPoints: z.array(z.string()).default([]),
  priorArt: z.array(z.string()).default([]),
  conventions: z.array(z.string()).default([]),
  houseDocs: z.array(z.string()).default([]),
})

const EvidenceKindSchema = z.enum(['exit_code', 'stdout', 'report_file', 'screenshot', 'diff'])

const VerifySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('test'), command: nonEmpty, assert: nonEmpty }),
  z.object({ kind: z.literal('command'), command: nonEmpty, assert: nonEmpty }),
  z.object({
    kind: z.literal('judge'),
    rubric: nonEmpty,
    evidence: z.array(EvidenceKindSchema).min(1),
  }),
  z.object({ kind: z.literal('artifact'), path: nonEmpty, assert: nonEmpty }),
  z.object({ kind: z.literal('screenshot'), target: nonEmpty }),
])

const AcceptanceSchema = z.object({
  id: nonEmpty,
  statement: z.string(),
  priority: z.enum(['P0', 'P1', 'P2']),
  verify: VerifySchema,
  // The one escape from "every criterion must be provable", and it costs a
  // written reason. An accepted-unverifiable with no reason is a shrug.
  unverifiable: z
    .object({ accepted: z.literal(true), reason: nonEmpty })
    .nullable()
    .default(null),
})

/**
 * The closed set a risk trigger may be.
 *
 * Exported so the architect's own output contract can name them. An enum an
 * agent is never shown is an enum it writes prose into: measured on
 * WO-0907-3c1, where the contract spelled out `risk.grade`'s four values and
 * not these nine, the architect wrote five sentences here and the whole
 * proposal — nine minutes of deep-tier work — was refused on `Invalid enum
 * value`.
 */
export const RISK_TRIGGERS = [
  'authentication',
  'payments',
  'secrets',
  'migration',
  'public_interface',
  'new_dependency',
  'network_egress',
  'outside_blast_radius',
  'critical_path',
] as const

const TriggerSchema = z.enum(RISK_TRIGGERS)

const RiskSchema = z.object({
  grade: z.enum(['P0', 'P1', 'P2', 'P3']),
  triggers: z.array(TriggerSchema).default([]),
  blastRadius: z.array(z.string()).default([]),
  // Operator-declared, per repository. Never inferred.
  criticalPaths: z.array(z.string()).default([]),
})

const BudgetsSchema = z.object({
  agents: z.number().int().min(1),
  wallClockMinutes: z.number().int().min(1),
  filesTouched: z.number().int().min(1),
  // Deliberately nullable: a token ceiling that fires part-way through leaves a
  // half-finished change, which is worse than an expensive one.
  tokens: z.number().int().min(1).nullable().default(null),
})

const UnitSchema = z.object({
  id: nonEmpty,
  title: z.string(),
  role: nonEmpty,
  lane: z.number().int().min(1),
  dependsOn: z.array(z.string()).default([]),
  satisfies: z.array(z.string()).default([]),
  touches: z.array(z.string()).default([]),
  verify: z.array(VerifySchema).default([]),
})

const LaneSchema = z.object({
  ord: z.number().int().min(1),
  repo: nonEmpty,
  branch: z.string(),
  role: z.enum(['producer', 'consumer']).nullable().default(null),
  // Normalised so every rule downstream can read them without guarding:
  // an absent array and an empty one mean the same thing.
  blocks: z.array(z.number().int()).default([]),
  blockedBy: z.array(z.number().int()).default([]),
})

const PlanSchema = z.object({
  units: z.array(UnitSchema),
  lanes: z.array(LaneSchema).min(1),
  sharedFiles: z.array(z.string()).default([]),
})

const AssumptionSchema = z.object({
  id: nonEmpty,
  text: z.string(),
  struck: z.boolean().default(false),
  affects: z.array(z.string()).default([]),
})

const OpenQuestionSchema = z.object({
  id: nonEmpty,
  text: z.string(),
  why: z.string().default(''),
  options: z.array(z.string()).default([]),
  recommended: z.number().int().nullable().default(null),
  answer: z.string().nullable().default(null),
  rank: z.number().default(0),
})

const RedTeamFindingSchema = z
  .object({
    id: nonEmpty,
    severity: z.enum(['low', 'medium', 'high']).default('medium'),
    text: z.string(),
    status: z.enum(['open', 'resolved', 'accepted']).default('open'),
    reason: z.string().default(''),
  })
  .refine((f) => f.status !== 'accepted' || f.reason.trim() !== '', {
    message: 'An accepted red-team finding must carry the reason it was accepted.',
  })

/**
 * Which of the tracker's own states each intent means, when the operator has
 * said (FR-060).
 *
 * Stored here rather than in core: "in review" is not a fact about a tracker,
 * it is a decision about which of their states means that, and it is the
 * operator's decision. Null is "let the tracker resolve it", which is the
 * right default and not the same as an empty string.
 */
const StateMappingSchema = z.object({
  started: z.string().nullable().default(null),
  in_review: z.string().nullable().default(null),
  done: z.string().nullable().default(null),
})

const ProvenanceSchema = z.object({
  forgeSession: z.string().nullable().default(null),
  decisions: z.array(z.string()).default([]),
  amendments: z.array(z.string()).default([]),
})

export const WorkOrderSchema = z.object({
  schemaVersion: z.number().int(),
  id: nonEmpty,
  title: z.string(),
  status: z.enum(['draft', 'agreed', 'running', 'shipped', 'cancelled']),
  source: SourceSchema,
  writeBack: z.array(WriteBackSchema).default([]),
  stateMapping: StateMappingSchema.default({ started: null, in_review: null, done: null }),
  recipe: z.string().nullable().default(null),
  recipeOverriddenBy: z.literal('operator').nullable().default(null),
  intent: IntentSchema,
  context: ContextSchema,
  acceptance: z.array(AcceptanceSchema),
  risk: RiskSchema,
  budgets: BudgetsSchema,
  plan: PlanSchema,
  assumptions: z.array(AssumptionSchema).default([]),
  openQuestions: z.array(OpenQuestionSchema).default([]),
  redTeam: z.array(RedTeamFindingSchema).default([]),
  provenance: ProvenanceSchema,
  createdAt: nonEmpty,
  agreedAt: z.string().nullable().default(null),
})

export type WorkOrder = z.infer<typeof WorkOrderSchema>
export type AcceptanceCriterion = z.infer<typeof AcceptanceSchema>
export type PlanUnit = z.infer<typeof UnitSchema>
export type Lane = z.infer<typeof LaneSchema>
export type Verify = z.infer<typeof VerifySchema>
export type OrderSource = z.infer<typeof SourceSchema>
export type Budgets = z.infer<typeof BudgetsSchema>
export type RiskAssessment = z.infer<typeof RiskSchema>
export type Assumption = z.infer<typeof AssumptionSchema>
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>
export type RedTeamFinding = z.infer<typeof RedTeamFindingSchema>
export type WriteBack = z.infer<typeof WriteBackSchema>
export type StateMapping = z.infer<typeof StateMappingSchema>
export type TransitionIntent = z.infer<typeof TransitionIntentSchema>

/**
 * Read an order, or refuse it.
 *
 * The version check runs before the shape check on purpose: a newer order is
 * refused outright rather than read for the fields this build happens to
 * recognise, because the failure mode of a partial read is work executed
 * against terms nobody agreed to.
 */
export function parseWorkOrder(value: unknown): WorkOrder {
  if (typeof value === 'object' && value !== null) {
    const declared = (value as { schemaVersion?: unknown }).schemaVersion
    if (typeof declared === 'number' && declared > SCHEMA_VERSION) {
      throw new SchemaVersionTooNewError(declared, SCHEMA_VERSION)
    }
  }
  return WorkOrderSchema.parse(value)
}

export interface DraftOrderInput {
  readonly id: string
  readonly title: string
  readonly source: {
    kind: OrderSource['kind']
    tracker: OrderSource['tracker']
    key: string | null
    url: string | null
  }
  readonly repoPaths: readonly string[]
  readonly now: string
  readonly baseBranch?: string
}

/**
 * A valid, empty draft.
 *
 * The Forge always has a real document to show, from the first turn — never a
 * progress bar over nothing (FR-003). One lane per repository from the start,
 * because a two-repository order has to be expressible before anyone plans it.
 */
export function draftOrder(input: DraftOrderInput): WorkOrder {
  const base = input.baseBranch ?? 'main'
  const repos = input.repoPaths.map((repoPath, index) => ({
    name: path.basename(repoPath),
    path: repoPath,
    lane: index + 1,
    baseBranch: base,
    headBranch: '',
  }))

  return WorkOrderSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    title: input.title,
    status: 'draft',
    source: input.source,
    writeBack: [],
    stateMapping: { started: null, in_review: null, done: null },
    recipe: null,
    recipeOverriddenBy: null,
    intent: { problem: '', outcome: '', nonGoals: [] },
    context: {
      repos,
      toolchain: Object.fromEntries(CHECK_NAMES.map((name) => [name, null])),
      entryPoints: [],
      priorArt: [],
      conventions: [],
      houseDocs: [],
    },
    acceptance: [],
    risk: { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] },
    budgets: { agents: 3, wallClockMinutes: 45, filesTouched: 25, tokens: null },
    plan: {
      units: [],
      lanes: repos.map((repo) => ({
        ord: repo.lane,
        repo: repo.name,
        branch: '',
        role: null,
        blocks: [],
        blockedBy: [],
      })),
      sharedFiles: [],
    },
    assumptions: [],
    openQuestions: [],
    redTeam: [],
    provenance: { forgeSession: null, decisions: [], amendments: [] },
    createdAt: input.now,
    agreedAt: null,
  })
}
