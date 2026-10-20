#!/usr/bin/env node
// What .github/workflows/ci.yml runs, run here, so a failure shows on this machine and not in CI.
// scripts/ci-plan.mjs reads each job's steps from the workflow. Stops at the first failure. A
// pass on a clean tree is recorded for its commit; the pre-push hook (`--check-push`) refuses a
// commit with none.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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

const NO_COMMIT = /^0+$/

/**
 * The refs a push names whose commit ci:local has not passed on. `pushed` is what git hands a
 * pre-push hook on stdin, one `<local ref> <local sha> <remote ref> <remote sha>` per line; a
 * deleted ref pushes no code.
 */
export function unverifiedPushes(pushed, passedSha) {
  return pushed
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([ref, sha]) => ref && sha && !NO_COMMIT.test(sha) && sha !== passedSha)
    .map(([ref]) => ref)
}

/** Whether a run tested exactly one commit: a clean tree, and HEAD where it started. */
export function recordablePass({ headBefore, headAfter, changesBefore, changesAfter }) {
  return headBefore === headAfter && changesBefore === '' && changesAfter === ''
}

const git = (...args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
const passFile = () => resolve(REPO_ROOT, git('rev-parse', '--git-path', 'ci-local-passed'))
const treeState = () => ({ head: git('rev-parse', 'HEAD'), changes: git('status', '--porcelain') })

function recordPass(before) {
  const after = treeState()
  const pass = { headBefore: before.head, headAfter: after.head }
  if (!recordablePass({ ...pass, changesBefore: before.changes, changesAfter: after.changes })) {
    console.log('Not recorded for a push: the tree had uncommitted changes or HEAD moved.')
    return
  }
  writeFileSync(passFile(), `${after.head}\n`)
  console.log(`Recorded the pass for ${after.head}; it can be pushed.`)
}

function checkPush() {
  const file = passFile()
  const passed = existsSync(file) ? readFileSync(file, 'utf8').trim() : null
  const refused = unverifiedPushes(readFileSync(0, 'utf8'), passed)
  if (refused.length === 0) return
  console.error(`ci:local has not passed on the commit of ${refused.join(', ')}.`)
  console.error('Commit everything, run `npm run ci:local`, then push again.')
  process.exit(1)
}

function main() {
  const before = treeState()
  const passed = runPlan() && runStep(E2E_STEP)
  if (!passed) process.exit(1)
  console.log('\nci:local passed. Not run here:')
  for (const [check, why] of Object.entries(NOT_RUN_HERE)) console.log(`  ${check}: ${why}`)
  recordPass(before)
}

function command() {
  if (process.argv.includes('--check-push')) return checkPush()
  return main()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) command()
