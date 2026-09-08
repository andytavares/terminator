import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { amendOrder } from '../order/amend.js'
import { WorkOrderSchema } from '../order/schema.js'
import type { WorkOrder } from '../order/schema.js'
import type { Role } from '../recipe/parse.js'

// How a rung hands back what it found.
//
// Four of the standard shape's nine steps are read-only roles whose entire
// product is a document — the scout's reconnaissance, the architect's plan,
// the red team's attack, the inspector's findings. The Line ran all four and
// kept none of them: the brief named no destination, nothing read the result
// past its exit status, and the read-only policy refused every channel the
// agents invented for themselves. Watched on a live run: a scout produced a
// complete, correct report of the four places the application picks a text
// colour, its node passed, and not a word of it survived the terminal. On the
// same run the architect found three defects in the order and lost all three
// to `a review may not redirect output` — while the builders it had just
// contradicted were starting.
//
// This is the Forge's answer applied to the Line. Intake has always had it:
// one file at a known path, a schema the agent is shown, that exact path
// allowed through the read-only policy, and a validated read-back. The
// difference here is that a role may only write the artefacts its own
// `writes:` declares, so the channel is a permission rather than an open door.

/** What each `writes:` target is, as JSON, and where it lands on the order. */
export const COLLECTABLE = {
  /**
   * What the agent *read*. Not what Foundry measured.
   *
   * `repos`, `toolchain` and `houseDocs` stay out of reach for the reason
   * `applyProposal` gives: an agent that could rewrite them could tell the
   * ladder a command exists that does not.
   */
  context: 'findings',
  /** An attack on the order, in the shape the structural pass already uses. */
  findings: 'redTeam',
  /** Reported, never applied. See `applyRungOutput`. */
  plan: 'plan',
  acceptance: 'acceptance',
} as const

export type Collectable = keyof typeof COLLECTABLE

const orderShape = WorkOrderSchema.shape

const FindingsSchema = z
  .object({
    entryPoints: z.array(z.string()).optional(),
    conventions: z.array(z.string()).optional(),
    priorArt: z.array(z.string()).optional(),
  })
  .strict()

/**
 * One finding, as an agent writes it.
 *
 * No `id` and no `status`: the id is assigned here so a second turn cannot
 * overwrite the first turn's finding by reusing its name, and a reader that
 * could set `status: "resolved"` could close what it just raised.
 */
const AgentFindingSchema = z
  .object({
    severity: z.enum(['low', 'medium', 'high']).default('medium'),
    text: z.string().min(1),
  })
  .strict()

const SHAPES: Record<Collectable, z.ZodTypeAny> = {
  context: FindingsSchema,
  findings: z.array(AgentFindingSchema),
  plan: orderShape.plan,
  acceptance: orderShape.acceptance,
}

export interface RungOutput {
  readonly findings?: z.infer<typeof FindingsSchema>
  readonly redTeam?: readonly z.infer<typeof AgentFindingSchema>[]
  readonly plan?: WorkOrder['plan']
  readonly acceptance?: WorkOrder['acceptance']
  readonly note: string
}

export class RungOutputRejected extends Error {
  readonly code = 'RUNG_OUTPUT_REJECTED'
  constructor(reason: string) {
    super(`What the rung wrote was refused: ${reason}`)
    this.name = 'RungOutputRejected'
  }
}

export class RungIdEscapesOrderError extends Error {
  readonly code = 'RUNG_ID_ESCAPES_ORDER'
  constructor(nodeId: string) {
    super(
      `"${nodeId}" does not name a rung: a rung's output is one file directly under the order's \`rungs\` directory, and this would be somewhere else.`
    )
    this.name = 'RungIdEscapesOrderError'
  }
}

/**
 * The artefacts this channel knows how to take, from what a role declared.
 *
 * A role that writes to the checkout gets nothing here: its product is the
 * diff, which has a channel already, and a second one would be two answers to
 * the question of what the rung did. A role that declared an artefact nobody
 * has taught this module about gets nothing for it either — silently losing it
 * is exactly the defect this file exists to fix, so `collectableWrites` is
 * asserted against the built-in roles by its own test.
 */
export function collectableWrites(role: Role | null): Collectable[] {
  return (role?.writes ?? []).filter((w): w is Collectable => w in COLLECTABLE)
}

/** Where one rung writes. One path, known to the brief and to the policy. */
export function rungOutputPath(orderDirectory: string, nodeId: string): string {
  const rungs = path.resolve(orderDirectory, 'rungs')
  const target = path.resolve(rungs, `${nodeId}.json`)
  // The node id comes from a recipe, which is a file on disk Foundry did not
  // write. `orderDir` guards its own segment for the same reason.
  if (path.dirname(target) !== rungs) throw new RungIdEscapesOrderError(nodeId)
  return target
}

