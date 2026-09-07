import { coverageMatrix } from './coverage-matrix.js'
import { compileOrder } from './compile.js'
import type { WorkOrder } from './schema.js'

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
  const result = compileOrder(order)
  const lines: string[] = []

  lines.push(`# ${order.title}`, '')
  lines.push(
    `**${order.id}** · ${order.status} · risk ${order.risk.grade} · recipe ${order.recipe ?? 'not chosen'}`
  )
  if (order.source.kind === 'tracker' && order.source.key !== null) {
    lines.push(`Source: ${order.source.tracker} ${order.source.key}`)
  }
  lines.push('')

  lines.push('## Intent', '')
  lines.push(`**Problem.** ${order.intent.problem || '_not stated_'}`, '')
  lines.push(`**Outcome.** ${order.intent.outcome || '_not stated_'}`, '')
  if (order.intent.nonGoals.length > 0) {
    lines.push('**Deliberately not doing:**', '')
    for (const goal of order.intent.nonGoals) lines.push(`- ${goal}`)
    lines.push('')
  }

  lines.push('## Done means', '')
  if (order.acceptance.length === 0) {
    lines.push('_No criteria yet._', '')
  } else {
    for (const criterion of order.acceptance) {
      lines.push(`- **${criterion.id}** (${criterion.priority}) ${criterion.statement}`)
      lines.push(`  - ${verifyLine(order, criterion.id)}`)
    }
    lines.push('')
  }

  lines.push('## Plan', '')
  if (order.plan.units.length === 0) {
    lines.push('_No units yet._', '')
  } else {
    for (const unit of order.plan.units) {
      const waits = unit.dependsOn.length > 0 ? ` · after ${unit.dependsOn.join(', ')}` : ''
      lines.push(
        `- **${unit.id}** ${unit.title} — ${unit.role}, lane ${unit.lane}${waits} · satisfies ${unit.satisfies.join(', ') || '_nothing_'}`
      )
      if (unit.touches.length > 0) lines.push(`  - touches: ${unit.touches.join(', ')}`)
    }
    lines.push('')
  }

  lines.push('## Coverage', '')
  lines.push(...coverageTable(order), '')

  const live = order.assumptions.filter((a) => !a.struck)
  if (live.length > 0) {
    lines.push('## Assumptions', '')
    for (const assumption of live) lines.push(`- ${assumption.text}`)
    lines.push('')
  }

  const open = order.openQuestions.filter((q) => q.answer === null)
  if (open.length > 0) {
    lines.push('## Open questions', '')
    for (const question of open) lines.push(`- ${question.text}`)
    lines.push('')
  }

  const unresolved = order.redTeam.filter((f) => f.status === 'open')
  if (unresolved.length > 0) {
    lines.push('## Red team', '')
    for (const finding of unresolved) lines.push(`- **${finding.id}** ${finding.text}`)
    lines.push('')
  }

  lines.push('## Budgets', '')
  lines.push(
    `${order.budgets.agents} agents · ${order.budgets.wallClockMinutes} minutes · ${order.budgets.filesTouched} files · tokens ${order.budgets.tokens ?? 'uncapped'}`,
    ''
  )

  lines.push('## Convergence', '')
  if (result.ok) {
    lines.push('All six checks pass. This order can be handed off.', '')
  } else {
    for (const failure of result.failures) {
      lines.push(`- **${failure.check}** — ${failure.detail}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
