import { z } from 'zod'
import { checkVersion, fail, idMatchesFile, loadYaml, type ParseResult } from './yaml-file.js'

export type { ParseResult } from './yaml-file.js'

// Recipes, roles and rules: the extension point.
//
// YAML rather than JSON for one reason that matters — these are hand-authored,
// and a rules file exists to carry the *why* of a check. JSON cannot hold a
// comment, so it is the wrong format for the one kind of file whose reasoning
// is the point. `load` is js-yaml's safe schema; it constructs no arbitrary
// types, and everything it returns goes through zod regardless.
//
// Nothing here throws. A malformed file is reported by path and excluded, so
// one bad file in the operator's directory cannot take the whole surface down.

export const RECIPE_SCHEMA_VERSION = 1

// A skill id becomes a directory name — `<dir>/skills/<id>/SKILL.md` — so it
// is held to the shape a directory name can take, not the looser rule for a
// recipe or role id.
const SKILL_ID = /^[a-z0-9][a-z0-9-]*$/

function badSkillIds(ids: readonly string[]): string[] {
  return ids.filter((id) => !SKILL_ID.test(id))
}

// ── recipes ──────────────────────────────────────────────────────────────

/**
 * Five step kinds, and there is no sixth.
 *
 * They exist because concrete recipes need them, not in anticipation: fan out
 * over units, a barrier for lane merge order, a human decision, an agent role
 * and a shell command. A recipe that wants arbitrary logic wants a role — a
 * prompt and an output schema — not code in a data file.
 */
export const STEP_KINDS = ['agent', 'run', 'gate', 'fanout', 'join'] as const
export type StepKind = (typeof STEP_KINDS)[number]

/**
 * How hard an agent works, as `claude --effort` takes it.
 *
 * A property of the shape of the work, so it lives on the recipe and every
 * agent step inherits it; a step may say otherwise for itself. Nothing here
 * chooses a default: a recipe that declares none launches at whatever the
 * operator's own runtime configuration says.
 */
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

/** The fields a step must declare for its kind. */
interface StepFields {
  readonly kind: string
  readonly role?: unknown
  readonly command?: unknown
  readonly over?: unknown
  readonly step?: unknown
  readonly rule?: unknown
  readonly defaultIfIgnored?: unknown
}

/** What a step of its kind needs and does not declare, in words. */
function missingFor(step: StepFields): string[] {
  switch (step.kind) {
    case 'agent':
      return step.role === undefined ? ['a role'] : []
    case 'run':
      return step.command === undefined ? ['a command'] : []
    case 'fanout':
      return step.over === undefined || step.step === undefined ? ['both `over` and `step`'] : []
    case 'gate':
      return missingForGate(step)
    default:
      return []
  }
}

function missingForGate(step: StepFields): string[] {
  const missing = step.rule === undefined ? ['a rule'] : []
  // A gate with no stated default is a gate that stops the line for ever when
  // nobody answers it. Saying what silence means is the contract.
  return step.defaultIfIgnored === undefined ? [...missing, 'a defaultIfIgnored'] : missing
}

const StepSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(STEP_KINDS),
    after: z.array(z.string()).default([]),
    when: z.string().optional(),
    role: z.string().optional(),
    command: z.string().optional(),
    rule: z.string().optional(),
    options: z.array(z.string()).optional(),
    defaultIfIgnored: z.string().optional(),
    deadlineMinutes: z.number().int().optional(),
    over: z.string().optional(),
    step: z.record(z.string(), z.unknown()).optional(),
    order: z.string().optional(),
    expect: z.record(z.string(), z.unknown()).optional(),
    context: z.enum(['fresh', 'resume']).optional(),
    effort: z.enum(EFFORT_LEVELS).optional(),
    // Mounted for this step's agent the way Claude Code loads a skill: a
    // directory per id, passed with `--add-dir`. Optional, because most steps
    // need none — a step declaring one is opting into something extra.
    skills: z.array(z.string().min(1)).optional(),
    onFail: z
      .strictObject({
        rework: z.string().min(1),
        max: z.number().int().min(1).max(3),
      })
      .optional(),
  })
  .superRefine((step, ctx) => {
    for (const field of missingFor(step)) {
      ctx.addIssue({ code: 'custom', message: `step "${step.id}" (${step.kind}) needs ${field}` })
    }
  })