/** The JSON body for one artefact, as the contract shows it. */
const EXAMPLE: Record<Collectable, string[]> = {
  context: [
    '  "findings": {',
    '    "entryPoints": ["src/…"],',
    '    "conventions": ["what the surrounding code does, in a sentence"],',
    '    "priorArt": ["commit or file, and what it did"]',
    '  },',
  ],
  findings: [
    '  "redTeam": [',
    '    { "severity": "low | medium | high", "text": "what is wrong, and why it matters" }',
    '  ],',
  ],
  plan: [
    '  "plan": {',
    '    "units": [',
    '      {',
    '        "id": "U-1",',
    '        "title": "…",',
    '        "role": "builder",',
    '        "lane": 1,',
    '        "dependsOn": [],',
    '        "satisfies": ["AC-1"],',
    '        "touches": ["src/…"],',
    '        "verify": []',
    '      }',
    '    ],',
    '    "lanes": [{ "ord": 1, "repo": "…", "branch": "", "role": null, "blocks": [], "blockedBy": [] }],',
    '    "sharedFiles": []',
    '  },',
  ],
  acceptance: [
    '  "acceptance": [',
    '    {',
    '      "id": "AC-1",',
    '      "statement": "a statement that can be false",',
    '      "priority": "P0 | P1 | P2",',
    '      "verify": { "kind": "test", "command": "…", "assert": "exit_code == 0" },',
    '      "unverifiable": null',
    '    }',
    '  ],',
  ],
}

/** What a rung whose plan cannot be applied is told, so it does not retry. */
const REPORTED_NOT_APPLIED = [
  '',
  '`plan` and `acceptance` are **reported, not applied**. The run graph was',
  'compiled from the agreed order before you started, so replacing the plan now',
  'would orphan work already in flight. What you write here reaches the operator',
  'as a question about the order instead, which is what a plan you disagree with',
  'actually is. Say it in `note` as well as in the field.',
]

/**
 * What to write, and where.
 *
 * Empty for a role with nothing to hand back — a contract offering no keys is
 * an instruction to write `{}`, which is a turn spent producing nothing.
 */
export function rungOutputContract(file: string, writes: readonly Collectable[]): string {
  if (writes.length === 0) return ''

  const body = writes.flatMap((artefact) => EXAMPLE[artefact])
  const reported = writes.some((w) => w === 'plan' || w === 'acceptance')

  return [
    '',
    '---',
    '',
    '## What to write, and where',
    '',
    `Write a single JSON object to \`${file}\`. Nothing else you do counts — the`,
    'terminal you are in is not read, and this is the only thing that outlives',
    'your turn.',
    '',
    'Use the **Write** tool, and that exact path. It is the one file you may',
    'change, and it is matched on the path the tool names — a shell redirect to',
    'the same place is refused, because a command cannot be read as "this writes',
    'here and nowhere else".',
    '',
    'Every key is optional. Omit what you have nothing to say about rather than',
    'restating it. Anything not listed here is refused outright.',
    '',
    '```json',
    '{',
    ...body,
    '  "note": "what you found, in one line"',
    '}',
    '```',
    ...(reported ? REPORTED_NOT_APPLIED : []),
  ].join('\n')
}

/**
 * Read what a rung wrote, or refuse it.
 *
 * Built from the role's own `writes:`, so a scout that decided to rewrite the
 * plan is refused here rather than reminded in a prompt. `strict()` matters
 * for the same reason it does on a proposal: a rung carrying `status` is
 * refused out loud rather than having the field quietly dropped, because an
 * agent that tried it will try again.
 */
export function parseRungOutput(value: unknown, writes: readonly Collectable[]): RungOutput {
  const shape: Record<string, z.ZodTypeAny> = { note: z.string().default('') }
  for (const artefact of writes) shape[COLLECTABLE[artefact]] = SHAPES[artefact].optional()

  const parsed = z.object(shape).strict().safeParse(value)
  if (!parsed.success) {
    throw new RungOutputRejected(
      parsed.error.issues
        .map((i) => (i.path.length === 0 ? i.message : `${i.path.join('.')}: ${i.message}`))
        .join('; ')
    )
  }
  return parsed.data as RungOutput
}

export interface ApplyRungInput {
  readonly role: string
  readonly output: RungOutput
  readonly writes: readonly Collectable[]
  readonly at: string
}

export interface AppliedRungOutput {
  readonly order: WorkOrder
  /** What the rung said it found, for the ledger. Empty when it said nothing. */
  readonly note: string
  /**
   * A disagreement with the order, in words the operator reads.
   *
   * Null when the rung only reported what it read. Not null when it wanted to
   * change something the run is already building from — the caller raises
   * `forge-defect` on it, which is the rule for an order that contradicts
   * itself and which, until this, nothing ever raised.
   */
  readonly defect: string | null
}

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Put a rung's output on the order.
 *
 * Three destinations and three different bindings, which is the whole reason
 * this is a table rather than a spread:
 *
 *   - **context** is a finding about the repository. It informs; it does not
 *     contradict. The order stays agreed, because sending it back to draft
 *     would stop builders already working from it over a note about naming.
 *   - **findings** are exactly as binding as the six compile checks, so they
 *     take the amendment path like every other change to an agreed order —
 *     the same rule `applyFindings` follows for the structural half.
 *   - **plan** and **acceptance** are *reported*. The graph was compiled from
 *     the agreed plan before this rung ran, so applying a new one would orphan
 *     every node already in flight. It becomes a question instead.
 */
