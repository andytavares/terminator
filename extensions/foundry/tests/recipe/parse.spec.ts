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

  it('leaves a step with no declared skills undefined, not defaulted to a list', () => {
    const r = parseRecipe(RECIPE, 'bugfix.yaml')
    expect(r.ok && r.value.steps[0].skills).toBeUndefined()
  })

  it('carries the skills a step declares', () => {
    const r = parseRecipe(
      RECIPE.replace(
        '    role: builder\n    expect',
        '    role: builder\n    skills: [ci-fix]\n    expect'
      ),
      'bugfix.yaml'
    )
    expect(r.ok && r.value.steps[0].skills).toEqual(['ci-fix'])
  })

  it('refuses a step skill id that could not be a directory name, and names the step', () => {
    const r = parseRecipe(
      RECIPE.replace(
        '    role: builder\n    expect',
        '    role: builder\n    skills: [Not Valid!]\n    expect'
      ),
      'bugfix.yaml'
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/reproduce/)
      expect(r.reason).toMatch(/Not Valid!/)
    }
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

  // Unknown keys are stripped rather than refused, which is what lets a role
  // file written against an older schema keep loading — `outputSchema` named
  // nine shapes and nothing validated any of them, and its removal must not
  // break a role file that still carries it.
  it('ignores a key the schema no longer has, rather than refusing the file', () => {
    const r = parseRole(`${ROLE}outputSchema: verdict\n`, 'verifier.yaml')
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
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

  it('defaults skills to an empty list', () => {
    const r = parseRole(ROLE, 'verifier.yaml')
    expect(r.ok && r.value.skills).toEqual([])
  })

  it('carries the skills a role declares', () => {
    const r = parseRole(`${ROLE}skills: [ci-fix]\n`, 'verifier.yaml')
    expect(r.ok && r.value.skills).toEqual(['ci-fix'])
  })

  it('refuses a skill id that could not be a directory name, and names the role', () => {
    const r = parseRole(`${ROLE}skills: [Not Valid!]\n`, 'verifier.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/verifier/)
      expect(r.reason).toMatch(/Not Valid!/)
    }
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

// `onFail` is a rework loop: a command step that fails sends the run back to
// an earlier step rather than stopping the line. It only makes sense pointing
// backward, at a step that can actually redo work.
describe('onFail', () => {
  const ONFAIL = `
schemaVersion: 1
id: onfail
steps:
  - id: build
    kind: agent
    role: builder
  - id: sibling
    kind: agent
    role: builder
  - id: gatecheck
    kind: gate
    rule: proceed
    defaultIfIgnored: hold
    after: [build]
  - id: verify
    kind: run
    command: npm test
    after: [gatecheck]
    onFail: { rework: build, max: 2 }
  - id: ship
    kind: gate
    rule: ready
    defaultIfIgnored: hold
    after: [verify]
`

  it('accepts onFail on a valid run step reworking an upstream agent step', () => {
    const r = parseRecipe(ONFAIL, 'onfail.yaml')
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
  })

  it('rejects onFail reworking a downstream step', () => {
    const r = parseRecipe(ONFAIL.replace('rework: build', 'rework: ship'), 'onfail.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/verify/)
  })

  it('rejects onFail reworking a step that is not upstream at all', () => {
    const r = parseRecipe(ONFAIL.replace('rework: build', 'rework: sibling'), 'onfail.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/verify/)
  })

  it('rejects onFail reworking a gate — only an agent or fanout can redo work', () => {
    const r = parseRecipe(ONFAIL.replace('rework: build', 'rework: gatecheck'), 'onfail.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/verify/)
  })

  it('rejects a max below 1', () => {
    const r = parseRecipe(ONFAIL.replace('max: 2', 'max: 0'), 'onfail.yaml')
    expect(r.ok).toBe(false)
  })

  it('rejects a max above 3', () => {
    const r = parseRecipe(ONFAIL.replace('max: 2', 'max: 4'), 'onfail.yaml')
    expect(r.ok).toBe(false)
  })

  it('rejects onFail on a step whose kind is not run — only a command step can fail on its own today', () => {
    const r = parseRecipe(
      ONFAIL.replace(
        '  - id: build\n    kind: agent\n    role: builder\n',
        '  - id: build\n    kind: agent\n    role: builder\n    onFail: { rework: sibling, max: 1 }\n'
      ),
      'onfail.yaml'
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/build/)
  })
})

// Effort is how hard the agent works, and it is a property of the shape of
// the work: a one-lane P3 change and a cross-cutting refactor should not think
// equally hard. A recipe sets it for every agent step; a step may say
// otherwise for itself.
describe('effort on a recipe and on a step', () => {
  const EFFORT = `
schemaVersion: 1
id: direct
effort: xhigh
steps:
  - id: build
    kind: fanout
    over: plan.units by lane
    step: { kind: agent, role: builder }
  - id: document
    kind: agent
    role: scribe
    effort: medium
    after: [build]
`

  it('parses a recipe-level effort', () => {
    const r = parseRecipe(EFFORT, 'direct.yaml')
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    if (r.ok) expect(r.value.effort).toBe('xhigh')
  })

  it('parses a step-level effort', () => {
    const r = parseRecipe(EFFORT, 'direct.yaml')
    if (r.ok) expect(r.value.steps.find((s) => s.id === 'document')?.effort).toBe('medium')
  })

  it('leaves effort undefined where nothing declared one', () => {
    const r = parseRecipe(RECIPE, 'bugfix.yaml')
    if (r.ok) {
      expect(r.value.effort).toBeUndefined()
      expect(r.value.steps.every((s) => s.effort === undefined)).toBe(true)
    }
  })

  it('refuses an effort the runtime does not have, by file', () => {
    const r = parseRecipe(EFFORT.replace('effort: xhigh', 'effort: extreme'), 'direct.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/^direct\.yaml: /)
  })
})

// CI is watched on the draft a `ready-for-review` gate opens. A recipe that
// never opens one has no draft for CI to watch, so `ci` without that gate is
// refused rather than silently doing nothing.
describe('ci rounds', () => {
  it('accepts a recipe that declares ci alongside a ready-for-review gate', () => {
    const r = parseRecipe(`ci:\n  rounds: 2\n${RECIPE}`, 'bugfix.yaml')
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    if (r.ok) expect(r.value.ci).toEqual({ rounds: 2 })
  })

  it('leaves ci undefined where nothing declared it', () => {
    const r = parseRecipe(RECIPE, 'bugfix.yaml')
    if (r.ok) expect(r.value.ci).toBeUndefined()
  })

  it('rejects a rounds of 0', () => {
    const r = parseRecipe(`ci:\n  rounds: 0\n${RECIPE}`, 'bugfix.yaml')
    expect(r.ok).toBe(false)
  })

  it('rejects a rounds of 4', () => {
    const r = parseRecipe(`ci:\n  rounds: 4\n${RECIPE}`, 'bugfix.yaml')
    expect(r.ok).toBe(false)
  })

  it('refuses ci on a recipe with no ready-for-review gate', () => {
    const noGate = `
schemaVersion: ${RECIPE_SCHEMA_VERSION}
id: bugfix
ci:
  rounds: 2
steps:
  - id: reproduce
    kind: agent
    role: builder
`
    const r = parseRecipe(noGate, 'bugfix.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/ready-for-review/)
  })
})
