// The steps of .github/workflows/ci.yml that ci:local runs, read from the workflow itself so the
// two cannot drift. A GitHub expression or condition this does not know stops the plan, naming
// the job and step, rather than being guessed at.

import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'

/** Jobs ci:local does not run as ci.yml writes them, and why. */
export const SKIPPED_JOBS = {
  select:
    'the unit step runs the same scripts/test-select.mjs, and scripts/ci-e2e-local.mjs the e2e one',
  e2e: 'scripts/ci-e2e-local.mjs runs its shards, step for step',
  'e2e-result': 'it only reads the results of the jobs above',
  'e2e-report': 'it only merges the e2e reports into one HTML page',
}

const TEST_ALL_LABEL =
  "${{ contains(github.event.pull_request.labels.*.name, 'test: all') && '1' || '' }}"

/** Expressions ci:local resolves, as CI writes them. `all` stands for the label `test: all`;
 * push-to-main expressions resolve as a pull request's. */
function expressionsFor(all) {
  return [
    [TEST_ALL_LABEL, all ? '1' : ''],
    // One unit run of the whole selection stands for its shards.
    ['--shard=${{ matrix.shard }}/${{ needs.select.outputs.shard_count }}', ''],
    // ci:local stops at the first failing step, so a later step only runs after unit passed.
    ['${{ needs.unit.result }}', 'success'],
    // The unit step selects for itself, so the selection has succeeded by then.
    ['${{ needs.select.result }}', 'success'],
  ]
}

const CONDITIONS = { 'always()': true, "needs.unit.result == 'success'": true }

const SETUP = /^npm ci\b/

/**
 * @typedef {{ name?: string, run?: string, if?: string, env?: Record<string, string>, uses?: string, with?: Record<string, unknown> }} Step
 * @typedef {{ name?: string, 'runs-on'?: string, 'timeout-minutes'?: number, if?: string, needs?: string | string[], strategy?: Record<string, unknown>, permissions?: Record<string, string>, steps?: Step[] }} Job
 * @typedef {{ on?: Record<string, unknown>, jobs: Record<string, Job> }} Workflow
 */

/** @returns {Workflow} */
export function readWorkflow(path) {
  return yaml.load(readFileSync(path, 'utf8'))
}

function resolveScript(script, where, expressions) {
  const resolved = expressions.reduce((text, [from, to]) => text.split(from).join(to), script)
  const unknown = resolved.match(/\$\{\{[^}]*\}\}/)
  if (unknown) throw new Error(`ci:local, ${where}: cannot resolve ${unknown[0]}`)
  return resolved.trim()
}

function runs(step, where) {
  if (step.if === undefined) return true
  if (!(step.if in CONDITIONS))
    throw new Error(`ci:local, ${where}: cannot decide "if: ${step.if}"`)
  return CONDITIONS[step.if]
}

function resolveEnv(env, where, expressions) {
  return Object.fromEntries(
    Object.entries(env).map(([name, value]) => [
      name,
      resolveScript(String(value), `${where}, env ${name}`, expressions),
    ])
  )
}

function stepsOf(id, job, expressions) {
  return (job.steps ?? []).flatMap((step) => {
    const where = `job ${id}, step "${step.name}"`
    if (!step.run || SETUP.test(step.run) || !runs(step, where)) return []
    return [
      {
        job: id,
        runner: job['runs-on'],
        name: step.name,
        script: resolveScript(step.run, where, expressions),
        env: resolveEnv(step.env ?? {}, where, expressions),
      },
    ]
  })
}

/** Every step ci:local runs, in workflow order. `all` plans as if the pull request had `test: all`. */
export function planFor(workflow, { all = false } = {}) {
  const expressions = expressionsFor(all)
  return Object.entries(workflow.jobs)
    .filter(([id]) => !(id in SKIPPED_JOBS))
    .flatMap(([id, job]) => stepsOf(id, job, expressions))
}

/** How many shards the e2e job runs in, for scripts/ci-e2e-local.mjs to run the same. */
export function e2eShardCount(workflow) {
  return workflow.jobs.e2e.strategy.matrix.shard.length
}
