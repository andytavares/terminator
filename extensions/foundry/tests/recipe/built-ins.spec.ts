import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRecipe, parseRole, STEP_KINDS } from '../../src/recipe/parse.js'
import type { Recipe } from '../../src/recipe/parse.js'
import { resolveSkill } from '../../src/recipe/resolve.js'
import { createRoleRegistry } from '../../src/line/roles.js'
import { brief } from '../../src/line/brief.js'
import { draftOrder } from '../../src/order/draft.js'
import { buildRunGraph } from '../../src/line/run-graph.js'
import { readyNodes } from '../../src/line/scheduler.js'

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
  it('ships six shapes: five that change the repository and one whose product is a document', () => {
    expect(recipeFiles.sort()).toEqual([
      'bugfix.yaml',
      'direct.yaml',
      'refactor.yaml',
      'research.yaml',
      'speckit.yaml',
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
    // The lint pass sits between fix and flip; flip waits on it, not on fix
    // directly, but a skipped lint still settles for its dependants.
    expect(flip?.after).toContain('lint')
  })

  it('makes a refactor characterise the behaviour before changing it', () => {
    const steps = recipe('refactor.yaml').steps
    expect(steps.find((s) => s.id === 'characterise')?.expect).toEqual({ tests_added: '>= 1' })
    expect(steps.find((s) => s.id === 'baseline')?.after).toContain('characterise')
    expect(steps.find((s) => s.id === 'change')?.after).toContain('baseline')
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
    for (const file of ['direct.yaml', 'standard.yaml', 'research.yaml']) {
      expect(recipe(file).requires).toEqual([])
    }
  })

  it.each(['direct.yaml', 'bugfix.yaml', 'standard.yaml', 'refactor.yaml', 'speckit.yaml'])(
    '%s verifies with a fresh context, never a resumed one',
    (file) => {
      expect(recipe(file).steps.find((s) => s.id === 'verify')?.context).toBe('fresh')
    }
  )

  // One verifier, not one per unit. A fresh context is what makes verification
  // independent; a fresh context *per unit* buys nothing on top of that and
  // doubled the session count of every order that ever ran.
  it.each(['direct.yaml', 'bugfix.yaml', 'standard.yaml', 'refactor.yaml', 'speckit.yaml'])(
    '%s verifies once, not once per unit',
    (file) => {
      expect(recipe(file).steps.find((s) => s.id === 'verify')?.kind).toBe('agent')
    }
  )

  // The Forge's converge *is* the architect, and the plan it produced is what
  // the compile gate agreed. A `plan` step after agreement re-runs it over an
  // order it is not allowed to change: `applyRungOutput` refuses a plan from a
  // rung outright. Measured on WO-0907-3c1, that step cost 8.2 minutes and
  // could only have ended in silence or a halt.
  it.each(['direct.yaml', 'standard.yaml'])('%s does not re-plan an agreed order', (file) => {
    const architects = recipe(file)
      .steps.filter((step) => step.role === 'architect')
      .map((step) => step.id)
    expect(architects).toEqual([])
  })

  // A fan-out is a claim that work can happen at the same time. Units inside
  // one lane share a worktree and a branch, so they cannot.
  it.each(recipeFiles)('%s fans out over lanes, never over units in one lane', (file) => {
    for (const step of recipe(file).steps) {
      if (step.kind !== 'fanout') continue
      expect(step.over).toMatch(/ by lane$/)
    }
  })

  it('checks the direct shape with the test command when there is one and a verifier when there is not', () => {
    const steps = recipe('direct.yaml').steps
    const check = steps.find((s) => s.id === 'check')
    const verify = steps.find((s) => s.id === 'verify')
    expect(check?.kind).toBe('run')
    expect(check?.command).toBe('${toolchain.test}')
    expect(check?.when).toBe('toolchain.test is set')
    expect(check?.after).toEqual(['lint'])
    expect(check?.onFail).toEqual({ rework: 'build', max: 1 })
    expect(verify?.kind).toBe('agent')
    expect(verify?.when).toBe('toolchain.test is not set')
    // Only one of the two ever runs, so a skipped `check` never holds it.
    expect(verify?.after).toEqual(['check'])
  })

  it("skips the direct shape's documentation pass for the smallest changes only", () => {
    const document = recipe('direct.yaml').steps.find((s) => s.id === 'document')
    expect(document?.role).toBe('scribe')
    expect(document?.when).toBe('risk.grade is not P3')
    expect(document?.after).toEqual(['lint'])
  })

  it("waits the direct shape's join on every check, so a skipped one never lets work through", () => {
    const integrate = recipe('direct.yaml').steps.find((s) => s.id === 'integrate')
    expect(integrate?.after).toEqual(['check', 'verify', 'inspect', 'document'])
  })

  it('needs nothing from the repository for the direct shape', () => {
    expect(recipe('direct.yaml').requires).toEqual([])
  })

  it.each(['direct.yaml', 'bugfix.yaml', 'standard.yaml', 'speckit.yaml'])(
    '%s runs the inspector only on a risk trigger',
    (file) => {
      expect(recipe(file).steps.find((s) => s.id === 'inspect')?.when).toBe(
        'risk.triggers is not empty'
      )
    }
  )
})

