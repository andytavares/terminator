// The steps of .github/workflows/ci.yml that ci:local runs, read from the workflow itself so the
// two cannot drift. A GitHub expression or condition this does not know stops the plan, naming
// the job and step, rather than being guessed at.

import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'

/** Jobs ci:local does not run as ci.yml writes them, and why. */
export const SKIPPED_JOBS = {
  'e2e-select': 'scripts/ci-e2e-local.mjs selects the specs with the same e2e-select.mjs',
  e2e: 'scripts/ci-e2e-local.mjs runs its five shards and the burn-in, step for step',
  'e2e-result': 'it only reads the results of the jobs above',
  'e2e-report': 'it only merges the e2e reports into one HTML page',
}

/** Expressions ci:local resolves, in the text CI writes them. */
const EXPRESSIONS = [
  // One unit run of the whole suite stands for the four shards.
  ['--shard=${{ matrix.shard }}/4', ''],
  // ci:local stops at the first failing step, so a later step only runs after unit passed.
  ['${{ needs.unit.result }}', 'success'],
]

const CONDITIONS = { 'always()': true }

const SETUP = /^npm ci\b/

/** @returns {{ jobs: Record<string, object> }} */
export function readWorkflow(path) {
  return yaml.load(readFileSync(path, 'utf8'))
}

function resolveScript(script, where) {
  const resolved = EXPRESSIONS.reduce((text, [from, to]) => text.split(from).join(to), script)
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

function stepsOf(id, job) {
  return (job.steps ?? []).flatMap((step) => {
    const where = `job ${id}, step "${step.name}"`
    if (!step.run || SETUP.test(step.run) || !runs(step, where)) return []
    return [
      { job: id, name: step.name, script: resolveScript(step.run, where), env: step.env ?? {} },
    ]
  })
}

/** Every step ci:local runs, in workflow order. */
export function planFor(workflow) {
  return Object.entries(workflow.jobs)
    .filter(([id]) => !(id in SKIPPED_JOBS))
    .flatMap(([id, job]) => stepsOf(id, job))
}