const RequirementSchema = z
  .record(z.string(), z.union([z.string(), z.number()]))
  .transform((raw) => {
    const [kind, value] = Object.entries(raw)[0]
    return { kind, value: String(value) }
  })

const RecipeSchema = z.object({
  schemaVersion: z.number().int().default(RECIPE_SCHEMA_VERSION),
  id: z.string().min(1),
  description: z.string().default(''),
  requires: z.array(RequirementSchema).default([]),
  effort: z.enum(EFFORT_LEVELS).optional(),
  // CI is watched on the draft a `ready-for-review` gate opens. A shape that
  // never opens one has no draft to watch, so a recipe declaring `ci` with no
  // such gate is refused by parseRecipe rather than silently doing nothing.
  ci: z.strictObject({ rounds: z.number().int().min(1).max(3) }).optional(),
  steps: z.array(StepSchema).min(1),
})

export type Recipe = z.infer<typeof RecipeSchema>
export type Step = z.infer<typeof StepSchema>
export type Requirement = { kind: string; value: string }

/** Depth-first cycle detection over `after`. Returns the offending id, or null. */
function findCycle(steps: readonly Step[]): string | null {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const state = new Map<string, 'visiting' | 'done'>()

  const walk = (id: string): string | null => {
    const mark = state.get(id)
    if (mark === 'done') return null
    if (mark === 'visiting') return id
    state.set(id, 'visiting')
    for (const next of byId.get(id)?.after ?? []) {
      const found = walk(next)
      if (found !== null) return found
    }
    state.set(id, 'done')
    return null
  }

  for (const step of steps) {
    const found = walk(step.id)
    if (found !== null) return found
  }
  return null
}

export function parseRecipe(text: string, file: string): ParseResult<Recipe> {
  const loaded = loadYaml(text, file)
  if (!loaded.ok) return loaded
  const versionProblem = checkVersion(loaded.value, file, RECIPE_SCHEMA_VERSION)
  if (versionProblem !== null) return versionProblem

  const parsed = RecipeSchema.safeParse(loaded.value)
  if (!parsed.success) return fail(file, parsed.error.issues.map((i) => i.message).join('; '))
  const recipe = parsed.data

  // A name has to resolve to what it says it is, because resolution is by name
  // across three directories and a mismatch would silently shadow a built-in.
  if (!idMatchesFile(recipe.id, file)) {
    return fail(file, `declares id "${recipe.id}", which does not match the filename`)
  }

  const problem = stepGraphProblem(recipe.steps)
  if (problem !== null) return fail(file, problem)
  const onFailProblem = checkOnFail(recipe.steps, file)
  if (onFailProblem !== null) return onFailProblem
  const ci = ciProblem(recipe)
  return ci === null ? { ok: true, value: recipe } : fail(file, ci)
}

/** The first thing wrong with how the steps name and wait on each other, in words. */
function stepGraphProblem(steps: readonly Step[]): string | null {
  return duplicateStep(steps) ?? unknownWait(steps) ?? badSkill(steps) ?? cycleIn(steps)
}

function duplicateStep(steps: readonly Step[]): string | null {
  const seen = new Set<string>()
  for (const step of steps) {
    if (seen.has(step.id)) return `has more than one step called "${step.id}"`
    seen.add(step.id)
  }
  return null
}

function unknownWait(steps: readonly Step[]): string | null {
  const ids = new Set(steps.map((step) => step.id))
  for (const step of steps) {
    const missing = step.after.find((after) => !ids.has(after))
    if (missing !== undefined) {
      return `step "${step.id}" waits on "${missing}", which does not exist`
    }
  }
  return null
}

function badSkill(steps: readonly Step[]): string | null {
  for (const step of steps) {
    const bad = badSkillIds(step.skills ?? [])
    if (bad.length > 0)
      return `step "${step.id}" names skill "${bad[0]}", which is not a valid skill id`
  }
  return null
}

function cycleIn(steps: readonly Step[]): string | null {
  const cycle = findCycle(steps)
  return cycle === null ? null : `has a cycle in its step graph, through "${cycle}"`
}

/** A recipe that declares ci needs a ready-for-review gate to open the draft CI watches. */
function ciProblem(recipe: Recipe): string | null {
  if (recipe.ci === undefined) return null
  const opensADraft = recipe.steps.some(
    (step) => step.kind === 'gate' && step.rule === 'ready-for-review'
  )
  return opensADraft
    ? null
    : 'declares ci, but opens no ready-for-review gate — there is no draft for CI to watch'
}

