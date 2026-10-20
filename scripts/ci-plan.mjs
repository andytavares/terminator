// The steps of .github/workflows/ci.yml that ci:local runs on one operating system, read from
// the workflow itself so the two cannot drift. A GitHub expression or condition this does not
// know stops the plan, naming the job and step, rather than being guessed at.

import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'

/** Jobs ci:local does not run as ci.yml writes them, and why. */
export const SKIPPED_JOBS = {
  'e2e-select': 'scripts/ci-e2e-local.mjs selects the specs with the same e2e-select.mjs',
  e2e: 'scripts/ci-e2e-local.mjs runs its five shards and the burn-in, step for step',
  'e2e-result': 'it only reads the results of the jobs above',
  'e2e-report': 'it only merges the e2e reports into one HTML page',
}

const RUNNERS = { 'ubuntu-latest': 'linux', 'macos-14': 'mac' }

/** Expressions ci:local resolves, per operating system, in the text CI writes them. */
const EXPRESSIONS = [
  // One unit run of the whole suite stands for the four shards.
  ['--shard=${{ matrix.shard }}/4', () => ''],
  [
    "${{ runner.os == 'Linux' && 'xvfb-run -a ' || '' }}",
    (os) => (os === 'linux' ? 'xvfb-run -a ' : ''),
  ],
  // ci:local stops at the first failing step, so a later step only runs after unit passed.
  ['${{ needs.unit.result }}', () => 'success'],
]

const CONDITIONS = {
  "runner.os == 'Linux'": (os) => os === 'linux',
  'always()': () => true,
}

const SETUP = /^npm ci\b/

export function readWorkflow(path) {
  return yaml.load(readFileSync(path, 'utf8'))
}

function osesOf(job) {
  const runsOn = job['runs-on']
  const runners = runsOn === '${{ matrix.os }}' ? job.strategy.matrix.os : [runsOn]
  return runners.map((runner) => RUNNERS[runner])
}

function resolveScript(script, os, where) {
  const resolved = EXPRESSIONS.reduce((text, [from, to]) => text.split(from).join(to(os)), script)
  const unknown = resolved.match(/\$\{\{[^}]*\}\}/)
  if (unknown) throw new Error(`ci:local, ${where}: cannot resolve ${unknown[0]}`)
  return resolved.trim()
}

function runsOn(step, os, where) {
  if (step.if === undefined) return true
  const decide = CONDITIONS[step.if]
  if (decide === undefined) throw new Error(`ci:local, ${where}: cannot decide "if: ${step.if}"`)
  return decide(os)
}

function stepsOf(id, job, os) {
  return (job.steps ?? []).flatMap((step) => {
    const where = `job ${id}, step "${step.name}"`
    if (!step.run || SETUP.test(step.run) || !runsOn(step, os, where)) return []
    const script = resolveScript(step.run, os, where)
    return [{ job: id, name: step.name, script, env: step.env ?? {} }]
  })
}

/** Every step ci:local runs on `os` ('linux' or 'mac'), in workflow order. */
export function planFor(workflow, os) {
  return Object.entries(workflow.jobs)
    .filter(([id, job]) => !(id in SKIPPED_JOBS) && osesOf(job).includes(os))
    .flatMap(([id, job]) => stepsOf(id, job, os))
}
