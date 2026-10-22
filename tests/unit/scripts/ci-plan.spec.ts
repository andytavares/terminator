import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { planFor, readWorkflow, SKIPPED_JOBS } from '../../../scripts/ci-plan.mjs'

const REPO_ROOT = resolve(__dirname, '../../..')
const workflow = readWorkflow(resolve(REPO_ROOT, '.github/workflows/ci.yml'))
const plan = planFor(workflow)
const stepOf = (job: string, name: string) =>
  plan.find((step) => step.job === job && step.name === name)

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

  it('shuffles the unit suite under a seed it prints, so an order-dependent failure reproduces', () => {
    const unit = stepOf('unit', 'Test')?.script ?? ''
    const seed = unit.match(/--sequence\.seed=(\d+)/)?.[1]
    expect(unit).toContain('--sequence.shuffle')
    expect(seed).toBeDefined()
    expect(unit).toContain(`Unit order seed: ${seed}`)
  })

  it('burns in the unit specs a pull request changes, twice, against main', () => {
    const burnIn = plan.find((step) => step.job === 'test' && step.script.includes('--changed'))
    expect(burnIn?.script).toContain('--changed origin/main --sequence.shuffle --passWithNoTests')
    expect(burnIn?.script).toContain('check-temp-leaks.mjs')
  })

  it('starts the packaged macOS app the release builds', () => {
    expect(stepOf('start', 'Packaged app')?.script).toContain('electron-builder --mac dir')
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
