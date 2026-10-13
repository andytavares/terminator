import { stepFor, unitsOf } from './run-graph.js'
import type { RunNode } from './run-graph.js'
import type { CommitOutcome } from './commit.js'
import type { RoleRegistry } from './roles.js'
import { brief } from './brief.js'
import type { Recipe, Rule, Step } from '../recipe/parse.js'
import type { WorkOrder } from '../order/schema.js'
import { GATE_RULES } from '../gates/rules.js'
import type { GateRuleId } from '../gates/rules.js'

// The small pieces a run is put together from: names, messages and the brief
// a node's agent is launched with. Pure, so each is the same answer wherever
// the executor asks for it.

/**
 * Whether this shape of work ends in a pull request at all.
 *
 * A recipe that is a question, not a change, opens nothing (FR-019), and says
 * so by having no ship step rather than by a flag. A caller that shipped
 * regardless would turn every investigation into a branch.
 */
export function opensPullRequest(recipe: Recipe): boolean {
  return recipe.steps.some((step) => step.kind === 'gate' && step.rule === 'ready-for-review')
}

/** Whether a recipe named a rule this build knows. */
export function isGateRule(value: unknown): value is GateRuleId {
  return typeof value === 'string' && (GATE_RULES as readonly string[]).includes(value)
}

/** A node id, made safe to use as a filename. */
export function safeFilename(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_')
}

/** A step's own `skills:`, plus its inner step's for a fan-out. */
function stepSkillsOf(step: Step): readonly string[] {
  const own = step.skills ?? []
  if (step.kind !== 'fanout') return own
  const inner = (step.step ?? {}) as { skills?: unknown }
  const innerSkills = Array.isArray(inner.skills)
    ? inner.skills.filter((id): id is string => typeof id === 'string')
    : []
  return [...own, ...innerSkills]
}

/**
 * Which skills a node's agent gets: the union of its role's and its step's,
 * de-duplicated.
 *
 * A fan-out's inner `step:` may carry its own `skills:` alongside the outer
 * step's, the way `wantsFreshContext` reads `context` off the same object —
 * so both are read here rather than only the one a plain step has.
 */
export function skillsFor(recipe: Recipe, node: RunNode, roles: RoleRegistry): string[] {
  const step = stepFor(recipe, node)
  const role = node.role === null ? null : roles.get(node.role)
  const roleSkills = role?.skills ?? []
  const stepSkills = step === undefined ? [] : stepSkillsOf(step)
  return [...new Set([...roleSkills, ...stepSkills])]
}

/** What a node's commit says: its step, then the units it built or the step again. */
export function commitMessage(node: RunNode, order: WorkOrder): string {
  const titles = unitsOf(order, node).map((unit) => unit.title)
  return `${node.stepId}: ${titles.length === 0 ? node.stepId : titles.join(', ')}`
}

export function refusedReason(refusal: Extract<CommitOutcome, { kind: 'refused' }>): string {
  return `changed the checkout, but \`${refusal.command}\` ${refusal.exitCode === null ? 'did not finish' : `exited ${refusal.exitCode}`}`
}

/** The tail of a log, for a feedback excerpt — never the whole thing. */
export function lastLines(text: string, count: number): string {
  return text.split('\n').slice(-count).join('\n')
}

/** What a brief is written from: the order as later briefs see it, and what governs the run. */
export interface BriefSource {
  readonly order: WorkOrder
  readonly recipe: Recipe
  readonly roles: RoleRegistry
  readonly rules: readonly Rule[]
}

/**
 * What this node's agent is told.
 *
 * The role's prompt plus whatever that role declared it may read, resolved
 * against this order and this unit. The bare prompt on its own describes a
 * job and names no work, which is every "it built the wrong thing" failure.
 */
export function promptFor(
  source: BriefSource,
  node: RunNode,
  files: { outputPath: string | null; outputsDir: string | null }
): string {
  const { order, recipe, roles, rules } = source
  const step = stepFor(recipe, node)
  if (step === undefined) return ''
  return brief({
    order,
    role: node.role === null ? null : roles.get(node.role),
    units: unitsOf(order, node),
    rules,
    command: step.kind === 'run' ? (step.command ?? '') : undefined,
    outputPath: files.outputPath ?? undefined,
    outputsDir: files.outputsDir ?? undefined,
    feedback: node.feedback,
  })
}
