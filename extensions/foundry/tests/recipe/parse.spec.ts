import { describe, it, expect } from 'vitest'
import { parseRecipe, parseRole, parseRule, RECIPE_SCHEMA_VERSION } from '../../src/recipe/parse.js'

// Recipes, roles and rules are the extension point: hand-authored YAML, loaded
// from the operator's data directory, from the target repository, or from the
// built-ins. A malformed one is reported by path and excluded — it never takes
// the surface down with it, the same reasoning the existing workitem reader
// already applies to agent-written JSON.

const RECIPE = `
schemaVersion: ${RECIPE_SCHEMA_VERSION}
id: bugfix
description: Reproduce first, then fix.
requires:
  - toolchain: test
steps:
  - id: reproduce
    kind: agent
    role: builder
    expect: { suite_exit_code: '!= 0' }
  - id: fix
    kind: fanout
    over: plan.units[role=builder]
    after: [reproduce]
    step: { kind: agent, role: builder }
  - id: ship
    kind: gate
    rule: ready-for-review
    options: [mark_ready, hold]
    defaultIfIgnored: hold
`

describe('parseRecipe', () => {
  it('parses a well-formed recipe', () => {
    const r = parseRecipe(RECIPE, 'bugfix.yaml')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.id).toBe('bugfix')
      expect(r.value.steps.map((s) => s.kind)).toEqual(['agent', 'fanout', 'gate'])
    }
  })

  it('requires the id to match the filename, so a name resolves to what it says', () => {
    const r = parseRecipe(RECIPE, 'direct.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/direct/)
  })

  it('reports malformed YAML by path instead of throwing', () => {
    const r = parseRecipe('id: [unclosed\n', 'broken.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('broken.yaml')
  })

  it('refuses a schema version newer than it knows', () => {
    const r = parseRecipe(
      RECIPE.replace(`schemaVersion: ${RECIPE_SCHEMA_VERSION}`, 'schemaVersion: 99'),
      'bugfix.yaml'
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/99/)
  })

  it('rejects a seventh step kind — the language is deliberately six', () => {
    const r = parseRecipe(
      RECIPE.replace(
        'kind: agent\n    role: builder\n    expect',
        'kind: loop\n    role: builder\n    expect'
      ),
      'bugfix.yaml'
    )
    expect(r.ok).toBe(false)
  })

  it('rejects duplicate step ids', () => {
    const r = parseRecipe(RECIPE.replace('id: fix', 'id: reproduce'), 'bugfix.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/reproduce/)
  })

  it('rejects an `after` naming a step that does not exist', () => {
    const r = parseRecipe(RECIPE.replace('after: [reproduce]', 'after: [nonesuch]'), 'bugfix.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/nonesuch/)
  })

  it('rejects a cycle in the step graph', () => {
    const cyclic = RECIPE.replace(
      '  - id: reproduce\n    kind: agent\n    role: builder\n',
      '  - id: reproduce\n    kind: agent\n    role: builder\n    after: [fix]\n'
    )
    const r = parseRecipe(cyclic, 'bugfix.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/cycle/i)
  })

  it('requires a gate step to declare what happens when it is ignored', () => {
    const r = parseRecipe(RECIPE.replace('    defaultIfIgnored: hold\n', ''), 'bugfix.yaml')
    expect(r.ok).toBe(false)
  })

  it('keeps requirements as declared, so an unmet one can hide the recipe', () => {
    const r = parseRecipe(RECIPE, 'bugfix.yaml')
    expect(r.ok && r.value.requires).toEqual([{ kind: 'toolchain', value: 'test' }])
  })

  it('reads a numeric requirement without losing it to the type', () => {
    const r = parseRecipe(RECIPE.replace('  - toolchain: test', '  - repos: 2'), 'bugfix.yaml')
    expect(r.ok && r.value.requires).toEqual([{ kind: 'repos', value: '2' }])
  })

  it('rejects YAML that is not a mapping at all', () => {
    const r = parseRecipe('- just\n- a list\n', 'bugfix.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/not a mapping/)
  })

  it('rejects a recipe with no steps — a shape of work with no steps is not one', () => {
    const r = parseRecipe(`schemaVersion: 1\nid: bugfix\nsteps: []\n`, 'bugfix.yaml')
    expect(r.ok).toBe(false)
  })

  // Each step kind carries its own obligation, and the message has to name the
  // step: a recipe file is edited by hand, so "something is wrong" is not help.
  it.each([
    ['agent', 'a role', 'kind: agent\n    role: builder', 'kind: agent'],
    ['run', 'a command', 'kind: agent\n    role: builder', 'kind: run'],
    ['judge', 'a rubric', 'kind: agent\n    role: builder', 'kind: judge'],
  ])('rejects a %s step with no %s', (_kind, _need, from, to) => {
    const r = parseRecipe(RECIPE.replace(from, to), 'bugfix.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/reproduce/)
  })

  it('rejects a fanout with nothing to fan out over', () => {
    const r = parseRecipe(RECIPE.replace('    over: plan.units[role=builder]\n', ''), 'bugfix.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/fix/)
  })

  it('rejects a gate with no rule', () => {
    const r = parseRecipe(RECIPE.replace('    rule: ready-for-review\n', ''), 'bugfix.yaml')
    expect(r.ok).toBe(false)
  })

  it('accepts a join, which needs only its order', () => {
    const r = parseRecipe(
      `schemaVersion: 1\nid: x\nsteps:\n  - id: integrate\n    kind: join\n    order: lane.ord\n`,
      'x.yaml'
    )
    expect(r.ok).toBe(true)
  })

  it('defaults a step with no `after` to waiting on nothing', () => {
    const r = parseRecipe(
      `schemaVersion: 1\nid: x\nsteps:\n  - id: a\n    kind: run\n    command: make\n`,
      'x.yaml'
    )
    expect(r.ok && r.value.steps[0].after).toEqual([])
  })

  it('accepts a .yml filename as readily as .yaml', () => {
    expect(parseRecipe(RECIPE, 'bugfix.yml').ok).toBe(true)
  })

  it('accepts a recipe that omits the version, treating it as the current one', () => {
    const r = parseRecipe(
      RECIPE.replace(`schemaVersion: ${RECIPE_SCHEMA_VERSION}\n`, ''),
      'bugfix.yaml'
    )
    expect(r.ok && r.value.schemaVersion).toBe(RECIPE_SCHEMA_VERSION)
  })
})

const ROLE = `
schemaVersion: ${RECIPE_SCHEMA_VERSION}
id: verifier
modelTier: deep
allowResume: false
reads: [unit.diff, unit.satisfies]
writes: []
tools: [read, run_tests]
outputSchema: verdict
prompt: You are checking work you did not do.
`

describe('parseRole', () => {
  it('parses a well-formed role', () => {
    const r = parseRole(ROLE, 'verifier.yaml')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.allowResume).toBe(false)
      expect(r.value.writes).toEqual([])
    }
  })

  it('defaults allowResume to false, so resuming is opt-in rather than inherited', () => {
    const r = parseRole(ROLE.replace('allowResume: false\n', ''), 'verifier.yaml')
    expect(r.ok && r.value.allowResume).toBe(false)
  })

  it('requires a prompt — a role with no contract is not a role', () => {
    const r = parseRole(
      ROLE.replace('prompt: You are checking work you did not do.\n', ''),
      'verifier.yaml'
    )
    expect(r.ok).toBe(false)
  })

  it('requires the id to match the filename', () => {
    const r = parseRole(ROLE, 'builder.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/verifier/)
  })

  it('reports malformed YAML by path', () => {
    const r = parseRole('id: [unclosed\n', 'verifier.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('verifier.yaml')
  })

  it('refuses a schema version newer than it knows', () => {
    const r = parseRole(
      ROLE.replace(`schemaVersion: ${RECIPE_SCHEMA_VERSION}`, 'schemaVersion: 99'),
      'verifier.yaml'
    )
    expect(r.ok).toBe(false)
  })

  it('defaults the model tier rather than leaving a role unschedulable', () => {
    const r = parseRole(ROLE.replace('modelTier: deep\n', ''), 'verifier.yaml')
    expect(r.ok && r.value.modelTier).toBe('deep')
  })

  it('rejects a model tier it does not have', () => {
    const r = parseRole(ROLE.replace('modelTier: deep', 'modelTier: enormous'), 'verifier.yaml')
    expect(r.ok).toBe(false)
  })
})

const RULE = `
schemaVersion: ${RECIPE_SCHEMA_VERSION}
id: exit-code-not-count
scope: universal
rung: L2
asserts: A test verdict comes from the command's exit status.
appliesWhen: always
origin: built-in
`

describe('parseRule', () => {
  it('parses a well-formed rule', () => {
    const r = parseRule(RULE, 'exit-code-not-count.yaml')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.scope).toBe('universal')
  })

  it('rejects a rung outside L0 to L6', () => {
    const r = parseRule(RULE.replace('rung: L2', 'rung: L9'), 'exit-code-not-count.yaml')
    expect(r.ok).toBe(false)
  })

  it('rejects a scope that is neither universal nor project', () => {
    const r = parseRule(
      RULE.replace('scope: universal', 'scope: personal'),
      'exit-code-not-count.yaml'
    )
    expect(r.ok).toBe(false)
  })

  it('keeps the origin, because a curator-proposed rule must cite what produced it', () => {
    const r = parseRule(
      RULE.replace('origin: built-in', 'origin: curator:L-1,L-2'),
      'exit-code-not-count.yaml'
    )
    expect(r.ok && r.value.origin).toBe('curator:L-1,L-2')
  })

  it('requires the id to match the filename', () => {
    const r = parseRule(RULE, 'something-else.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/exit-code-not-count/)
  })

  it('reports malformed YAML by path', () => {
    const r = parseRule('scope: [unclosed\n', 'exit-code-not-count.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('exit-code-not-count.yaml')
  })

  it('refuses a schema version newer than it knows', () => {
    const r = parseRule(
      RULE.replace(`schemaVersion: ${RECIPE_SCHEMA_VERSION}`, 'schemaVersion: 99'),
      'exit-code-not-count.yaml'
    )
    expect(r.ok).toBe(false)
  })

  it('requires something to assert — a rule that asserts nothing checks nothing', () => {
    const r = parseRule(RULE.replace(/asserts: .*\n/, 'asserts: ""\n'), 'exit-code-not-count.yaml')
    expect(r.ok).toBe(false)
  })

  it('defaults origin and appliesWhen so a hand-written rule needs only its substance', () => {
    const r = parseRule(`id: x\nscope: project\nrung: L5\nasserts: something is true\n`, 'x.yaml')
    expect(r.ok && r.value.origin).toBe('built-in')
    expect(r.ok && r.value.appliesWhen).toBe('always')
  })
})
