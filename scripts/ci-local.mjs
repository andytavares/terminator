#!/usr/bin/env node
// Every check .github/workflows/ci.yml runs, run here, so a failure shows on this machine, not
// in CI. Cheapest first; stops at the first failure. A pass on a clean tree is recorded for its
// commit, and the pre-push hook (`--check-push`) refuses a commit with no recorded pass.
// tests/unit/scripts/ci-local.spec.ts fails when ci.yml gains a command this does not run.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const npmRun = (script) => ({ command: 'npm', args: ['run', script] })

/** In the order they run; the Lint job's steps first, as CI orders them. */
export const CHECKS = [
  { command: 'npm', args: ['audit', '--audit-level=high'] },
  npmRun('lint:deps'),
  npmRun('lint:unused'),
  npmRun('lint:unused:production'),
  npmRun('lint:duplicates'),
  npmRun('lint'),
  npmRun('format:check'),
  npmRun('typecheck'),
  { command: 'node', args: ['scripts/check-temp-leaks.mjs', 'npx', 'vitest', 'run', '--coverage'] },
  npmRun('test:perf'),
  npmRun('test:stories'),
  npmRun('build-storybook'),
  { command: 'node', args: ['scripts/smoke-start.mjs', 'dev'] },
  { command: 'node', args: ['scripts/ci-e2e-local.mjs'] },
  { command: 'node', args: ['scripts/smoke-start.mjs', 'preview'] },
]

/** Commands in ci.yml this does not run itself, and why. */
export const NOT_RUN_HERE = {
  'npm run build': 'scripts/ci-e2e-local.mjs builds before the e2e suite',
  'npm run dev': 'an argument of smoke-start.mjs, which runs above',
  'npm run preview': 'an argument of smoke-start.mjs, which runs above',
  'node scripts/e2e-select.mjs': 'scripts/ci-e2e-local.mjs selects specs with it',
  'node scripts/e2e-shard.mjs': 'scripts/ci-e2e-local.mjs shards with it',
  'npm run test:visual':
    'its baselines are Linux screenshots and macOS renders them differently; regenerate them in Docker',
}

/**
 * The environment a check runs in: this one without the GIT_ variables git gives a hook. With
 * GIT_DIR set, every git command a spec runs in its temporary repository acts on this one.
 */
export function checkEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('GIT_')))
}

function runOne({ command, args }) {
  const line = [command, ...args].join(' ')
  console.log(`\n== ${line}`)
  const options = { cwd: REPO_ROOT, stdio: 'inherit', env: checkEnvironment(process.env) }
  const status = spawnSync(command, args, options).status
  if (status !== 0) console.error(`\nci:local failed: ${line} exited ${status}`)
  return status === 0
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
  if (!CHECKS.every(runOne)) process.exit(1)
  console.log('\nci:local passed. Not run here:')
  for (const [command, why] of Object.entries(NOT_RUN_HERE)) console.log(`  ${command}: ${why}`)
  recordPass(before)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check-push')) checkPush()
  else main()
}
