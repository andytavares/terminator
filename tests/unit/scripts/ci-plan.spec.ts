import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  artifactPaths,
  e2eShardCount,
  planFor,
  readWorkflow,
  SKIPPED_JOBS,
} from '../../../scripts/ci-plan.mjs'

const REPO_ROOT = resolve(__dirname, '../../..')
const workflow = readWorkflow(resolve(REPO_ROOT, '.github/workflows/ci.yml'))
const plan = planFor(workflow)
const stepOf = (job: string, name: string) =>
  plan.find((step) => step.job === job && step.name === name)

const stepsOf = (id: string) => (workflow.jobs[id].steps ?? []) as Array<Record<string, unknown>>
const workflowText = readFileSync(resolve(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8')

/** The jobs that run the app or draw as a Mac does, in ci.yml's order. */
const MAC_JOBS = ['story-screenshots', 'start', 'e2e']

/** The jobs ci:local runs, in ci.yml's order. */
const PLANNED_JOBS = [
  'lint',
  'typecheck',
  'format',
  'stories',
  'story-screenshots',
  'unit',
  'test',
  'start',
]

describe("ci:local runs ci.yml's own steps", () => {
  it('runs every job it does not skip, in the order ci.yml lists them', () => {
    expect([...new Set(plan.map((step) => step.job))]).toEqual(PLANNED_JOBS)
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

describe('where ci:local runs a step', () => {
  it("gives each step its job's runner, so a step CI runs on Ubuntu runs in the Linux container", () => {
    expect(stepOf('unit', 'Test')?.runner).toBe('ubuntu-24.04-arm')
    expect(stepOf('story-screenshots', 'Compare story screenshots')?.runner).toBe('macos-26')
  })

  it('runs the perf budgets and the build warning check, in the jobs that took them over', () => {
    expect(stepOf('stories', 'Perf budgets')?.script).toBe('npm run test:perf')
    expect(stepOf('start', 'npm run build')?.script).toContain('tee build.log')
  })

  it('plans without a throw, with and without the test: all label, and names no deleted job', () => {
    const deleted = [
      'quarantine',
      'quarantine-e2e',
      'e2e-stability',
      'stability-plan',
      'build',
      'perf',
    ]
    for (const all of [false, true]) {
      const planned = planFor(workflow, { all })
      expect(planned.length).toBeGreaterThan(0)
      expect(planned.filter((step) => deleted.includes(step.job))).toEqual([])
    }
    expect(deleted.filter((job) => job in workflow.jobs)).toEqual([])
    expect(deleted.filter((job) => job in SKIPPED_JOBS)).toEqual([])
  })

  it('reads the number of e2e shards from the e2e job, for the local e2e run', () => {
    expect(e2eShardCount(workflow)).toBe(3)
  })
})

// Each CI job starts from a fresh checkout; ci:local's jobs share one. The story screenshots
// passed here on the Storybook the Linux job had built, and failed in CI, which had none.
describe('what one job hands the next', () => {
  it('is only what CI uploads as an artifact', () => {
    expect(artifactPaths(workflow)).toEqual(
      expect.arrayContaining(['.vitest-reports', 'blob-report', 'test-results'])
    )
    expect(artifactPaths(workflow)).not.toContain('storybook-static')
  })

  it('builds Storybook in the job that compares its screenshots', () => {
    const steps = stepsOf('story-screenshots').map((step) => step.name)
    expect(steps.indexOf('Build Storybook')).toBeGreaterThan(-1)
    expect(steps.indexOf('Build Storybook')).toBeLessThan(
      steps.indexOf('Compare story screenshots')
    )
  })
})

describe('the Test verdict', () => {
  it('fails when the selection failed, not only when a shard did', () => {
    const verdict = stepsOf('test').find((step) => step.name === 'Verdict')
    expect(String(verdict?.run)).toContain('test "${{ needs.select.result }}" = success')
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
  it('runs the app and what a Mac draws on macOS 26, and every other job on Ubuntu on ARM', () => {
    const macJobs = Object.entries(workflow.jobs)
      .filter(([, job]) => job['runs-on'] === 'macos-26')
      .map(([id]) => id)
    expect(macJobs).toEqual(MAC_JOBS)
    const runners = Object.values(workflow.jobs).map((job) => job['runs-on'])
    expect(new Set(runners)).toEqual(new Set(['macos-26', 'ubuntu-24.04-arm']))
    expect(workflowText).not.toMatch(/apt-get/)
  })

  // GitHub runs five macOS jobs at a time on every plan below Enterprise: more queue.
  // A macOS job that waits for another macOS job never runs beside it.
  it('asks for no more macOS runners at once than GitHub gives', () => {
    const onMac = (id: string) => workflow.jobs[id]?.['runs-on'] === 'macos-26'
    const macRunners = Object.values(workflow.jobs)
      .filter((job) => job['runs-on'] === 'macos-26')
      .filter((job) => ![job.needs ?? []].flat().some(onMac))
      .map((job) => (job.strategy?.matrix as { shard?: unknown[] } | undefined)?.shard?.length ?? 1)
    expect(macRunners.reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(5)
  })

  // ADR 129: a slow job is a finding to fix, not a reason to cancel the run.
  it('sets no job or step time limit in any workflow', () => {
    const workflowsDirectory = resolve(REPO_ROOT, '.github/workflows')
    const limited = readdirSync(workflowsDirectory).filter((file) =>
      /timeout-minutes/.test(readFileSync(resolve(workflowsDirectory, file), 'utf8'))
    )
    expect(limited).toEqual([])
  })
})

describe('the stability jobs (ADR 124)', () => {
  // ADR 124: repeats only find flaky tests, in the stability jobs; nothing retries a failure.
  it('repeats specs only in the stability jobs, retries nothing, and reports every shard', () => {
    expect(workflowText).not.toMatch(/Burn in|repeat-each|--retries/)
    expect(workflow.jobs['stability-shard'].strategy?.['fail-fast']).toBe(false)
    expect(workflow.jobs.unit.strategy?.['fail-fast']).toBe(false)
    expect(workflow.jobs.e2e.strategy?.['fail-fast']).toBe(false)
  })
})

describe('the Stability shards (ADR 124)', () => {
  it('sizes the shards from the change, and each runs its share', () => {
    expect(
      stepsOf('select')
        .map((step) => step.run)
        .join('\n')
    ).toContain(
      `node scripts/stability.mjs --github-output | sed 's/^shards=/stability_shards=/' >> "$GITHUB_OUTPUT"`
    )
    expect(workflow.jobs['stability-shard'].needs).toBe('select')
    expect(workflow.jobs['stability-shard'].strategy?.matrix).toEqual({
      include: '${{ fromJSON(needs.select.outputs.stability_shards) }}',
    })
  })

  it('runs in CI only: ci:local plans no stability step (Constitution XIV, ADR 132)', () => {
    expect(SKIPPED_JOBS).toHaveProperty('stability-shard')
    expect(stepOf('stability-shard', 'Changed specs, this shard')).toBeUndefined()
  })

  it('has one Stability verdict, red unless the selection and every shard passed', () => {
    const verdict = workflow.jobs.stability
    expect(verdict.name).toBe('Stability')
    expect(verdict.needs).toEqual(['select', 'stability-shard'])
    expect(verdict.if).toBe('always()')
  })
})

describe('the e2e job', () => {
  it('starts with the other jobs and selects its own tests, so it never waits for Select', () => {
    expect(workflow.jobs.e2e.needs).toBeUndefined()
    const select = stepsOf('e2e').find((step) => step.id === 'select')
    expect(String(select?.run)).toContain('node scripts/test-select.mjs --github-output')
  })
})

describe('the e2e job and the nightly sweep (ADR 124)', () => {
  const sweep = readWorkflow(resolve(REPO_ROOT, '.github/workflows/stability-sweep.yml'))

  it("repeats a changed e2e spec in the job's own shard, after the suite", () => {
    const steps = stepsOf('e2e').map((step) => String(step.run ?? ''))
    const suite = steps.findIndex((run) => run.includes('npx playwright test'))
    const repeat = steps.findIndex((run) =>
      run.includes('node scripts/stability.mjs --e2e --part ${{ matrix.shard }}/3')
    )
    expect(suite).toBeGreaterThan(-1)
    expect(repeat).toBeGreaterThan(suite)
    expect(stepsOf('e2e')[0].with).toMatchObject({ 'fetch-depth': 0 })
  })

  it('runs the quarantined tests in the nightly sweep, which gates nothing', () => {
    expect(Object.keys(sweep.jobs)).toEqual(
      expect.arrayContaining(['quarantine', 'quarantine-e2e'])
    )
  })

  it('reports an e2e report only when a shard failed', () => {
    expect(workflow.jobs['e2e-report'].if).toBe(
      "${{ !cancelled() && needs.e2e.result == 'failure' }}"
    )
  })

  it('skips the e2e build on a build cache hit, and pins the cache action to a commit', () => {
    const build = stepsOf('e2e').find((step) => step.name === 'Build')
    expect(build?.if).toMatch(/cache-hit != 'true'/)
    const cache = stepsOf('e2e').find((step) => String(step.uses).startsWith('actions/cache@'))
    expect(String(cache?.uses)).toMatch(/^actions\/cache@[0-9a-f]{40}$/)
  })
})

describe('the deterministic workflow, outside services and baselines', () => {
  it('never lets an outside service fail the Test job', () => {
    const codecov = stepsOf('test').find((step) => String(step.uses).startsWith('codecov/'))
    expect(codecov?.with).toMatchObject({ fail_ci_if_error: false })
  })

  it('fails a story with no baseline instead of writing one, and has no upload of new ones', () => {
    expect(stepOf('story-screenshots', 'Compare story screenshots')?.script).toContain(
      '--update-snapshots=none'
    )
    expect(stepsOf('story-screenshots').map((step) => step.name)).not.toContain(
      'Upload new baselines'
    )
  })

  it('writes baselines only in the labelled workflow, on the macOS image CI compares on', () => {
    const baselines = readWorkflow(resolve(REPO_ROOT, '.github/workflows/story-baselines.yml'))
    const job = baselines.jobs.baselines
    expect(job['runs-on']).toBe(workflow.jobs['story-screenshots']['runs-on'])
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
