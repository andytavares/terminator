import { coverageMatrix } from './coverage-matrix.js'
import { compileOrder } from './compile.js'
import { isBlocking } from './schema.js'
import type { Budgets, OrderStatus, WorkOrder } from './schema.js'
import { findingHeadline } from './finding-headline.js'

// The order, rendered for a person.
//
// Regenerated on every change and never hand-edited. Anything the operator
// wants to change goes through intake so it lands in `order.json`, which is
// the truth; this file is a view of it. The same rendering is what goes to the
// source issue as a comment, so the issue becomes the readable record of what
// was agreed without anyone retyping it.

function verifyLine(order: WorkOrder, criterionId: string): string {
  const criterion = order.acceptance.find((c) => c.id === criterionId)
  if (criterion === undefined) return ''
  if (criterion.unverifiable?.accepted === true) {
    return `accepted as unverifiable — ${criterion.unverifiable.reason}`
  }
  const v = criterion.verify
  switch (v.kind) {
    case 'test':
    case 'command':
      return `${v.kind} · \`${v.command}\` · ${v.assert}`
    case 'judge':
      return `judge · "${v.rubric}" · evidence: ${v.evidence.join(', ')}`
    case 'artifact':
      return `artifact · ${v.path} · ${v.assert}`
    case 'screenshot':
      return `screenshot · ${v.target}`
  }
}

/** The two enforced budgets, e.g. "3 agents · 45 minutes". */
export function budgetsInWords(budgets: Budgets): string {
  const limit = (value: number | null, unit: string): string =>
    value === null ? `${unit} unlimited` : `${value} ${unit}`
  return [limit(budgets.agents, 'agents'), limit(budgets.wallClockMinutes, 'minutes')].join(' · ')
}

const STATUS_IN_WORDS: Record<OrderStatus, string> = {
  draft: 'still being shaped',
  agreed: 'agreed, not yet started',
  running: 'running',
  shipped: 'shipped',
  cancelled: 'cancelled',
}

/** An order's status in words, typed so a new status fails to compile here. */
export function statusInWords(status: OrderStatus): string {
  return STATUS_IN_WORDS[status]
}

function coverageTable(order: WorkOrder): string[] {
  const matrix = coverageMatrix(order)
  if (matrix.criteria.length === 0 || matrix.units.length === 0) {
    return ['_Nothing to plot yet._']
  }
  const header = `| | ${matrix.units.join(' | ')} |`
  const rule = `| --- | ${matrix.units.map(() => '---').join(' | ')} |`
  const rows = matrix.criteria.map(
    (id, row) => `| ${id} | ${matrix.cells[row].map((hit) => (hit ? '●' : '·')).join(' | ')} |`
  )
  return [header, rule, ...rows]
}

/**
 * Markdown, deliberately plain: it has to read well in the application, in a
 * terminal, and as a tracker comment, and the least decorated version is the
 * one that survives all three.
 */
export function renderOrder(order: WorkOrder): string {
  return [
    ...headLines(order),
    ...intentLines(order),
    ...doneMeansLines(order),
    ...planLines(order),
    '## Coverage',
    '',
    ...coverageTable(order),
    '',
    ...listed('Assumptions', liveAssumptions(order)),
    ...listed('Open questions', openQuestionTexts(order)),
    ...redTeamLines(order),
    '## Budgets',
    '',
    `${budgetsInWords(order.budgets)} · tokens ${order.budgets.tokens ?? 'uncapped'}`,
    '',
    ...convergenceLines(order),
  ].join('\n')
}

/** A heading over one bullet per item, or nothing at all when there are none. */
function listed(heading: string, items: readonly string[]): string[] {
  if (items.length === 0) return []
  return [`## ${heading}`, '', ...items.map((item) => `- ${item}`), '']
}

function headLines(order: WorkOrder): string[] {
  const source =
    order.source.kind === 'tracker' && order.source.key !== null
      ? [`Source: ${order.source.tracker} ${order.source.key}`]
      : []
  return [
    `# ${order.title}`,
    '',
    `**${order.id}** · ${order.status} · risk ${order.risk.grade} · recipe ${order.recipe ?? 'not chosen'}`,
    ...source,
    '',
  ]
}

function intentLines(order: WorkOrder): string[] {
  const nonGoals = order.intent.nonGoals
  const deliberately =
    nonGoals.length > 0
      ? ['**Deliberately not doing:**', '', ...nonGoals.map((goal) => `- ${goal}`), '']
      : []
  return [
    '## Intent',
    '',
    `**Problem.** ${order.intent.problem || '_not stated_'}`,
    '',
    `**Outcome.** ${order.intent.outcome || '_not stated_'}`,
    '',
    ...deliberately,
  ]
}

function doneMeansLines(order: WorkOrder): string[] {
  if (order.acceptance.length === 0) return ['## Done means', '', '_No criteria yet._', '']
  const criteria = order.acceptance.flatMap((criterion) => [
    `- **${criterion.id}** (${criterion.priority}) ${criterion.statement}`,
    `  - ${verifyLine(order, criterion.id)}`,
  ])
  return ['## Done means', '', ...criteria, '']
}

function planLines(order: WorkOrder): string[] {
  if (order.plan.units.length === 0) return ['## Plan', '', '_No units yet._', '']
  return ['## Plan', '', ...order.plan.units.flatMap(unitLines), '']
}

function unitLines(unit: WorkOrder['plan']['units'][number]): string[] {
  const waits = unit.dependsOn.length > 0 ? ` · after ${unit.dependsOn.join(', ')}` : ''
  const touches = unit.touches.length > 0 ? [`  - touches: ${unit.touches.join(', ')}`] : []
  return [
    `- **${unit.id}** ${unit.title} — ${unit.role}, lane ${unit.lane}${waits} · satisfies ${unit.satisfies.join(', ') || '_nothing_'}`,
    ...touches,
  ]
}

function liveAssumptions(order: WorkOrder): string[] {
  return order.assumptions.filter((a) => !a.struck).map((a) => a.text)
}

function openQuestionTexts(order: WorkOrder): string[] {
  return order.openQuestions.filter((q) => q.answer === null).map((q) => q.text)
}

type Finding = WorkOrder['redTeam'][number]

/** Open findings, blocking then not, and then the ones already settled. */
function redTeamLines(order: WorkOrder): string[] {
  const open = order.redTeam.filter((f) => f.status === 'open')
  const settled = order.redTeam.filter((f) => f.status !== 'open')
  return [
    ...listed('Red team — blocking', open.filter((f) => isBlocking(f)).map(openFinding)),
    ...listed('Red team — notes', open.filter((f) => !isBlocking(f)).map(openFinding)),
    ...listed('Red team — settled', settled.map(settledFinding)),
  ]
}

function openFinding(finding: Finding): string {
  return `**${finding.id}** (${finding.category}, ${finding.severity}) ${findingHeadline(finding.text)}`
}

function settledFinding(finding: Finding): string {
  return `**${finding.id}** (${finding.status}: ${finding.reason || 'no reason given'}) ${findingHeadline(finding.text)}`
}

function convergenceLines(order: WorkOrder): string[] {
  const result = compileOrder(order)
  if (result.ok) {
    return ['## Convergence', '', 'All checks pass. This order can be handed off.', '']
  }
  const failures = result.failures.map((failure) => `- **${failure.check}** — ${failure.detail}`)
  return ['## Convergence', '', ...failures, '']
}
