import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ladderFor, climb, RUNGS } from '../../src/verify/ladder.js'
import type { LadderStep } from '../../src/verify/ladder.js'
import { rulesFor, rulesAtRung } from '../../src/verify/rules.js'
import { CHECK_NAMES } from '../../src/verify/toolchain-probe.js'
import type { Toolchain } from '../../src/verify/toolchain-probe.js'
import type { RiskAssessment } from '../../src/order/schema.js'

// Two properties matter more than the ordering: a failure stops the climb at
// its own rung, and a rung with no command reports "not measured" and is never
// counted as a pass.

const builtInDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function toolchain(over: Partial<Toolchain> = {}): Toolchain {
  const empty = Object.fromEntries(CHECK_NAMES.map((n) => [n, null])) as Toolchain
  return { ...empty, ...over }
}

const full = toolchain({
  format: { command: 'npm run format', source: 'package.json' },
  lint: { command: 'npm run lint', source: 'package.json' },
  test: { command: 'npm test', source: 'package.json' },
  coverage: { command: 'npm run coverage', source: 'package.json' },
  e2e: { command: 'npm run e2e', source: 'package.json' },
})

const noRisk: RiskAssessment = { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] }
const risky: RiskAssessment = {
  grade: 'P0',
  triggers: ['secrets'],
  blastRadius: [],
  criticalPaths: [],
}

describe('ladderFor', () => {
  it('places every rung from L0 to L6', () => {
    const rungs = new Set(
      ladderFor({ toolchain: full, risk: noRisk, touchesUi: false }).map((s) => s.rung)
    )
    expect([...rungs].sort()).toEqual([...RUNGS])
  })

  it('uses the commands the probe actually found', () => {
    const steps = ladderFor({ toolchain: full, risk: noRisk, touchesUi: false })
    expect(steps.find((s) => s.name === 'Lint')?.command).toBe('npm run lint')
  })

  it('marks a rung unavailable where the repository has no command, with the reason', () => {
    const steps = ladderFor({
      toolchain: toolchain({ test: { command: 'npm test', source: 'package.json' } }),
      risk: noRisk,
      touchesUi: false,
    })
    const coverage = steps.find((s) => s.rung === 'L2')
    expect(coverage?.status).toBe('unavailable')
    expect(coverage?.reason).toContain('no coverage command')
  })

  it('does not trigger the inspection when nothing warrants one, and says so', () => {
    const inspection = ladderFor({ toolchain: full, risk: noRisk, touchesUi: false }).find(
      (s) => s.rung === 'L4'
    )
    expect(inspection?.status).toBe('not_triggered')
    expect(inspection?.reason).toContain('nothing that warrants')
  })

  it('triggers the inspection on a risk trigger, naming it', () => {
    const inspection = ladderFor({ toolchain: full, risk: risky, touchesUi: false }).find(
      (s) => s.rung === 'L4'
    )
    expect(inspection?.status).toBe('elsewhere')
    expect(inspection?.reason).toContain('secrets')
  })

  it('asks for a picture of the running application when the interface changed', () => {
    const integration = ladderFor({ toolchain: full, risk: noRisk, touchesUi: true }).find(
      (s) => s.rung === 'L5'
    )
    expect(integration?.name).toMatch(/picture of the running application/)
  })

  // Three rungs are not commands and never were: independent verification is
  // the verifier's own node, the inspection is the inspector's, and the human
  // decision is a gate. They used to be `runnable` with nothing to run, so
  // every climb reported them "not measured" — three phantom gaps in every
  // pull request body, on the one signal the design cannot afford to have
  // people skim.
  it('reports the rungs decided elsewhere as decided, never as a gap', () => {
    const steps = ladderFor({ toolchain: toolchain(), risk: risky, touchesUi: false })
    for (const rung of ['L3', 'L4', 'L6'] as const) {
      const step = steps.find((s) => s.rung === rung)
      expect(step?.status, rung).toBe('elsewhere')
      expect(step?.reason, rung).not.toBe('')
    }
  })

  it('says where each of them was decided, rather than only that it was', () => {
    const steps = ladderFor({ toolchain: toolchain(), risk: risky, touchesUi: false })
    expect(steps.find((s) => s.rung === 'L3')?.reason).toMatch(/verifier/)
    expect(steps.find((s) => s.rung === 'L4')?.reason).toMatch(/findings/)
    expect(steps.find((s) => s.rung === 'L6')?.reason).toMatch(/decision/)
  })

  it('reports every rung unavailable in a repository with nothing in it, and none as passing', () => {
    const steps = ladderFor({ toolchain: toolchain(), risk: noRisk, touchesUi: false })
    const commandRungs = steps.filter((s) => s.check !== null)
    expect(commandRungs.every((s) => s.status === 'unavailable')).toBe(true)
  })
})

