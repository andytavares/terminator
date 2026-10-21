import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { amendOrder } from '../order/amend.js'
import {
  DOCUMENT_LOCATIONS,
  DocumentHandBackSchema,
  RED_TEAM_CATEGORIES,
  WorkOrderSchema,
  isBlocking,
} from '../order/schema.js'
import type { DocumentHandBack, WorkOrder } from '../order/schema.js'
import type { Role } from '../recipe/parse.js'
import { findingHeadline } from '../order/finding-headline.js'
import { FindingsSchema } from '../order/proposal.js'

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

/** What each `writes:` target is, as JSON, and where it lands on the order. @internal */
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
  /** Where the document the order asked for ended up. See `DocumentHandBack`. */
  document: 'document',
} as const

export type Collectable = keyof typeof COLLECTABLE

const orderShape = WorkOrderSchema.shape

/**
 * One finding, as an agent writes it.
 *
 * No `id` and no `status`: the id is assigned here so a second turn cannot
 * overwrite the first turn's finding by reusing its name, and a reader that
 * could set `status: "resolved"` could close what it just raised.
 *
 * `category` is required, not defaulted: the bar an agent doesn't have to
 * name is a bar it doesn't have to think about. `reopens` names a settled
 * finding this one contests; `newEvidence` is the answer to the reason it was
 * settled with, and is what makes a reopen anything other than the same
 * finding raised twice.
 */
const AgentFindingSchema = z
  .object({
    severity: z.enum(['low', 'medium', 'high']).default('medium'),
    category: z.enum(RED_TEAM_CATEGORIES),
    text: z.string().min(1),
    reopens: z.string().min(1).optional(),
    newEvidence: z.string().optional(),
  })
  .strict()

const SHAPES: Record<Collectable, z.ZodTypeAny> = {
  context: FindingsSchema,
  findings: z.array(AgentFindingSchema),
  plan: orderShape.plan,
  acceptance: orderShape.acceptance,
  document: DocumentHandBackSchema,
}

/** @internal */
export interface RungOutput {
  readonly findings?: z.infer<typeof FindingsSchema>
  readonly redTeam?: readonly z.infer<typeof AgentFindingSchema>[]
  readonly plan?: WorkOrder['plan']
  readonly acceptance?: WorkOrder['acceptance']
  readonly document?: DocumentHandBack
  readonly anotherPass?: boolean
  readonly note: string
}

/** @internal */
export class RungOutputRejected extends Error {
  readonly code = 'RUNG_OUTPUT_REJECTED'
  constructor(reason: string) {
    super(`What the rung wrote was refused: ${reason}`)
    this.name = 'RungOutputRejected'
  }
}

class RungIdEscapesOrderError extends Error {
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
    '    {',
    '      "severity": "low | medium | high",',
    `      "category": "${RED_TEAM_CATEGORIES.join(' | ')}",`,
    '      "text": "first line: what is wrong, in one sentence\\n\\n- the evidence, with file:line\\n- why it matters",',
    '      "reopens": "RT-… (only to contest a settled finding)",',
    '      "newEvidence": "what the earlier reason did not answer (required with reopens)"',
    '    }',
    '  ],',
    '  "anotherPass": false,',
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
  document: [
    '  "document": {',
    '    "path": "where the document is: a path in the checkout, or in outputs/",',
    '    "url": "the link to it, only when you published it somewhere",',
    `    "location": "${DOCUMENT_LOCATIONS.join(' | ')}"`,
    '  },',
  ],
}

/** The bar a finding is held to, shown wherever a role may raise one. */
const FINDING_BAR = [
  '',
  'A finding blocks only when it is `wrong-outcome`, `regression` or',
  '`unprovable`: the order’s criteria could pass while the ticket’s outcome is',
  'false, the change breaks something that works today, or no criterion can',
  'actually be checked. Docs, ADRs, naming and coverage are `process`. A bug',
  'that already exists is `pre-existing`. A missing tool or permission in this',
  'environment is `infra`. Work the ask never mentioned is `scope`. None of',
  'those four stop the run.',
  '',
  'One pass is the default. Set `anotherPass` to true only when fixing your',
  'blocking findings will change the plan enough that the fix itself needs',
  'attacking; say why in `note`. The loop stops after three passes either way.',
]

