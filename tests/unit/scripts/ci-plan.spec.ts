import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { planFor, readWorkflow, SKIPPED_JOBS } from '../../../scripts/ci-plan.mjs'

const REPO_ROOT = resolve(__dirname, '../../..')
const workflow = readWorkflow(resolve(REPO_ROOT, '.github/workflows/ci.yml'))

const jobsIn = (os: 'linux' | 'mac') => [...new Set(planFor(workflow, os).map((step) => step.job))]
const stepOf = (os: 'linux' | 'mac', job: string, name: string) =>
  planFor(workflow, os).find((step) => step.job === job && step.name === name)

describe("ci:local runs ci.yml's own steps", () => {
  it('runs every Ubuntu job in the Linux container, in the order ci.yml lists them', () => {
    expect(jobsIn('linux')).toEqual([
      'lint',
      'typecheck',
      'format',
      'stories',
      'unit',
      'perf',
      'test',
      'build',
      'start',
      'e2e-x11',
    ])
  })

  it('runs every job somewhere, or says why not', () => {
    const run = new Set([...jobsIn('linux'), ...jobsIn('mac')])
    const unaccounted = Object.keys(workflow.jobs).filter(
      (job) => !run.has(job) && !(job in SKIPPED_JOBS)
    )
    expect(unaccounted).toEqual([])
  })
})

describe('what ci:local runs on this Mac', () => {
  it('runs the macOS Start job here, without the Linux-only packaged app', () => {
    expect(jobsIn('mac')).toEqual(['start'])
    expect(stepOf('mac', 'start', 'npm run dev')?.script).toBe('node scripts/smoke-start.mjs dev')
    expect(stepOf('mac', 'start', 'Packaged app')).toBeUndefined()
  })

  it('resolves every GitHub expression it runs', () => {
    const scripts = [...planFor(workflow, 'linux'), ...planFor(workflow, 'mac')].map(
      (s) => s.script
    )
    expect(scripts.filter((script) => script.includes('${{'))).toEqual([])
  })
})

describe('what a Linux step becomes', () => {
  it('starts the app under xvfb as the Linux runner does', () => {
    expect(stepOf('linux', 'start', 'npm run dev')?.script).toBe(
      'xvfb-run -a node scripts/smoke-start.mjs dev'
    )
    expect(stepOf('linux', 'start', 'Packaged app')?.script).toContain('electron-builder --linux')
  })

  it('runs the unit suite whole, once, rather than one of four shards', () => {
    const unit = stepOf('linux', 'unit', 'Test')?.script ?? ''
    expect(unit).toContain('npx vitest run --coverage')
    expect(unit).not.toContain('--shard')
  })

  it("keeps a step's own environment", () => {
    expect(stepOf('linux', 'e2e-x11', 'Run X11 specs')?.env).toEqual({
      E2E_ELECTRON_ARGS: '--no-sandbox',
    })
  })

  it('leaves out installing dependencies, which runs once before every job', () => {
    const scripts = planFor(workflow, 'linux').map((step) => step.script)
    expect(scripts.some((script) => /^npm ci\b/.test(script))).toBe(false)
  })
})

describe('a workflow it does not understand', () => {
  const oneStep = (step: Record<string, unknown>) => ({
    jobs: { check: { 'runs-on': 'ubuntu-latest', steps: [step] } },
  })

  it('refuses an expression it cannot resolve, naming the job and step', () => {
    const unknown = oneStep({ name: 'Greet', run: 'echo ${{ github.actor }}' })
    expect(() => planFor(unknown, 'linux')).toThrow(/check.*Greet.*github\.actor/)
  })

  it('refuses a condition it cannot decide', () => {
    const unknown = oneStep({ name: 'Maybe', if: "github.ref == 'refs/heads/main'", run: 'true' })
    expect(() => planFor(unknown, 'linux')).toThrow(/check.*Maybe/)
  })

  it('reads the real workflow file', () => {
    expect(readFileSync(resolve(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8')).toContain('jobs:')
  })
})