// The research shape's deliverable is a document rather than a code change.
// It is still checked by a fresh reader, because the author's own summary is
// not evidence.
describe('the shape whose product is a document', () => {
  it('is written by the author', () => {
    expect(recipe('research.yaml').steps.find((s) => s.id === 'write')?.role).toBe('author')
  })

  it('is checked in a fresh context and ends at a ready-for-review gate', () => {
    const steps = recipe('research.yaml').steps
    expect(steps.find((s) => s.id === 'verify')?.context).toBe('fresh')
    expect(steps.find((s) => s.id === 'ship')?.rule).toBe('ready-for-review')
  })

  it('has no red-team step on the Line, because the red team argues with the architect in the Forge before agreement', () => {
    const write = recipe('research.yaml').steps.find((s) => s.id === 'write')
    expect(recipe('research.yaml').steps.some((s) => s.role === 'red-team')).toBe(false)
    expect(write?.after).toContain('scout')
  })
})

// The direct shape, built into a graph for the repositories it meets. Which of
// its steps run is decided per order, and a step that does not apply must not
// hold up the ones behind it.
describe('the direct shape on a real graph', () => {
  const direct = recipe('direct.yaml')

  function graphFor(opts: {
    test: boolean
    lint: boolean
    grade: 'P2' | 'P3'
    triggers?: boolean
  }) {
    const base = draftOrder({
      id: 'WO-1',
      title: 'x',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repo'],
      now: '2026-10-05T10:00:00.000Z',
    })
    const found = (command: string) => ({ command, source: 'package.json' })
    const o = {
      ...base,
      risk: {
        ...base.risk,
        grade: opts.grade,
        triggers: opts.triggers === true ? ['secrets' as const] : [],
      },
      context: {
        ...base.context,
        toolchain: {
          ...base.context.toolchain,
          test: opts.test ? found('npm test') : null,
          lint: opts.lint ? found('npm run lint') : null,
        },
      },
      plan: {
        ...base.plan,
        units: [
          {
            id: 'U-1',
            title: 'a',
            role: 'builder',
            lane: 1,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: [],
            verify: [],
          },
        ],
      },
    }
    return buildRunGraph(o, direct)
  }

  const stateOf = (graph: ReturnType<typeof graphFor>, id: string) =>
    graph.nodes.find((n) => n.stepId === id)?.state

  it('checks with the test command and skips the verifier when the repository has one', () => {
    const graph = graphFor({ test: true, lint: true, grade: 'P2' })
    expect(stateOf(graph, 'check')).toBe('waiting')
    expect(stateOf(graph, 'verify')).toBe('skipped')
  })

  it('checks with a verifier and skips the test step when the repository has none', () => {
    const graph = graphFor({ test: false, lint: true, grade: 'P2' })
    expect(stateOf(graph, 'check')).toBe('skipped')
    expect(stateOf(graph, 'verify')).toBe('waiting')
  })

  it('skips the documentation pass for a P3 change and keeps it above that', () => {
    expect(stateOf(graphFor({ test: true, lint: true, grade: 'P3' }), 'document')).toBe('skipped')
    expect(stateOf(graphFor({ test: true, lint: true, grade: 'P2' }), 'document')).toBe('waiting')
  })

  it('says why a step was skipped, in words', () => {
    const graph = graphFor({ test: true, lint: true, grade: 'P3' })
    expect(graph.nodes.find((n) => n.stepId === 'document')?.skipReason).toBe(
      'runs only when the change is not graded P3; it is graded P3'
    )
  })

  it('lets the verifier start once lint passes even though the test step was skipped', () => {
    const graph = graphFor({ test: false, lint: true, grade: 'P2' })
    const passed = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.stepId === 'build' || n.stepId === 'lint' ? { ...n, state: 'passed' as const } : n
      ),
    }
    const ready = readyNodes(passed, { agents: null } as never).map((n) => n.stepId)
    expect(ready).toContain('verify')
    expect(ready).toContain('document')
    expect(ready).not.toContain('check')
  })

  it('lets the join through when every step that applied has passed and the rest were skipped', () => {
    const graph = graphFor({ test: true, lint: false, grade: 'P3' })
    const done = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.state === 'skipped' || n.kind === 'gate' || n.stepId === 'integrate'
          ? n
          : { ...n, state: 'passed' as const }
      ),
    }
    const ready = readyNodes(done, { agents: null } as never).map((n) => n.stepId)
    expect(ready).toEqual(['integrate'])
  })
})