/** What a rung whose plan cannot be applied is told, so it does not retry. */
const REPORTED_NOT_APPLIED = [
  '',
  '`plan` and `acceptance` are **reported, not applied**. The run graph was',
  'compiled from the agreed order before you started, so replacing the plan now',
  'would orphan work already in flight. What you write here reaches the operator',
  'as a question about the order instead, which is what a plan you disagree with',
  'actually is. Say it in `note` as well as in the field.',
]

/** What an author is told about where a document may go. */
function documentGuide(outputsDir: string | undefined): string[] {
  return [
    '',
    'Say where the document is in `document`. `location` is `checkout` when you',
    'wrote it in the repository, which ships as a pull request; `outputs` when',
    'you wrote it to the order\u2019s own directory',
    ...(outputsDir === undefined ? [] : [`(\`${outputsDir}\`), which ships nothing;`]),
    'and `published` when you published it as a Claude artifact. When the order',
    'names a target outside the checkout, or in another repository, write the',
    'document to outputs and say so here.',
    '',
    'When you can, write the document as an HTML page in the outputs directory and',
    'publish it with the Artifact tool. Hand back `published`, with `path` set to',
    'that file and `url` set to the link the tool returned. If the publish fails,',
    'because there is no claude.ai sign-in, hand back `outputs` instead.',
    '`published` is only for a page you published with the Artifact tool: a link',
    'from anywhere else is refused, so name that place in your note instead.',
  ]
}

/** The one file a rung writes, and why it is the only one. */
function whereToWrite(file: string): string[] {
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
  ]
}