describe('climb', () => {
  const steps = (over: Partial<LadderStep>[] = []): LadderStep[] =>
    over.map((o, i) => ({
      rung: 'L0',
      name: `step-${i}`,
      command: 'run',
      status: 'runnable',
      reason: '',
      check: null,
      ...o,
    })) as LadderStep[]

  it('climbs everything when nothing fails', async () => {
    const outcome = await climb(steps([{}, {}, {}]), async () => 0)
    expect(outcome.ok).toBe(true)
    expect(outcome.stoppedAt).toBeNull()
    expect(outcome.steps).toHaveLength(3)
  })

  it('stops at the first failure rather than running the rest', async () => {
    const run = vi.fn(async (step: LadderStep) => (step.name === 'step-1' ? 1 : 0))
    const outcome = await climb(steps([{}, {}, {}]), run)
    expect(outcome.ok).toBe(false)
    expect(outcome.stoppedAt).toBe('L0')
    expect(outcome.steps).toHaveLength(2)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('does not stop for an unavailable rung, but never records it as a pass', async () => {
    const outcome = await climb(
      steps([{ status: 'unavailable', reason: 'no command' }, {}]),
      async () => 0
    )
    expect(outcome.steps[0].result).toBe('not_measured')
    expect(outcome.steps[1].result).toBe('pass')
    expect(outcome.stoppedAt).toBeNull()
  })

  it('carries every unmeasured rung out, so nothing downstream can read absence as green', async () => {
    const outcome = await climb(
      steps([{ status: 'unavailable', name: 'Coverage', reason: 'none' }, {}]),
      async () => 0
    )
    expect(outcome.unmeasured).toEqual(['Coverage'])
  })

  it('is still ok when a rung could not run, since the climb finished', async () => {
    const outcome = await climb(steps([{ status: 'unavailable', reason: 'none' }]), async () => 0)
    expect(outcome.ok).toBe(true)
  })

  it('records a step that was not triggered without running it', async () => {
    const run = vi.fn(async () => 0)
    const outcome = await climb(steps([{ status: 'not_triggered', reason: 'no trigger' }]), run)
    expect(outcome.steps[0].result).toBe('not_triggered')
    expect(run).not.toHaveBeenCalled()
  })

  it('treats a runner that returns nothing as not measured, not as a pass', async () => {
    const outcome = await climb(steps([{}]), async () => null)
    expect(outcome.steps[0].result).toBe('not_measured')
    expect(outcome.steps[0].exitCode).toBeNull()
  })

  it('takes the verdict from the exit status and nothing else', async () => {
    const outcome = await climb(steps([{}]), async () => 2)
    expect(outcome.steps[0].result).toBe('fail')
    expect(outcome.steps[0].exitCode).toBe(2)
  })
})

describe('rulesFor', () => {
  let dataRoot: string
  let repo: string

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-rules-'))
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-rules-repo-'))
  })

  afterEach(() => {
    for (const d of [dataRoot, repo]) fs.rmSync(d, { recursive: true, force: true })
  })

  function sources() {
    return { dataRoot, repoPaths: [repo], builtInDir }
  }

  it('loads every universal rule in any repository', () => {
    const loaded = rulesFor(sources(), { repoPaths: [repo], houseDocs: [] })
    const universal = loaded.rules.filter((r) => r.scope === 'universal').map((r) => r.id)
    expect(universal).toEqual(
      expect.arrayContaining([
        'exit-code-not-count',
        'patch-coverage',
        'render-not-call',
        'reachability',
        'every-consumer',
        'no-stubs',
      ])
    )
  })

  it('withholds a project rule from a repository that carries nothing it rests on', () => {
    const loaded = rulesFor(sources(), { repoPaths: [repo], houseDocs: [] })
    expect(loaded.rules.map((r) => r.id)).not.toContain('docs-in-pr')
    expect(loaded.notApplicable.map((r) => r.id)).toContain('docs-in-pr')
  })

  it('applies a project rule once the repository carries what it rests on', () => {
    const loaded = rulesFor(sources(), {
      repoPaths: [repo],
      houseDocs: ['.specify/memory/constitution.md'],
    })
    expect(loaded.rules.map((r) => r.id)).toContain('docs-in-pr')
    expect(loaded.rules.map((r) => r.id)).toContain('flat-icons')
  })

  it('applies a path-conditioned project rule only where that path exists', () => {
    expect(
      rulesFor(sources(), { repoPaths: [repo], houseDocs: [] }).rules.map((r) => r.id)
    ).not.toContain('screenshot-the-app')
    fs.writeFileSync(path.join(repo, 'playwright.config.ts'), 'export default {}')
    expect(
      rulesFor(sources(), { repoPaths: [repo], houseDocs: [] }).rules.map((r) => r.id)
    ).toContain('screenshot-the-app')
  })

  it('does not apply a rule whose condition nothing can evaluate', () => {
    fs.mkdirSync(path.join(dataRoot, 'rules'), { recursive: true })
    fs.writeFileSync(
      path.join(dataRoot, 'rules', 'odd.yaml'),
      'schemaVersion: 1\nid: odd\nscope: project\nrung: L3\nasserts: x\nappliesWhen: when the moon is full\n'
    )
    const loaded = rulesFor(sources(), { repoPaths: [repo], houseDocs: [] })
    expect(loaded.rules.map((r) => r.id)).not.toContain('odd')
  })

  it('reports a malformed rule without losing the rest', () => {
    fs.mkdirSync(path.join(dataRoot, 'rules'), { recursive: true })
    fs.writeFileSync(path.join(dataRoot, 'rules', 'broken.yaml'), 'scope: [unclosed\n')
    const loaded = rulesFor(sources(), { repoPaths: [repo], houseDocs: [] })
    expect(loaded.problems).toHaveLength(1)
    expect(loaded.rules.length).toBeGreaterThan(0)
  })
})

describe('rulesAtRung', () => {
  it('picks the rules that belong at one rung', () => {
    const rules = [
      { id: 'a', rung: 'L2' },
      { id: 'b', rung: 'L3' },
      { id: 'c', rung: 'L2' },
    ] as Parameters<typeof rulesAtRung>[0]
    expect(rulesAtRung(rules, 'L2').map((r) => r.id)).toEqual(['a', 'c'])
  })
})