describe('the author role', () => {
  const author = parseRole(read(rolesDir, 'author.yaml'), 'author.yaml')

  it('hands back where the document is, beside writing documentation', () => {
    expect(author.ok && author.value.writes).toEqual(['docs', 'document'])
  })

  it('is told about outputs, the checkout and a published link', () => {
    const prompt = author.ok ? author.value.prompt : ''
    expect(prompt).toContain('outputs')
    expect(prompt).toContain('`checkout`')
    expect(prompt).toContain('`published`')
    expect(prompt).toContain('`url`')
  })
})

describe('built-in roles', () => {
  it('ships the nine roles the design names, and the author', () => {
    expect(roleFiles.map((f) => f.replace('.yaml', '')).sort()).toEqual([
      'architect',
      'author',
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
  it('lets only the builder, the integrator, the scribe and the author write to a checkout', () => {
    const CHECKOUT = ['worktree', 'integration_branch', 'docs']
    const allowed = new Set(['builder', 'integrator', 'scribe', 'author'])
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
      const text = brief({ order, role: registry.get(id) ?? null, units: [], rules: [] })
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

// The architect writes `plan` and `acceptance` and, until this was added,
// could read neither. A role's `reads:` is a permission rather than a
// preference, so the fix belongs on the role and not in the code that builds
// the brief: strip `order` from this list and the amendment brief degrades
// honestly instead of quietly ignoring what the role declared.
describe('what the architect may read', () => {
  it('may read the order it is writing', () => {
    const parsed = parseRole(read(rolesDir, 'architect.yaml'), 'architect.yaml')
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.value.reads).toContain('order')
  })
})

// Every shipped shape says how hard its agents work: a one-lane P3 change at
// `medium`, anything that spans modules, roots a cause, or characterises
// behaviour before changing it one level above, at `high`. Declared rather than
// left to the runtime, because the default differs between models.
describe('the effort each built-in shape asks for', () => {
  it.each(recipeFiles)('%s declares one', (file) => {
    expect(recipe(file).effort).toBeDefined()
  })

  it.each([
    ['direct.yaml', 'medium'],
    ['standard.yaml', 'high'],
    ['bugfix.yaml', 'high'],
    ['refactor.yaml', 'high'],
    ['speckit.yaml', 'high'],
    ['research.yaml', 'medium'],
  ])('%s runs at %s', (file, effort) => {
    expect(recipe(file).effort).toBe(effort)
  })
})

// Lint runs in the lane, as a command step right after the build it checks,
// so a repository with a lint command catches it before the work ever
// reaches a reviewer. It costs a terminal tab, not a session.
describe('the lint pass every code-producing shape adds after its build', () => {
  it.each([
    ['direct.yaml', 'build'],
    ['standard.yaml', 'build'],
    ['bugfix.yaml', 'fix'],
  ])('%s runs lint after %s, only when the repository has a lint command', (file, buildStep) => {
    const lint = recipe(file).steps.find((s) => s.id === 'lint')
    expect(lint?.kind).toBe('run')
    expect(lint?.command).toBe('${toolchain.lint}')
    expect(lint?.when).toBe('toolchain.lint is set')
    expect(lint?.after).toEqual([buildStep])
  })

  it.each([
    ['direct.yaml', 'build'],
    ['standard.yaml', 'build'],
    ['bugfix.yaml', 'fix'],
  ])('%s sends a failing lint back to %s', (file, buildStep) => {
    const lint = recipe(file).steps.find((s) => s.id === 'lint')
    expect(lint?.onFail).toEqual({ rework: buildStep, max: 1 })
  })

  it.each(['direct.yaml', 'standard.yaml', 'bugfix.yaml'])(
    '%s waits its next step on lint rather than the build it followed',
    (file) => {
      const nextId: Record<string, string> = {
        'direct.yaml': 'check',
        'standard.yaml': 'verify',
        'bugfix.yaml': 'flip',
      }
      const step = recipe(file).steps.find((s) => s.id === nextId[file])
      expect(step?.after).toContain('lint')
    }
  )

  // refactor is not one of the five: its shape already runs the suite twice
  // around the change, and there is no separate build step for lint to sit
  // beside — `unchanged` still gets onFail below.
  it('does not add a lint step to refactor', () => {
    expect(recipe('refactor.yaml').steps.find((s) => s.id === 'lint')).toBeUndefined()
  })

  // The test run steps that follow a build gain a rework target of their
  // own, so a failing suite sends the same builder back rather than holding
  // the whole order for an operator.
  it.each([
    ['direct.yaml', 'check', 'build'],
    ['bugfix.yaml', 'flip', 'fix'],
    ['refactor.yaml', 'unchanged', 'change'],
  ])('%s reworks %s back to %s on failure', (file, stepId, buildStep) => {
    const step = recipe(file).steps.find((s) => s.id === stepId)
    expect(step?.onFail).toEqual({ rework: buildStep, max: 1 })
  })

  // baseline runs before any change exists, so there is nothing upstream of
  // it to send work back to.
  it('leaves refactor baseline without a rework target', () => {
    const baseline = recipe('refactor.yaml').steps.find((s) => s.id === 'baseline')
    expect(baseline?.onFail).toBeUndefined()
  })
})

// CI is watched on the draft a `ready-for-review` gate opens: every shape
// that opens one gets two rounds back to the lane's builder before it holds
// for the operator.
describe('ci rounds on every shape that ships code', () => {
  // A document shape's draft carries prose; a red CI on the code around it is
  // not something its scribe can fix.
  const DOCUMENT_SHAPES = ['research.yaml']
  const withReadyForReviewGate = recipeFiles.filter((file) =>
    recipe(file).steps.some((s) => s.kind === 'gate' && s.rule === 'ready-for-review')
  )
  const watched = withReadyForReviewGate.filter((file) => !DOCUMENT_SHAPES.includes(file))
  const unwatched = recipeFiles.filter((file) => !watched.includes(file))

  it('finds a ready-for-review gate in every shape', () => {
    expect(recipeFiles.filter((file) => !withReadyForReviewGate.includes(file))).toEqual([])
  })

  it.each(watched)('%s gives its draft two rounds of CI', (file) => {
    expect(recipe(file).ci).toEqual({ rounds: 2 })
  })

  it.each(unwatched)('%s declares no ci', (file) => {
    expect(recipe(file).ci).toBeUndefined()
  })

  it('leaves exactly the document shape unwatched', () => {
    expect([...unwatched].sort()).toEqual(['research.yaml'])
  })
})

// A role's skills are mounted for it the way Claude Code loads them: a
// directory per skill, resolved on the same three rungs as a recipe. The
// built-in ci-fix skill is what lets the builder recover from a check
// handed back in its brief, so the builder declares it and the directory
// has to actually be there for that to mean anything.
describe('the built-in ci-fix skill', () => {
  it('is declared by the builder role', () => {
    const parsed = parseRole(read(rolesDir, 'builder.yaml'), 'builder.yaml')
    expect(parsed.ok && parsed.value.skills).toEqual(['ci-fix'])
  })

  it('resolves on the built-in rung', () => {
    const resolved = resolveSkill('ci-fix', {
      dataRoot: '/nowhere',
      repoPaths: [],
      builtInDir: root,
    })
    expect(resolved?.rung).toBe('built-in')
    expect(resolved && fs.existsSync(path.join(resolved.dir, 'SKILL.md'))).toBe(true)
  })

  it('names itself ci-fix in its own frontmatter', () => {
    const text = fs.readFileSync(path.join(root, 'skills', 'ci-fix', 'SKILL.md'), 'utf8')
    expect(text).toMatch(/^name:\s*ci-fix\s*$/m)
  })
})

describe('the shapes a one-lane order takes (ADR 085)', () => {
  it('standard has no Line scout: the Forge scout already read the repository', () => {
    const steps = recipe('standard.yaml').steps
    expect(steps.some((s) => s.role === 'scout')).toBe(false)
    expect(steps.find((s) => s.id === 'build')?.after ?? []).not.toContain('scout')
  })

  it.each(['standard.yaml', 'direct.yaml'])(
    '%s documents beside the verifier, not after it',
    (file) => {
      const steps = recipe(file).steps
      const document = steps.find((s) => s.id === 'document')
      expect(document?.after).toEqual(['lint'])
      expect(steps.find((s) => s.id === 'integrate')?.after).toContain('document')
    }
  )

  it.each(['standard.yaml', 'direct.yaml'])('%s keeps the scribe in a fresh session', (file) => {
    expect(recipe(file).steps.find((s) => s.id === 'document')?.context).toBe('fresh')
  })
})
