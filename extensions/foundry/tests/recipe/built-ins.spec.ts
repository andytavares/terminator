import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRecipe, parseRole, STEP_KINDS } from '../../src/recipe/parse.js'
import type { Recipe } from '../../src/recipe/parse.js'
import { createRoleRegistry } from '../../src/line/roles.js'
import { brief } from '../../src/line/brief.js'
import { draftOrder } from '../../src/order/schema.js'

// The built-ins ship inside the extension, so they are available in a
// repository that contains nothing of Foundry's. They are data, which means
// nothing typechecks them — these tests are what stops a hand-edited recipe
// from reaching an operator broken.

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const recipesDir = path.join(root, 'recipes')
const rolesDir = path.join(root, 'roles')

function read(dir: string, file: string): string {
  return fs.readFileSync(path.join(dir, file), 'utf8')
}

const recipeFiles = fs.readdirSync(recipesDir).filter((f) => f.endsWith('.yaml'))
const roleFiles = fs.readdirSync(rolesDir).filter((f) => f.endsWith('.yaml'))

function recipe(file: string): Recipe {
  const parsed = parseRecipe(read(recipesDir, file), file)
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

describe('built-in recipes', () => {
  it('ships the six shapes of work the design names', () => {
    expect(recipeFiles.sort()).toEqual([
      'bugfix.yaml',
      'direct.yaml',
      'refactor.yaml',
      'speckit.yaml',
      'spike.yaml',
      'standard.yaml',
    ])
  })

  it.each(recipeFiles)('%s parses', (file) => {
    const parsed = parseRecipe(read(recipesDir, file), file)
    expect(parsed.ok, parsed.ok ? '' : parsed.reason).toBe(true)
  })

  it.each(recipeFiles)('%s uses only the six step kinds', (file) => {
    for (const step of recipe(file).steps) {
      expect(STEP_KINDS).toContain(step.kind)
    }
  })

  it.each(recipeFiles)('%s names a role for every agent step', (file) => {
    const known = new Set(roleFiles.map((f) => f.replace('.yaml', '')))
    for (const step of recipe(file).steps) {
      if (step.kind === 'agent') expect(known).toContain(step.role)
    }
  })

  it.each(recipeFiles)('%s gives every gate a default for being ignored', (file) => {
    for (const step of recipe(file).steps) {
      if (step.kind === 'gate') expect(step.defaultIfIgnored).toBeTruthy()
    }
  })

  it('holds a bug reproduction to failing before the fix exists', () => {
    const reproduce = recipe('bugfix.yaml').steps.find((s) => s.id === 'reproduce')
    expect(reproduce?.expect).toEqual({ suite_exit_code: '!= 0' })
  })

  it('and to passing afterwards — the pair is the proof', () => {
    const flip = recipe('bugfix.yaml').steps.find((s) => s.id === 'flip')
    expect(flip?.expect).toEqual({ exit_code: '== 0' })
    expect(flip?.after).toContain('fix')
  })

  it('makes a refactor characterise the behaviour before changing it', () => {
    const steps = recipe('refactor.yaml').steps
    expect(steps.find((s) => s.id === 'characterise')?.expect).toEqual({ tests_added: '>= 1' })
    expect(steps.find((s) => s.id === 'baseline')?.after).toContain('characterise')
    expect(steps.find((s) => s.id === 'change')?.after).toContain('baseline')
  })

  it('opens no pull request from a spike — the answer is the deliverable', () => {
    const ids = recipe('spike.yaml').steps.map((s) => s.id)
    expect(ids).not.toContain('ship')
    expect(ids).not.toContain('integrate')
  })

  it('keeps the whole ten-stage pipeline in the speckit recipe', () => {
    const ids = recipe('speckit.yaml').steps.map((s) => s.id)
    for (const phase of [
      'constitution',
      'specify',
      'clarify',
      'plan',
      'checklist',
      'tasks',
      'analyze',
      'implement',
    ]) {
      expect(ids).toContain(phase)
    }
  })

  it('offers the speckit recipe only where the toolkit is installed', () => {
    expect(recipe('speckit.yaml').requires).toEqual([{ kind: 'path_exists', value: '.specify' }])
  })

  it('requires a test command for the two shapes that depend on one', () => {
    expect(recipe('bugfix.yaml').requires).toEqual([{ kind: 'toolchain', value: 'test' }])
    expect(recipe('refactor.yaml').requires).toEqual([{ kind: 'toolchain', value: 'test' }])
  })

  it('asks nothing of a repository for the shapes that need nothing', () => {
    for (const file of ['direct.yaml', 'standard.yaml', 'spike.yaml']) {
      expect(recipe(file).requires).toEqual([])
    }
  })

  it.each(['direct.yaml', 'bugfix.yaml', 'standard.yaml', 'refactor.yaml', 'speckit.yaml'])(
    '%s verifies with a fresh context, never a resumed one',
    (file) => {
      const verify = recipe(file).steps.find((s) => s.id === 'verify')
      expect((verify?.step as { context?: string } | undefined)?.context).toBe('fresh')
    }
  )

  it.each(['direct.yaml', 'bugfix.yaml', 'standard.yaml', 'speckit.yaml'])(
    '%s runs the inspector only on a risk trigger',
    (file) => {
      expect(recipe(file).steps.find((s) => s.id === 'inspect')?.when).toBe(
        'risk.triggers is not empty'
      )
    }
  )
})

describe('built-in roles', () => {
  it('ships the nine roles the design names', () => {
    expect(roleFiles.map((f) => f.replace('.yaml', '')).sort()).toEqual([
      'architect',
      'builder',
      'foreman',
      'inspector',
      'integrator',
      'red-team',
      'scout',
      'scribe',
      'verifier',
    ])
  })

  it.each(roleFiles)('%s parses', (file) => {
    const parsed = parseRole(read(rolesDir, file), file)
    expect(parsed.ok, parsed.ok ? '' : parsed.reason).toBe(true)
  })

  it('forbids the verifier from resuming a conversation', () => {
    const parsed = parseRole(read(rolesDir, 'verifier.yaml'), 'verifier.yaml')
    expect(parsed.ok && parsed.value.allowResume).toBe(false)
  })

  it('forbids the red team and the inspector from resuming either', () => {
    for (const file of ['red-team.yaml', 'inspector.yaml']) {
      const parsed = parseRole(read(rolesDir, file), file)
      expect(parsed.ok && parsed.value.allowResume).toBe(false)
    }
  })

  // The property that matters is narrower than "writes nothing": the red team
  // and the foreman do produce output — findings, a schedule — they just may
  // not touch a checkout. Only three roles may.
  it('lets only the builder, the integrator and the scribe write to a checkout', () => {
    const CHECKOUT = ['worktree', 'integration_branch', 'docs']
    const allowed = new Set(['builder', 'integrator', 'scribe'])
    for (const file of roleFiles) {
      const parsed = parseRole(read(rolesDir, file), file)
      if (!parsed.ok) throw new Error(parsed.reason)
      const touchesCheckout = parsed.value.writes.some((w) => CHECKOUT.includes(w))
      expect(touchesCheckout, `${parsed.value.id} writes ${parsed.value.writes.join(', ')}`).toBe(
        allowed.has(parsed.value.id)
      )
    }
  })

  // The verifier's verdict is an exit status, so it has nothing to hand back
  // and declares nothing (FR-033). The inspector is not the same case: it is
  // asked in its own prompt for findings with a severity and a line, and
  // `writes:` is what the Line collects a rung's output by — so declaring
  // nothing meant an inspection ended in a terminal nobody reads. Neither may
  // touch a checkout, which is the property this pair is really about and
  // which the test above enforces for every role.
  it('gives the verifier nothing to hand back, because its verdict is an exit status', () => {
    const parsed = parseRole(read(rolesDir, 'verifier.yaml'), 'verifier.yaml')
    expect(parsed.ok && parsed.value.writes).toEqual([])
  })

  it('lets the inspector hand back the findings its prompt asks it for', () => {
    const parsed = parseRole(read(rolesDir, 'inspector.yaml'), 'inspector.yaml')
    expect(parsed.ok && parsed.value.writes).toEqual(['findings'])
    expect(parsed.ok && parsed.value.tools).not.toContain('edit')
  })

  it('gives no role an editing tool unless it may write to a checkout', () => {
    for (const file of roleFiles) {
      const parsed = parseRole(read(rolesDir, file), file)
      if (!parsed.ok) throw new Error(parsed.reason)
      if (parsed.value.tools.includes('edit')) {
        expect(
          parsed.value.writes.length,
          `${parsed.value.id} can edit but writes nothing`
        ).toBeGreaterThan(0)
      }
    }
  })

  it.each(roleFiles)('%s carries a prompt that says what it is for', (file) => {
    const parsed = parseRole(read(rolesDir, file), file)
    expect(parsed.ok && parsed.value.prompt.trim().length).toBeGreaterThan(40)
  })
})

// Two roles ship that no built-in recipe names: the foreman and the
// integrator. Scheduling and integration are code here, not agents. They are
// not dead weight — an operator's own recipe may name any role (FR-021), and
// the executor resolves a role by id with no list of which ones are "real".
//
// That is a claim, so it is proved rather than asserted: every shipped role
// resolves through the same registry the executor uses, and briefs into a
// message an agent could actually be launched with.
describe('every shipped role is one an operator recipe could name', () => {
  const registry = createRoleRegistry({
    dataRoot: path.join(root, 'nowhere-data'),
    repoPaths: [],
    builtInDir: root,
  })

  const order = draftOrder({
    id: 'WO-1',
    title: 'rewrite the session refresh',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/tmp/repo'],
    now: '2026-09-06T10:00:00.000Z',
  })

  it.each(roleFiles.map((f) => f.replace('.yaml', '')))(
    '%s resolves through the registry',
    (id) => {
      expect(registry.get(id)?.id).toBe(id)
    }
  )

  it.each(roleFiles.map((f) => f.replace('.yaml', '')))(
    '%s briefs into something an agent can be launched with',
    (id) => {
      const text = brief({ order, role: registry.get(id) ?? null, unit: null, rules: [] })
      expect(text.trim().length).toBeGreaterThan(50)
      // The role's own prompt leads, because it is the instruction.
      expect(text.startsWith((registry.get(id)?.prompt ?? '').trim())).toBe(true)
    }
  )
})

// Two role prompts have to agree about the same files. The architect declares
// what a unit touches; the builder is told to write the failing test first. If
// the architect does not count the test file, the builder writes a file nobody
// declared — which is a risk trigger — and every order for a repository with
// tests is held for an operator instead of shipping.
//
// Watched on a live run: a unit declared `src/session.js`, the builder wrote
// `src/session.js` and `src/session.test.js` as instructed, and the order was
// held on `outside_blast_radius`.
describe('the architect and the builder, about the same files', () => {
  it('tells the architect to declare the test files the builder will write', () => {
    const roles = createRoleRegistry({
      dataRoot: path.join(root, 'nowhere-data'),
      repoPaths: [],
      builtInDir: root,
    })
    const architect = roles.get('architect')
    const builder = roles.get('builder')
    expect(builder?.prompt).toContain('failing test first')
    expect(architect?.prompt).toContain('test files')
  })
})
