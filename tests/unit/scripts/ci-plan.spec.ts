import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { planFor, readWorkflow, SKIPPED_JOBS } from '../../../scripts/ci-plan.mjs'

const REPO_ROOT = resolve(__dirname, '../../..')
const workflow = readWorkflow(resolve(REPO_ROOT, '.github/workflows/ci.yml'))
const plan = planFor(workflow)
const stepOf = (job: string, name: string) =>
  plan.find((step) => step.job === job && step.name === name)

const stepsOf = (id: string) => (workflow.jobs[id].steps ?? []) as Array<Record<string, unknown>>
const workflowText = readFileSync(resolve(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8')

describe("ci:local runs ci.yml's own steps", () => {
  it('runs every job it does not skip, in the order ci.yml lists them', () => {
    expect([...new Set(plan.map((step) => step.job))]).toEqual([
      'lint',
      'typecheck',
      'format',
      'stories',
      'unit',
      'perf',
      'test',
      'build',
      'start',
    ])
  })

  it('runs every job, or says why not', () => {
    const run = new Set(plan.map((step) => step.job))
    const unaccounted = Object.keys(workflow.jobs).filter(
      (job) => !run.has(job) && !(job in SKIPPED_JOBS)
    )
    expect(unaccounted).toEqual([])
  })

  it('resolves every GitHub expression it runs', () => {
    expect(plan.filter((step) => step.script.includes('${{'))).toEqual([])
  })

  it('leaves out installing dependencies, which runs once before every job', () => {
    expect(plan.some((step) => /^npm ci\b/.test(step.script))).toBe(false)
  })
})

describe('what a step becomes', () => {
  it('runs the unit suite whole, once, rather than one of four shards', () => {
    const unit = stepOf('unit', 'Test')?.script ?? ''
    expect(unit).toContain('npx vitest run --coverage')
    expect(unit).not.toContain('--shard')
  })

  it('selects the unit specs with the same test-select command CI runs', () => {
    const unit = stepOf('unit', 'Test')?.script ?? ''
    expect(unit).toContain('$(node scripts/test-select.mjs --print unit)')
  })

  it('asks test-select for everything only when planned with all', () => {
    const testAll = (all: boolean) =>
      planFor(workflow, { all }).find((step) => step.job === 'unit' && step.name === 'Test')?.env
        .TEST_ALL
    expect(testAll(true)).toBe('1')
    expect(testAll(false)).toBe('')
  })

  it('audits the lockfile only when the change touches it', () => {
    const audit = stepOf('lint', 'Security audit')?.script ?? ''
    expect(audit).toContain('package-lock.json')
    expect(audit).toContain('npm audit --audit-level=high')
  })

  it('runs every unit spec once, with the order from vitest.config.ts: no second pass, no seed of its own', () => {
    const scripts = plan.map((step) => step.script).join('\n')
    expect(scripts).not.toMatch(/--sequence\.(shuffle|seed)|--repeat|--changed/)
    expect(plan.filter((step) => /\bvitest run\b(?!.*--merge-reports)/.test(step.script))).toEqual([
      expect.objectContaining({ job: 'unit', name: 'Test' }),
    ])
  })
})

describe('what a step becomes, selected and unselected', () => {
  it('starts the packaged macOS app the release builds', () => {
    expect(stepOf('start', 'Packaged app')?.script).toContain('electron-builder --mac dir')
  })
})

describe('the deterministic workflow (ADR 123)', () => {
  it('runs every job on macOS 26 and installs nothing with apt', () => {
    const runners = Object.values(workflow.jobs).map((job) => job['runs-on'])
    expect(new Set(runners)).toEqual(new Set(['macos-26']))
    expect(workflowText).not.toMatch(/apt-get|ubuntu/)
  })

  it('runs every spec once: no burn-in, no census of one, every shard reported', () => {
    expect(workflowText).not.toMatch(/Burn in|repeat-each|--retries/)
    expect(workflow.jobs.unit.strategy?.['fail-fast']).toBe(false)
    expect(workflow.jobs.e2e.strategy?.['fail-fast']).toBe(false)
  })
})

describe('the deterministic workflow, outside services and baselines', () => {
  it('never lets an outside service fail the Test job', () => {
    const codecov = stepsOf('test').find((step) => String(step.uses).startsWith('codecov/'))
    expect(codecov?.with).toMatchObject({ fail_ci_if_error: false })
  })

  it('fails a story with no baseline instead of writing one, and has no upload of new ones', () => {
    expect(stepOf('stories', 'Compare story screenshots')?.script).toContain(
      '--update-snapshots=none'
    )
    expect(stepsOf('stories').map((step) => step.name)).not.toContain('Upload new baselines')
  })

  it('writes baselines only in the labelled workflow, on the macOS image CI compares on', () => {
    const baselines = readWorkflow(resolve(REPO_ROOT, '.github/workflows/story-baselines.yml'))
    const job = baselines.jobs.baselines
    expect(job['runs-on']).toBe(workflow.jobs.stories['runs-on'])
    expect(JSON.stringify(job.steps)).toContain('--update-snapshots=changed')
  })

  it('runs on a label change, so test: all takes effect', () => {
    expect(workflow.on?.pull_request).toHaveProperty(
      'types',
      expect.arrayContaining(['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled'])
    )
  })
})

describe('the daily audit, where an outside service may fail', () => {
  const audit = readWorkflow(resolve(REPO_ROOT, '.github/workflows/audit.yml'))

  it('runs daily and on demand, audits at high severity, and files an issue on failure', () => {
    const text = readFileSync(resolve(REPO_ROOT, '.github/workflows/audit.yml'), 'utf8')
    expect(audit.on).toHaveProperty('schedule')
    expect(audit.on).toHaveProperty('workflow_dispatch')
    expect(text).toContain('npm audit --audit-level=high')
    expect(text).toMatch(/gh issue (create|edit)/)
    expect(audit.jobs.audit.permissions).toMatchObject({ issues: 'write' })
    expect(audit.jobs.audit['runs-on']).toBe('macos-26')
  })
})

describe('a workflow it does not understand', () => {
  const oneStep = (step: Record<string, unknown>) => ({
    jobs: { check: { 'runs-on': 'macos-14', steps: [step] } },
  })

  it('refuses an expression it cannot resolve, naming the job and step', () => {
    const unknown = oneStep({ name: 'Greet', run: 'echo ${{ github.actor }}' })
    expect(() => planFor(unknown)).toThrow(/check.*Greet.*github\.actor/)
  })

  it('refuses a condition it cannot decide', () => {
    const unknown = oneStep({ name: 'Maybe', if: "github.ref == 'refs/heads/main'", run: 'true' })
    expect(() => planFor(unknown)).toThrow(/check.*Maybe/)
  })
})
