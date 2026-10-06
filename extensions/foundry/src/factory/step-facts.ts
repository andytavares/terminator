import { gateNodeId } from './events.js'
import { tallyChecks } from './ci-tally.js'
import { joinedWords } from './signs.js'
import type { Gate } from '../gates/rules.js'
import type { Check } from '../line/ci.js'
import type { RunGraph, RunNode } from '../line/run-graph.js'

// What a step with no agent has to show on its monitor: there is no
// transcript, so the monitor says what the step decided instead.

export interface StepFactsInput {
  readonly node: Pick<RunNode, 'id' | 'kind' | 'state' | 'dependsOn'>
  readonly graph: RunGraph
  readonly labels: Readonly<Record<string, string>>
  /** The pull requests the run opened. Absent while the observation does not carry them. */
  readonly pulls?: readonly { readonly number: number }[]
  readonly ci: {
    readonly pulls: readonly { readonly checks: readonly Pick<Check, 'bucket'>[] }[]
  } | null
  readonly waiting: readonly Gate[]
}

/** Lines for a gate or a join; null for a step an agent works, which has a transcript. */
export function stepFacts(input: StepFactsInput): string[] | null {
  const { node, graph, labels } = input
  if (node.kind === 'join') {
    const names = joinedWords(node.dependsOn.map((id) => labels[id] ?? id))
    const done = node.state === 'passed' || node.state === 'skipped'
    return [`${done ? 'Joined' : 'Joins'} ${names}`]
  }
  if (node.kind !== 'gate') return null

  const facts: string[] = []
  for (const pull of input.pulls ?? []) facts.push(`Draft opened · #${pull.number}`)
  const checks = (input.ci?.pulls ?? []).flatMap((pull) => pull.checks.map((c) => c.bucket))
  const tally = tallyChecks(checks)
  if (tally.total > 0) facts.push(`Checks · ${tally.passed} of ${tally.total} passed`)
  for (const gate of input.waiting) {
    if (gateNodeId(gate, graph) !== node.id) continue
    facts.push(
      gate.rule === 'ready-for-review'
        ? 'Waiting on you · mark ready?'
        : `Waiting on you · ${gate.summary}`
    )
  }
  return facts
}
