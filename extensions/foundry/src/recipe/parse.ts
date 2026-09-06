import * as path from 'node:path'
import { load } from 'js-yaml'
import { z } from 'zod'

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

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string }

function fail(file: string, message: string): { ok: false; reason: string } {
  return { ok: false, reason: `${file}: ${message}` }
}

function loadYaml(text: string, file: string): ParseResult<unknown> {
  try {
    return { ok: true, value: load(text) }
  } catch (error) {
    return fail(file, `could not be read as YAML — ${(error as Error).message}`)
  }
}

function checkVersion(value: unknown, file: string): { ok: false; reason: string } | null {
  // Arrays are objects, and a YAML list is a common hand-authoring slip. Say
  // what is wrong with the file rather than letting zod report a type mismatch
  // several levels down.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(file, 'is not a mapping')
  }
  const declared = (value as { schemaVersion?: unknown }).schemaVersion
  if (typeof declared === 'number' && declared > RECIPE_SCHEMA_VERSION) {
    return fail(
      file,
      `declares schema version ${declared}; this build knows version ${RECIPE_SCHEMA_VERSION}`
    )
  }
  return null
}

function idMatchesFile(id: string, file: string): boolean {
  return id === path.basename(file).replace(/\.ya?ml$/, '')
}

// ── recipes ──────────────────────────────────────────────────────────────

/**
 * Six step kinds, and there is no seventh.
 *
 * They exist because six concrete recipes need them, not in anticipation: fan
 * out over units, a barrier for lane merge order, a human decision, an agent
 * role, a shell command and a rubric judgement. A recipe that wants arbitrary
 * logic wants a role — a prompt and an output schema — not code in a data file.
 */
export const STEP_KINDS = ['agent', 'run', 'judge', 'gate', 'fanout', 'join'] as const
export type StepKind = (typeof STEP_KINDS)[number]

const StepSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(STEP_KINDS),
    after: z.array(z.string()).default([]),
    when: z.string().optional(),
    role: z.string().optional(),
    command: z.string().optional(),
    rubric: z.string().optional(),
    rule: z.string().optional(),
    options: z.array(z.string()).optional(),
    defaultIfIgnored: z.string().optional(),
    deadlineMinutes: z.number().int().optional(),
    over: z.string().optional(),
    step: z.record(z.string(), z.unknown()).optional(),
    order: z.string().optional(),
    expect: z.record(z.string(), z.unknown()).optional(),
    context: z.enum(['fresh', 'resume']).optional(),
    evidence: z.array(z.string()).optional(),
  })
  .superRefine((step, ctx) => {
    const need = (field: string): void => {
      ctx.addIssue({ code: 'custom', message: `step "${step.id}" (${step.kind}) needs ${field}` })
    }
    if (step.kind === 'agent' && step.role === undefined) need('a role')
    if (step.kind === 'run' && step.command === undefined) need('a command')
    if (step.kind === 'judge' && step.rubric === undefined) need('a rubric')
    if (step.kind === 'fanout' && (step.over === undefined || step.step === undefined)) {
      need('both `over` and `step`')
    }
    if (step.kind === 'gate') {
      if (step.rule === undefined) need('a rule')
      // A gate with no stated default is a gate that stops the line for ever
      // when nobody answers it. Saying what silence means is the contract.
      if (step.defaultIfIgnored === undefined) need('a defaultIfIgnored')
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
  const versionProblem = checkVersion(loaded.value, file)
  if (versionProblem !== null) return versionProblem

  const parsed = RecipeSchema.safeParse(loaded.value)
  if (!parsed.success) return fail(file, parsed.error.issues.map((i) => i.message).join('; '))
  const recipe = parsed.data

  // A name has to resolve to what it says it is, because resolution is by name
  // across three directories and a mismatch would silently shadow a built-in.
  if (!idMatchesFile(recipe.id, file)) {
    return fail(file, `declares id "${recipe.id}", which does not match the filename`)
  }

  const seen = new Set<string>()
  for (const step of recipe.steps) {
    if (seen.has(step.id)) return fail(file, `has more than one step called "${step.id}"`)
    seen.add(step.id)
  }
  for (const step of recipe.steps) {
    for (const after of step.after) {
      if (!seen.has(after)) {
        return fail(file, `step "${step.id}" waits on "${after}", which does not exist`)
      }
    }
  }
  const cycle = findCycle(recipe.steps)
  if (cycle !== null) return fail(file, `has a cycle in its step graph, through "${cycle}"`)

  return { ok: true, value: recipe }
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
  outputSchema: z.string().default(''),
  prompt: z.string().min(1),
})

export type Role = z.infer<typeof RoleSchema>

export function parseRole(text: string, file: string): ParseResult<Role> {
  const loaded = loadYaml(text, file)
  if (!loaded.ok) return loaded
  const versionProblem = checkVersion(loaded.value, file)
  if (versionProblem !== null) return versionProblem

  const parsed = RoleSchema.safeParse(loaded.value)
  if (!parsed.success) return fail(file, parsed.error.issues.map((i) => i.message).join('; '))
  if (!idMatchesFile(parsed.data.id, file)) {
    return fail(file, `declares id "${parsed.data.id}", which does not match the filename`)
  }
  return { ok: true, value: parsed.data }
}

// ── rules ────────────────────────────────────────────────────────────────

export const RUNGS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const
export type Rung = (typeof RUNGS)[number]

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
  const versionProblem = checkVersion(loaded.value, file)
  if (versionProblem !== null) return versionProblem

  const parsed = RuleSchema.safeParse(loaded.value)
  if (!parsed.success) return fail(file, parsed.error.issues.map((i) => i.message).join('; '))
  if (!idMatchesFile(parsed.data.id, file)) {
    return fail(file, `declares id "${parsed.data.id}", which does not match the filename`)
  }
  return { ok: true, value: parsed.data }
}
