import { renderOrder } from '../order/render.js'
import { collectableWrites, rungOutputContract } from './rung-output.js'
import { isBlocking } from '../order/schema.js'
import type { PlanUnit, WorkOrder } from '../order/schema.js'
import type { Role } from '../recipe/parse.js'
import type { Rule } from '../recipe/parse.js'
import type { Feedback } from './run-graph.js'
import { findingHeadline } from '../order/finding-headline.js'

// What an agent is actually told.
//
// A role's prompt says how to work; it says nothing about what to build. An
// agent launched with the bare prompt is a builder that knows it is a builder
// and nothing else — which is the shape of every "it did the wrong thing"
// failure, and not something a better prompt fixes.
//
// What each role may read is declared on the role (`reads:`), not decided here,
// so a verifier does not get the builder's justification and a scout does not
// get the plan. The list is a permission, not a preference.

export interface BriefInput {
  readonly order: WorkOrder
  readonly role: Role | null
  /**
   * The units this node is doing, in the order to do them.
   *
   * A list because a fan-out `by lane` gives one agent a whole lane's work.
   * Empty for a node that is not about a unit at all.
   */
  readonly units: readonly PlanUnit[]
  /** The rules in force in this repository. Empty is a normal answer. */
  readonly rules: readonly Rule[]
  /** For a `run` step: the command, which is the whole instruction. */
  readonly command?: string
  /** What a check said the last time this node's work failed one, oldest first. */
  readonly feedback?: readonly Feedback[]
  /**
   * Where this rung writes what it found, absolute.
   *
   * Absent means the caller keeps no rung output, and the agent is told
   * nothing — a destination named to somebody who will never be read from is
   * worse than silence. Present, it is the last thing in the brief and the one
   * path the read-only policy lets through.
   */
  readonly outputPath?: string
  /**
   * The order's own `outputs/` directory, named to a role that hands back a
   * document so it can write one outside the checkout. Absent for the rest.
   */
  readonly outputsDir?: string
}

function oneUnit(order: WorkOrder, unit: PlanUnit, heading: string): string[] {
  const criteria = unit.satisfies
    .map((id) => order.acceptance.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)

  return [
    `${heading} ${unit.id} — ${unit.title}`,
    '',
    unit.touches.length === 0
      ? 'It declared no files. Touching anything outside what the plan said is a risk trigger, not a shortcut.'
      : `It touches: ${unit.touches.map((p) => `\`${p}\``).join(', ')}. Going outside that list is a risk trigger, not a shortcut.`,
    '',
    ...(criteria.length === 0
      ? ['_This unit satisfies no criterion, which the compile gate should have refused._']
      : [
          'It is done when all of these are true, and not before:',
          '',
          ...criteria.map((c) => `- **${c.id}** ${c.statement}`),
        ]),
  ]
}

/**
 * The unit, or the lane's units.
 *
 * A lane is one worktree and one branch, so a fan-out `by lane` hands one
 * agent everything in it. The plan's detail is why units exist at all, so
 * every one is listed with its own files and criteria rather than summarised
 * — what changes is that they cost one session instead of one each.
 */
function unitSection(order: WorkOrder, units: readonly PlanUnit[]): string[] {
  if (units.length === 1) return oneUnit(order, units[0], '## The unit:')

  return [
    `## The units: ${units.map((unit) => unit.id).join(', ')}`,
    '',
    'They share one worktree and one branch, and they are all yours.',
    'Do them in the order they are listed: the plan says a later one depends',
    'on an earlier one, and nothing else is coming to do the rest.',
    '',
    ...units.flatMap((unit) => [...oneUnit(order, unit, '### '), '']),
  ]
}

/**
 * Why a builder's work came back, in the check's own words.
 *
 * Naming the check and its exit status is what keeps a resend from reading
 * as "try again" — it says which command found the problem, so the fix is
 * aimed at what failed rather than at the check itself.
 */
function feedbackSection(feedback: readonly Feedback[]): string[] {
  if (feedback.length === 0) return []
  return [
    '## Your previous attempt failed a check',
    '',
    'Fix its cause, not the check.',
    '',
    ...feedback.flatMap((entry) => [
      `- ${entry.command === null ? 'a check' : `\`${entry.command}\``}, ${entry.exitCode === null ? 'no exit status' : `exit ${entry.exitCode}`}:`,
      '',
      '```',
      entry.excerpt,
      '```',
      '',
    ]),
  ]
}

function contextSection(order: WorkOrder, role: Role | null): string[] {
  const { context } = order
  const lines = [
    '## The repository',
    '',
    ...context.repos.map((repo) => `- \`${repo.name}\` — base \`${repo.baseBranch}\``),
    '',
    commandsLine(order, role),
  ]
  if (context.houseDocs.length > 0) {
    lines.push('', `This project documents itself in: ${context.houseDocs.join(', ')}. Read it.`)
  }
  if (context.conventions.length > 0) {
    lines.push('', `Conventions: ${context.conventions.join('; ')}`)
  }
  if (context.priorArt.length > 0) {
    lines.push('', '## Already decided about these files', '')
    lines.push(...context.priorArt.map((line) => `- ${line}`))
  }
  return lines
}