// What to write and where; empty for a role with nothing to hand back, since a
// contract with no keys asks for `{}` and spends a turn on nothing.
export function rungOutputContract(
  file: string,
  writes: readonly Collectable[],
  options: { readonly outputsDir?: string } = {}
): string {
  if (writes.length === 0) return ''

  const body = writes.flatMap((artefact) => EXAMPLE[artefact])
  const reported = writes.some((w) => w === 'plan' || w === 'acceptance')
  const findsThings = writes.includes('findings')

  return [
    ...whereToWrite(file),
    '```json',
    '{',
    ...body,
    '  "note": "what you found, in one line"',
    '}',
    '```',
    ...(reported ? REPORTED_NOT_APPLIED : []),
    ...(writes.includes('document') ? documentGuide(options.outputsDir) : []),
    ...(findsThings ? FINDING_BAR : []),
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
 * @internal
 */
export function parseRungOutput(value: unknown, writes: readonly Collectable[]): RungOutput {
  const shape: Record<string, z.ZodTypeAny> = { note: z.string().default('') }
  for (const artefact of writes) shape[COLLECTABLE[artefact]] = SHAPES[artefact].optional()
  if (writes.includes('findings')) shape.anotherPass = z.boolean().optional()

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

/** @internal */
export interface ApplyRungInput {
  readonly role: string
  readonly output: RungOutput
  readonly writes: readonly Collectable[]
  readonly at: string
  /** Which review round this is. Stamped onto every fresh finding. Defaults to 0. */
  readonly round?: number
}

/** @internal */
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
  /** The document this turn handed back, or null when it handed none. */
  readonly document: DocumentHandBack | null
  /** The red team asked to attack the fix for its findings too. */
  readonly anotherPass: boolean
}

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

function headlineTokens(text: string): Set<string> {
  return new Set(
    findingHeadline(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0)
  )
}

/** Two empty sets are not "the same claim" — there is no claim to compare. */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection++
  return intersection / (a.size + b.size - intersection)
}

/** At or above this, two findings are the same claim in different words. */
const DUPLICATE_BAR = 0.6

/**
 * Put a rung's output on the order.
 *
 * Three destinations and three different bindings, which is the whole reason
 * this is a table rather than a spread:
 *
 *   - **context** is a finding about the repository. It informs; it does not
 *     contradict. The order stays agreed, because sending it back to draft
 *     would stop builders already working from it over a note about naming.
 *   - **findings** that block — `wrong-outcome`, `regression`, `unprovable` —
 *     take the amendment path like every other change to an agreed order, the
 *     same rule `applyFindings` follows for the structural half. A finding
 *     that only notes something is appended without amending: there is
 *     nothing here for a run already building from the order to be stopped
 *     for.
 *   - **plan** and **acceptance** are *reported*. The graph was compiled from
 *     the agreed plan before this rung ran, so applying a new one would orphan
 *     every node already in flight. It becomes a question instead.
 * @internal
 */
export function applyRungOutput(order: WorkOrder, input: ApplyRungInput): AppliedRungOutput {
  const { output, role, at, round = 0 } = input
  let next = withHandBack(order, output)
  const merge = mergeRedTeam(next.redTeam, output.redTeam ?? [], { role, round })
  if (merge.fresh.length > 0 || merge.redTeam !== next.redTeam) {
    next = { ...next, redTeam: [...merge.redTeam, ...merge.fresh] }
  }
  const blockingReasons = [...merge.blockingReasons, ...contestedReasons(output)]
  const told = {
    note: output.note.trim(),
    document: output.document ?? null,
    anotherPass: output.anotherPass === true,
  }
  if (blockingReasons.length === 0) {
    return {
      ...told,
      order: next === order ? order : WorkOrderSchema.parse(next),
      note: told.note === '' && merge.notesAdded > 0 ? notesWord(merge.notesAdded) : told.note,
      defect: null,
    }
  }
  return disputed(next, { told, blockingReasons, redTeamBlocked: merge.redTeamBlocked, role, at })
}

function notesWord(count: number): string {
  return `${count} non-blocking note${count === 1 ? '' : 's'}`
}

/** What a rung found about the repository, and the document it handed back, on the order. */
function withHandBack(order: WorkOrder, output: RungOutput): WorkOrder {
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
  if (output.document !== undefined) next = { ...next, document: output.document }
  return next
}

/** The plan or acceptance list a rung tried to rewrite, which is reported and never applied. */
function contestedReasons(output: RungOutput): string[] {
  const contested = (['plan', 'acceptance'] as const).filter(
    (artefact) => output[artefact] !== undefined
  )
  if (contested.length === 0) return []
  return [
    `it would rewrite the ${contested.join(' and ')} of an order this run is already building from`,
  ]
}

type RedTeam = WorkOrder['redTeam']
type IncomingFinding = NonNullable<RungOutput['redTeam']>[number]

/** The red team's findings merged into the order's, and what that merge says. */
interface RedTeamMerge {
  /** The order's findings, with any the rung reopened. */
  redTeam: RedTeam
  /** Findings new to the order, numbered after the ones it has. */
  readonly fresh: RedTeam[number][]
  /** What forces the order back to draft, named for the defect message. */
  readonly blockingReasons: string[]
  // True only when a red-team finding is why: a disputed plan or acceptance list is a
  // question and never amends the order.
  redTeamBlocked: boolean
  /** Findings that landed but changed nothing an operator has to act on. */
  notesAdded: number
}

function mergeRedTeam(
  existing: RedTeam,
  incoming: readonly IncomingFinding[],
  by: { role: string; round: number }
): RedTeamMerge {
  const merge: RedTeamMerge = {
    redTeam: existing,
    fresh: [],
    blockingReasons: [],
    redTeamBlocked: false,
    notesAdded: 0,
  }
  const seenText = new Set(existing.map((f) => normalise(f.text)))
  const seenHeadlines = existing.map((f) => headlineTokens(f.text))
  for (const finding of incoming) {
    if (finding.reopens !== undefined) reopen(merge, finding)
    else if (!isRepeat(finding.text, { seenText, seenHeadlines, fresh: merge.fresh })) {
      seenText.add(normalise(finding.text))
      merge.fresh.push(freshFinding(finding, { ...by, number: nextNumber(merge) }))
    }
  }
  countFresh(merge)
  return merge
}

/** The fresh findings that block go into the defect; the rest are notes. */
function countFresh(merge: RedTeamMerge): void {
  const blockingFresh = merge.fresh.filter(isBlocking)
  merge.notesAdded += merge.fresh.length - blockingFresh.length
  if (blockingFresh.length === 0) return
  merge.redTeamBlocked = true
  merge.blockingReasons.push(
    `${blockingFresh.map((f) => f.id).join(', ')} — ${blockingFresh.map((f) => f.text.trim()).join(' ')}`
  )
}

// Numbered from what is there, not this batch, so a second turn's first finding is
// not the first turn's under a new name.
function nextNumber(merge: RedTeamMerge): number {
  return merge.redTeam.length + merge.fresh.length + 1
}

function freshFinding(
  finding: IncomingFinding,
  { role, round, number }: { role: string; round: number; number: number }
): RedTeam[number] {
  return {
    id: `RT-${role}-${number}`,
    severity: finding.severity,
    category: finding.category,
    text: finding.text,
    status: 'open',
    reason: '',
    round,
  }
}

/** Already on the order word for word, or the same claim in other words. */
function isRepeat(
  text: string,
  seen: {
    seenText: ReadonlySet<string>
    seenHeadlines: readonly ReadonlySet<string>[]
    fresh: readonly RedTeam[number][]
  }
): boolean {
  if (seen.seenText.has(normalise(text))) return true
  const headline = headlineTokens(text)
  return (
    seen.seenHeadlines.some((h) => jaccard(h, headline) >= DUPLICATE_BAR) ||
    seen.fresh.some((f) => jaccard(headlineTokens(f.text), headline) >= DUPLICATE_BAR)
  )
}

// Reopen a settled finding with new evidence answering what settled it. Without any,
// it is dropped: the same finding a second time.
function reopen(merge: RedTeamMerge, finding: IncomingFinding): void {
  const target = merge.redTeam.find((f) => f.id === finding.reopens && f.status !== 'open')
  const evidence = (finding.newEvidence ?? '').trim()
  if (target === undefined || evidence === '') return
  merge.redTeam = merge.redTeam.map((f) =>
    f.id === target.id ? { ...f, status: 'open' as const, text: `${f.text}\n\n${evidence}` } : f
  )
  if (isBlocking(target)) {
    merge.blockingReasons.push(`${target.id} reopened — ${evidence}`)
    merge.redTeamBlocked = true
  } else {
    merge.notesAdded += 1
  }
}

// Both kinds mean an outside reader called the order wrong while work proceeds from
// it. On the Line there is no compile gate to refuse it, so a finding that raised
// nothing would revert the order to draft under a run carrying on.
function disputed(
  order: WorkOrder,
  dispute: {
    told: Pick<AppliedRungOutput, 'note' | 'document' | 'anotherPass'>
    blockingReasons: readonly string[]
    redTeamBlocked: boolean
    role: string
    at: string
  }
): AppliedRungOutput {
  const { told, role, at } = dispute
  const defect = `The ${role} says this order is wrong: ${dispute.blockingReasons.join('; ')}${
    told.note === '' ? '.' : `. ${told.note}`
  }`
  const next = dispute.redTeamBlocked
    ? amendOrder(order, { at, reason: `${role}: ${defect}` })
    : order
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
    ...told,
    defect,
  }
}

