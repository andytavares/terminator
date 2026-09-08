import { renderOrder } from '../order/render.js'
import { collectableWrites, rungOutputContract } from './rung-output.js'
import type { PlanUnit, WorkOrder } from '../order/schema.js'
import type { Role } from '../recipe/parse.js'
import type { Rule } from '../recipe/parse.js'

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

/** Everything a role can ask for. Anything else in `reads:` is ignored. */
export const READABLE = ['unit', 'criteria', 'context', 'rules', 'order', 'conventions'] as const

export type Readable = (typeof READABLE)[number]

export interface BriefInput {
  readonly order: WorkOrder
  readonly role: Role | null
  /** The unit this node is doing, where the node has one. */
  readonly unit: PlanUnit | null
  /** The rules in force in this repository. Empty is a normal answer. */
  readonly rules: readonly Rule[]
  /** For a `run` step: the command, which is the whole instruction. */
  readonly command?: string
  /**
   * Where this rung writes what it found, absolute.
   *
   * Absent means the caller keeps no rung output, and the agent is told
   * nothing — a destination named to somebody who will never be read from is
   * worse than silence. Present, it is the last thing in the brief and the one
   * path the read-only policy lets through.
   */
  readonly outputPath?: string
}

function unitSection(order: WorkOrder, unit: PlanUnit): string[] {
  const criteria = unit.satisfies
    .map((id) => order.acceptance.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)

  return [
    `## The unit: ${unit.id} — ${unit.title}`,
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

function contextSection(order: WorkOrder, role: Role | null): string[] {
  const lines = ['## The repository', '']
  for (const repo of order.context.repos) {
    lines.push(`- \`${repo.name}\` — base \`${repo.baseBranch}\``)
  }
  const commands = Object.entries(order.context.toolchain)
    .filter(([, found]) => found !== null)
    .map(([name, found]) => `${name}: \`${(found as { command: string }).command}\``)

  // A role that may not run them is told so, rather than invited to. The
  // architect was handed "use these; do not invent others" and then refused
  // `npm test` by the policy, so it spent three turns on an instruction the
  // factory would never have let it follow.
  const mayRun = role === null || role.tools.includes('run_tests')

  lines.push(
    '',
    commands.length === 0
      ? 'No commands were found in this repository. Do not invent one — a check that cannot run reports "not measured", and inventing a command turns that into a false pass.'
      : mayRun
        ? `Commands found here: ${commands.join(' · ')}. Use these; do not invent others.`
        : `Commands found here: ${commands.join(' · ')}. These are run for you, on the verification ladder — you may not run them yourself, and you do not need to.`
  )
  if (order.context.houseDocs.length > 0) {
    lines.push(
      '',
      `This project documents itself in: ${order.context.houseDocs.join(', ')}. Read it.`
    )
  }
  if (order.context.conventions.length > 0) {
    lines.push('', `Conventions: ${order.context.conventions.join('; ')}`)
  }
  if (order.context.priorArt.length > 0) {
    lines.push(
      '',
      '## Already decided about these files',
      '',
      ...order.context.priorArt.map((line) => `- ${line}`)
    )
  }
  return lines
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
 * The whole message an agent is launched with.
 *
 * The role's own prompt comes first because it is the instruction; everything
 * after it is what the role is permitted to read. A role that declared no
 * reads gets its prompt and nothing else, which is the verifier's whole point
 * being enforced rather than requested.
 */
export function brief(input: BriefInput): string {
  const { order, role, unit, rules, command, outputPath } = input

  // A `run` step is a command, not a conversation. Wrapping it in context
  // would invite an agent to reinterpret it.
  if (command !== undefined && command.trim() !== '') {
    return [
      `Run this exactly, and report its exit status. Do not fix what it reports.`,
      '',
      '```',
      command.trim(),
      '```',
    ].join('\n')
  }

  const reads = new Set<string>(role?.reads ?? [])
  const sections: string[] = [role?.prompt.trim() ?? '']

  sections.push(
    '',
    '---',
    '',
    `# ${order.title}`,
    '',
    `Work order \`${order.id}\`, risk ${order.risk.grade}.`
  )

  if (order.intent.problem.trim() !== '') {
    sections.push('', '## The problem', '', order.intent.problem.trim())
  }
  if (order.intent.outcome.trim() !== '') {
    sections.push('', '## What "done" looks like', '', order.intent.outcome.trim())
  }
  if (order.intent.nonGoals.length > 0) {
    sections.push(
      '',
      '## Explicitly not this',
      '',
      ...order.intent.nonGoals.map((goal) => `- ${goal}`)
    )
  }

  if (reads.has('unit') && unit !== null) sections.push('', ...unitSection(order, unit))

  // A role that reads criteria but not units gets all of them — that is the
  // verifier, which is handed the change and the criteria and nothing about
  // how the work was justified.
  if (reads.has('criteria') && !reads.has('unit')) {
    sections.push(
      '',
      '## What must be true',
      '',
      ...order.acceptance.map((c) => `- **${c.id}** ${c.statement} — proven by ${c.verify.kind}`)
    )
  }

  if (reads.has('context') || reads.has('conventions')) {
    sections.push('', ...contextSection(order, role ?? null))
  }
  if (reads.has('rules')) sections.push('', ...rulesSection(rules))
  if (reads.has('order')) sections.push('', '---', '', renderOrder(order))

  if (order.assumptions.filter((a) => !a.struck).length > 0 && reads.has('context')) {
    sections.push(
      '',
      '## Assumed, and not verified',
      '',
      ...order.assumptions.filter((a) => !a.struck).map((a) => `- ${a.text}`),
      '',
      'If one of these turns out to be wrong, stop and say so rather than working around it.'
    )
  }

  // Last, because it is what the agent does with everything above it. The
  // Forge has always ended its brief this way; the Line ended without one, so
  // four of the standard shape's nine steps were told what to think about and
  // never where to put it.
  if (outputPath !== undefined) {
    const contract = rungOutputContract(outputPath, collectableWrites(role ?? null))
    if (contract !== '') sections.push(contract)
  }

  return sections
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
