import { CHECK_NAMES } from '../verify/toolchain-probe.js'
import { amendOrder } from '../order/amend.js'
import type { WorkOrder } from '../order/schema.js'

// The adversarial pass.
//
// It reads the order and nothing else — never the intake conversation. A
// reviewer who watched the draft being justified has already been persuaded by
// it, and the whole point is a reader with no stake in the draft.
//
// This module is the deterministic half: structural attacks that need no model,
// never disagree with themselves, and cost nothing to run on every turn. An
// agent pass adds judgement on top of these; it does not replace them.

export interface Finding {
  readonly rule: string
  readonly severity: 'low' | 'medium' | 'high'
  readonly text: string
  readonly subjectIds: readonly string[]
}

/** Words that promise an improvement without saying how anyone would know. */
const VAGUE = /\b(better|nicer|improved?|cleaner|faster|more robust|works? well|good|properly)\b/i

/** Files that are how software ships rather than what it does. */
const RELEASE_MACHINERY =
  /(^|\/)(\.github\/workflows|\.circleci|Jenkinsfile|release|publish|deploy)/i

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function structuralFindings(order: WorkOrder): Finding[] {
  const findings: Finding[] = []

  if (
    normalise(order.intent.problem) !== '' &&
    normalise(order.intent.problem) === normalise(order.intent.outcome)
  ) {
    findings.push({
      rule: 'outcome-restates-problem',
      severity: 'medium',
      text: 'The outcome repeats the problem back. Say what will be observably different, not that the problem will be gone.',
      subjectIds: [order.id],
    })
  }

  if (order.intent.nonGoals.length === 0) {
    findings.push({
      rule: 'no-non-goals',
      severity: 'low',
      text: 'The order excludes nothing. An order with no boundary is one an agent can widen without contradicting it.',
      subjectIds: [order.id],
    })
  }

  const vague = order.acceptance.filter((c) => VAGUE.test(c.statement))
  if (vague.length > 0) {
    findings.push({
      rule: 'unfalsifiable-statement',
      severity: 'high',
      text: 'A criterion promises an improvement without saying how anyone would know. Give it a statement that can be false.',
      subjectIds: vague.map((c) => c.id),
    })
  }

  // A P0 criterion decided only by judgement has no exit status behind it, and
  // the most important thing in the order then rests on an opinion.
  const judgedP0 = order.acceptance.filter(
    (c) => c.priority === 'P0' && (c.verify.kind === 'judge' || c.verify.kind === 'screenshot')
  )
  if (judgedP0.length > 0) {
    findings.push({
      rule: 'p0-judged-not-run',
      severity: 'high',
      text: 'The highest-priority criterion is proved only by judgement. Give it something with an exit status as well.',
      subjectIds: judgedP0.map((c) => c.id),
    })
  }

  const touchless = order.plan.units.filter((u) => u.touches.length === 0)
  if (touchless.length > 0) {
    findings.push({
      rule: 'unit-touches-nothing',
      severity: 'medium',
      text: 'A unit declares no files. Nothing can predict its collisions, and the risk grade cannot see it.',
      subjectIds: touchless.map((u) => u.id),
    })
  }

  // Every unit waiting on the one before it means nothing runs in parallel and
  // the agent budget buys nothing. Worth challenging past a few units.
  if (order.plan.units.length >= 3) {
    const independent = order.plan.units.filter((u) => u.dependsOn.length === 0)
    if (independent.length === 1) {
      findings.push({
        rule: 'fully-serial-plan',
        severity: 'low',
        text: 'Every unit waits on the one before it, so nothing runs in parallel. Check the dependencies are real.',
        subjectIds: order.plan.units.map((u) => u.id),
      })
    }
  }

  const release = order.plan.units.filter((u) => u.touches.some((p) => RELEASE_MACHINERY.test(p)))
  if (release.length > 0) {
    findings.push({
      rule: 'touches-release-machinery',
      severity: 'high',
      text: 'A unit changes how the project ships, not what it does. That is rarely what the order asked for.',
      subjectIds: release.map((u) => u.id),
    })
  }

  if (CHECK_NAMES.every((name) => order.context.toolchain[name] === null)) {
    findings.push({
      rule: 'no-runnable-check',
      severity: 'high',
      text: 'This repository has no command for any check. Nothing here can be proved by running it — decide that deliberately before starting.',
      subjectIds: [order.id],
    })
  }

  return findings
}

/**
 * Fold this pass's findings into the order.
 *
 * An order that gains a finding goes back to draft: findings are exactly as
 * binding as the six checks, and one raised after agreement gets no quieter
 * path for having arrived late. An order the pass finds nothing wrong with is
 * left alone — reopening it for nothing would make the pass a tax.
 */
export function applyFindings(order: WorkOrder, at: string): WorkOrder {
  const already = new Set(order.redTeam.map((f) => f.id))
  const fresh = structuralFindings(order)
    .map((finding, index) => ({
      id: `RT-${finding.rule}`,
      severity: finding.severity,
      text: finding.text,
      status: 'open' as const,
      reason: '',
      index,
    }))
    .filter((f) => !already.has(f.id))
    .map(({ index: _index, ...f }) => f)

  if (fresh.length === 0) return order

  // Through the amendment path rather than reopening the order by hand: a
  // finding is exactly as binding as the six checks, so it has to leave the
  // same trace as any other change to an agreed order.
  return amendOrder(order, {
    reason: `red team raised ${fresh.map((f) => f.id).join(', ')}`,
    at,
    change: (o) => ({ ...o, redTeam: [...o.redTeam, ...fresh] }),
  })
}

export function resolveFinding(order: WorkOrder, id: string): WorkOrder {
  return {
    ...order,
    redTeam: order.redTeam.map((f) => (f.id === id ? { ...f, status: 'resolved' as const } : f)),
  }
}

/**
 * Accepting a finding costs a written reason.
 *
 * Without one it stays open — an accepted finding with no reason is a shrug,
 * and the compile check would refuse it anyway.
 */
export function acceptFinding(order: WorkOrder, id: string, reason: string): WorkOrder {
  if (reason.trim() === '') return order
  return {
    ...order,
    redTeam: order.redTeam.map((f) =>
      f.id === id ? { ...f, status: 'accepted' as const, reason: reason.trim() } : f
    ),
  }
}
