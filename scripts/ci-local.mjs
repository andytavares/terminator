#!/usr/bin/env node
// What .github/workflows/ci.yml runs, run here, so a failure shows on this machine and not in CI.
// scripts/ci-plan.mjs reads each job's steps from the workflow. Stops at the first failure. Run it
// when you want the whole of CI here; nothing in git runs it for you.

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { planFor, readWorkflow, SKIPPED_JOBS } from './ci-plan.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOW = join(REPO_ROOT, '.github/workflows/ci.yml')

/** What CI checks that ci:local does not, and why. */
export const NOT_RUN_HERE = {
  ...SKIPPED_JOBS,
  e2e: 'runs here through scripts/ci-e2e-local.mjs, its shards and burn-in step for step',
  'codecov/patch': 'Codecov works it out from the uploaded coverage; the Test job runs here',
}

/**
 * The environment a check runs in: this one without the GIT_ variables git gives a hook. With
 * GIT_DIR set, every git command a spec runs in its temporary repository acts on this one.
 */
export function checkEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('GIT_')))
}

function runStep({ job, name, script, env = {} }) {
  console.log(`\n== ${job}: ${name}`)
  const options = {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: checkEnvironment({ ...process.env, ...env }),
  }
  const status = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], options).status
  if (status !== 0) console.error(`\nci:local failed: ${job}: ${name} exited ${status}`)
  return status === 0
}

const runPlan = () => planFor(readWorkflow(WORKFLOW)).every(runStep)

const E2E_STEP = {
  job: 'e2e',
  name: 'the five shards and the burn-in',
  script: 'node scripts/ci-e2e-local.mjs',
}

function main() {
  const passed = runPlan() && runStep(E2E_STEP)
  if (!passed) process.exit(1)
  console.log('\nci:local passed. Not run here:')
  for (const [check, why] of Object.entries(NOT_RUN_HERE)) console.log(`  ${check}: ${why}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