// The commands the probe found. A role that may not run them is told so: an architect
// told "use these" and then refused `npm test` spent three turns on it.
function commandsLine(order: WorkOrder, role: Role | null): string {
  const commands = Object.entries(order.context.toolchain)
    .filter(([, found]) => found !== null)
    .map(([name, found]) => `${name}: \`${(found as { command: string }).command}\``)
  if (commands.length === 0) {
    return 'No commands were found in this repository. Do not invent one — a check that cannot run reports "not measured", and inventing a command turns that into a false pass.'
  }
  const mayRun = role === null || role.tools.includes('run_tests')
  return mayRun
    ? `Commands found here: ${commands.join(' · ')}. Use these; do not invent others.`
    : `Commands found here: ${commands.join(' · ')}. These are run for you, on the verification ladder — you may not run them yourself, and you do not need to.`
}

function rulesSection(rules: readonly Rule[]): string[] {
  if (rules.length === 0) return []
  return [
    '## House rules that apply here',
    '',
    ...rules.map((rule) => `- **${rule.id}** (${rule.rung}) — ${rule.asserts.trim()}`),
  ]
}

/**
 * What earlier review rounds noted but did not block on, for a builder whose
 * unit might be the place to act on one.
 *
 * Handed to the builder as a courtesy, not an instruction: a note outside its
 * unit's `touches` is somebody else's to pick up, and the builder is told so
 * rather than left to guess why it was shown one it cannot act on.
 */
function notesSection(order: WorkOrder): string[] {
  const notes = order.redTeam.filter((f) => f.status === 'open' && !isBlocking(f))
  if (notes.length === 0) return []
  return [
    '## Notes from review',
    '',
    'Handle one of these only if it falls inside your unit’s `touches` above.',
    'Otherwise it is not yours — leave it.',
    '',
    ...notes.map((f) => `- **${f.id}** ${findingHeadline(f.text)}`),
  ]
}

/**
 * The whole message an agent is launched with.
 *
 * The role's own prompt comes first because it is the instruction; everything
 * after it is what the role is permitted to read. A role that declared no
 * reads gets its prompt and nothing else, which is the verifier's whole point
 * being enforced rather than requested.
 */
export function brief(input: BriefInput): string {
  const { order, role, command } = input
  // A `run` step is a command, not a conversation. Wrapping it in context
  // would invite an agent to reinterpret it.
  if (command !== undefined && command.trim() !== '') return commandBrief(command)

  const reads = new Set<string>(role?.reads ?? [])
  return [
    role?.prompt.trim() ?? '',
    '',
    '---',
    '',
    `# ${order.title}`,
    '',
    `Work order \`${order.id}\`, risk ${order.risk.grade}.`,
    ...intentSections(order),
    ...workSections(input, reads),
    ...knowledgeSections(input, reads),
    ...outputSection(input),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function commandBrief(command: string): string {
  return [
    `Run this exactly, and report its exit status. Do not fix what it reports.`,
    '',
    '```',
    command.trim(),
    '```',
  ].join('\n')
}

function intentSections({ intent }: WorkOrder): string[] {
  const lines: string[] = []
  if (intent.problem.trim() !== '') lines.push('', '## The problem', '', intent.problem.trim())
  if (intent.outcome.trim() !== '') {
    lines.push('', '## What "done" looks like', '', intent.outcome.trim())
  }
  if (intent.nonGoals.length > 0) {
    lines.push('', '## Explicitly not this', '', ...intent.nonGoals.map((goal) => `- ${goal}`))
  }
  return lines
}

/** The units to build, or the criteria to judge, and why an earlier attempt came back. */
function workSections(input: BriefInput, reads: ReadonlySet<string>): string[] {
  const { order, units, feedback = [] } = input
  const lines: string[] = []
  if (reads.has('unit') && units.length > 0) {
    lines.push('', ...unitSection(order, units), '', ...notesSection(order))
  }
  // A role that reads criteria but not units gets all of them — that is the
  // verifier, which is handed the change and the criteria and nothing about
  // how the work was justified.
  if (reads.has('criteria') && !reads.has('unit')) {
    lines.push('', '## What must be true', '')
    lines.push(
      ...order.acceptance.map((c) => `- **${c.id}** ${c.statement} — proven by ${c.verify.kind}`)
    )
  }
  if (reads.has('feedback') && feedback.length > 0) lines.push('', ...feedbackSection(feedback))
  return lines
}

/** What the role may know about the repository, its rules, the order and its assumptions. */
function knowledgeSections(input: BriefInput, reads: ReadonlySet<string>): string[] {
  const { order, role, rules } = input
  const lines: string[] = []
  if (reads.has('context') || reads.has('conventions')) {
    lines.push('', ...contextSection(order, role ?? null))
  }
  if (reads.has('rules')) lines.push('', ...rulesSection(rules))
  if (reads.has('order')) lines.push('', '---', '', renderOrder(order))
  const assumed = order.assumptions.filter((a) => !a.struck)
  if (assumed.length > 0 && reads.has('context')) {
    lines.push('', '## Assumed, and not verified', '', ...assumed.map((a) => `- ${a.text}`), '')
    lines.push(
      'If one of these turns out to be wrong, stop and say so rather than working around it.'
    )
  }
  return lines
}

// Last, because it is what the agent does with everything above: without it, steps
// were told what to think about and never where to put it.
function outputSection({ role, outputPath, outputsDir }: BriefInput): string[] {
  if (outputPath === undefined) return []
  const contract = rungOutputContract(outputPath, collectableWrites(role ?? null), { outputsDir })
  return contract === '' ? [] : [contract]
}