export function applyRungOutput(order: WorkOrder, input: ApplyRungInput): AppliedRungOutput {
  const { output, role, at } = input
  const note = output.note.trim()
  let next = order

  if (output.findings !== undefined) {
    next = {
      ...next,
      context: {
        ...next.context,
        entryPoints: output.findings.entryPoints ?? next.context.entryPoints,
        conventions: output.findings.conventions ?? next.context.conventions,
        priorArt: output.findings.priorArt ?? next.context.priorArt,
      },
    }
  }

  const raised: string[] = []
  if (output.redTeam !== undefined && output.redTeam.length > 0) {
    const seen = new Set(next.redTeam.map((f) => normalise(f.text)))
    const fresh: WorkOrder['redTeam'] = []
    for (const finding of output.redTeam) {
      if (seen.has(normalise(finding.text))) continue
      seen.add(normalise(finding.text))
      fresh.push({
        // Numbered from what is already there rather than from this batch, so
        // a second turn's first finding is not the first turn's first finding
        // under a new name.
        id: `RT-${role}-${next.redTeam.length + fresh.length + 1}`,
        severity: finding.severity,
        text: finding.text,
        status: 'open',
        reason: '',
      })
    }
    if (fresh.length > 0) {
      next = amendOrder(next, {
        at,
        reason: `${role} raised ${fresh.map((f) => f.id).join(', ')}`,
        change: (o) => ({ ...o, redTeam: [...o.redTeam, ...fresh] }),
      })
      raised.push(
        `${fresh.map((f) => f.id).join(', ')} — ${fresh.map((f) => f.text.trim()).join(' ')}`
      )
    }
  }

  const contested = (['plan', 'acceptance'] as const).filter(
    (artefact) => output[artefact] !== undefined
  )
  if (contested.length > 0) {
    raised.push(
      `it would rewrite the ${contested.join(' and ')} of an order this run is already building from`
    )
  }

  if (raised.length === 0) {
    return {
      order: next === order ? order : WorkOrderSchema.parse(next),
      note,
      defect: null,
    }
  }

  // Both kinds are the same thing to an operator: a reader with no stake in
  // the draft has said the order is wrong, while the work is being done from
  // it. At intake a finding is refused by the compile gate; on the Line there
  // is no compile gate, so a finding that raised nothing would revert the
  // order to draft under a run that carried on regardless.
  const defect = `The ${role} says this order is wrong: ${raised.join('; ')}${
    note === '' ? '.' : `. ${note}`
  }`

  return {
    order: WorkOrderSchema.parse({
      ...next,
      provenance: {
        ...next.provenance,
        // Written down whatever happens to the gate, so a disagreement
        // outlives the terminal it was typed in even if nobody answers.
        decisions: [...next.provenance.decisions, `${at} ${role}: ${defect}`],
      },
    }),
    note,
    defect,
  }
}

export type CollectResult =
  | {
      readonly ok: true
      readonly order: WorkOrder
      readonly note: string
      readonly defect: string | null
    }
  | { readonly ok: false; readonly reason: string }

/**
 * Read back what a rung wrote, apply it, and clear the file.
 *
 * Cleared whatever happened, for the reason `readProposal` clears a proposal:
 * a stale file from an earlier turn read as this turn's answer is what makes a
 * rung that produced nothing look like one that produced the same thing twice.
 *
 * Null when there is nothing there, which is a result — the rung's turn ended
 * and whatever it worked out is only in its terminal. The caller says so in
 * the record rather than letting it pass as an ordinary turn.
 */
export function readRungOutput(input: {
  readonly order: WorkOrder
  readonly role: string
  readonly writes: readonly Collectable[]
  readonly outputPath: string
  readonly at: string
}): CollectResult | null {
  let raw: string
  try {
    raw = fs.readFileSync(input.outputPath, 'utf8')
  } catch {
    return null
  }

  try {
    const output = parseRungOutput(JSON.parse(raw), input.writes)
    const applied = applyRungOutput(input.order, {
      role: input.role,
      output,
      writes: input.writes,
      at: input.at,
    })
    return { ok: true, ...applied }
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof RungOutputRejected
          ? error.message
          : `what the rung wrote was not readable: ${error instanceof Error ? error.message : String(error)}`,
    }
  } finally {
    try {
      fs.unlinkSync(input.outputPath)
    } catch {
      // Already gone, or never there. Either way there is nothing to clear.
    }
  }
}