/** Every id reachable by walking `after`, transitively — a step's upstream. */
function upstreamOf(id: string, byId: Map<string, Step>): Set<string> {
  const seen = new Set<string>()
  const walk = (current: string): void => {
    for (const next of byId.get(current)?.after ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      walk(next)
    }
  }
  walk(id)
  return seen
}

function checkOnFail(steps: readonly Step[], file: string): { ok: false; reason: string } | null {
  const byId = new Map(steps.map((s) => [s.id, s]))
  for (const step of steps) {
    if (step.onFail === undefined) continue
    if (step.kind !== 'run') {
      return fail(
        file,
        `step "${step.id}" has onFail, but only a command step can fail on its own today`
      )
    }
    const target = byId.get(step.onFail.rework)
    const upstream = upstreamOf(step.id, byId)
    if (target === undefined || !upstream.has(target.id)) {
      return fail(
        file,
        `step "${step.id}" has onFail.rework "${step.onFail.rework}", which is not upstream of it`
      )
    }
    if (target.kind !== 'agent' && target.kind !== 'fanout') {
      return fail(
        file,
        `step "${step.id}" has onFail.rework "${target.id}", but only an agent or fanout step can rework`
      )
    }
  }
  return null
}

// ── roles ────────────────────────────────────────────────────────────────

const RoleSchema = z.object({
  schemaVersion: z.number().int().default(RECIPE_SCHEMA_VERSION),
  id: z.string().min(1),
  modelTier: z.enum(['fast', 'deep']).default('deep'),
  // Default false, so resuming a conversation is something a role opts into
  // rather than inherits. The verifier's fresh context is enforced here rather
  // than asked for in a prompt.
  allowResume: z.boolean().default(false),
  reads: z.array(z.string()).default([]),
  writes: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  // Mounted for every agent launched with this role, the way Claude Code
  // loads a skill: a directory per id, passed with `--add-dir`.
  skills: z.array(z.string().min(1)).default([]),
  prompt: z.string().min(1),
})

export type Role = z.infer<typeof RoleSchema>

export function parseRole(text: string, file: string): ParseResult<Role> {
  const loaded = loadYaml(text, file)
  if (!loaded.ok) return loaded
  const versionProblem = checkVersion(loaded.value, file, RECIPE_SCHEMA_VERSION)
  if (versionProblem !== null) return versionProblem

  const parsed = RoleSchema.safeParse(loaded.value)
  if (!parsed.success) return fail(file, parsed.error.issues.map((i) => i.message).join('; '))
  if (!idMatchesFile(parsed.data.id, file)) {
    return fail(file, `declares id "${parsed.data.id}", which does not match the filename`)
  }
  const bad = badSkillIds(parsed.data.skills)
  if (bad.length > 0) {
    return fail(
      file,
      `role "${parsed.data.id}" names skill "${bad[0]}", which is not a valid skill id`
    )
  }
  return { ok: true, value: parsed.data }
}

// ── rules ────────────────────────────────────────────────────────────────

const RUNGS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const

const RuleSchema = z.object({
  schemaVersion: z.number().int().default(RECIPE_SCHEMA_VERSION),
  id: z.string().min(1),
  // Universal rules ship with the tool and hold everywhere; project rules load
  // only where the repository carries what they depend on.
  scope: z.enum(['universal', 'project']),
  rung: z.enum(RUNGS),
  asserts: z.string().min(1),
  appliesWhen: z.string().default('always'),
  // Provenance. A curator-proposed rule carries the ledger entries that
  // produced it, so it can be judged later on whether it was worth adding.
  origin: z.string().default('built-in'),
})

export type Rule = z.infer<typeof RuleSchema>

export function parseRule(text: string, file: string): ParseResult<Rule> {
  const loaded = loadYaml(text, file)
  if (!loaded.ok) return loaded
  const versionProblem = checkVersion(loaded.value, file, RECIPE_SCHEMA_VERSION)
  if (versionProblem !== null) return versionProblem

  const parsed = RuleSchema.safeParse(loaded.value)
  if (!parsed.success) return fail(file, parsed.error.issues.map((i) => i.message).join('; '))
  if (!idMatchesFile(parsed.data.id, file)) {
    return fail(file, `declares id "${parsed.data.id}", which does not match the filename`)
  }
  return { ok: true, value: parsed.data }
}