export type CollectResult =
  | {
      readonly ok: true
      readonly order: WorkOrder
      readonly note: string
      readonly defect: string | null
      readonly document: DocumentHandBack | null
      readonly anotherPass: boolean
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
export function readRungOutput(input: ReadRungInput): CollectResult | null {
  let raw: string
  try {
    raw = fs.readFileSync(input.outputPath, 'utf8')
  } catch {
    return null
  }
  try {
    return applyWritten(raw, input)
  } finally {
    try {
      fs.unlinkSync(input.outputPath)
    } catch {
      // Already gone, or never there. Either way there is nothing to clear.
    }
  }
}

interface ReadRungInput {
  readonly order: WorkOrder
  readonly role: string
  readonly writes: readonly Collectable[]
  readonly outputPath: string
  readonly at: string
  /** Which review round this is. Stamped onto every fresh finding. Defaults to 0. */
  readonly round?: number
}

/** What the rung wrote, applied to the order, or why it could not be. */
function applyWritten(raw: string, input: ReadRungInput): CollectResult {
  try {
    const output = parseRungOutput(JSON.parse(raw), input.writes)
    const { role, writes, at, round } = input
    return { ok: true, ...applyRungOutput(input.order, { role, output, writes, at, round }) }
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof RungOutputRejected
          ? error.message
          : `what the rung wrote was not readable: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
