#!/usr/bin/env node
// What .github/workflows/ci.yml runs, run here, so a failure shows on this machine and not in CI.
// Tests what CI tests: HEAD merged with a fresh origin/main in <repo>/.worktrees/.ci-local, on the
// .nvmrc Node and a lockfile-matched install, never the dirty tree. A pass is recorded for HEAD,
// and the pre-push hook (`--check-push`) refuses a commit without one.

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { planFor, readWorkflow, SKIPPED_JOBS } from './ci-plan.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

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

function runStep({ job, name, script, env = {} }, cwd) {
  console.log(`\n== ${job}: ${name}`)
  const options = { cwd, stdio: 'inherit', env: checkEnvironment({ ...process.env, ...env }) }
  const status = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], options).status
  if (status !== 0) console.error(`\nci:local failed: ${job}: ${name} exited ${status}`)
  return status === 0
}

function runChecks(checkout, { all }) {
  const workflow = readWorkflow(join(checkout, '.github/workflows/ci.yml'))
  const e2eStep = {
    job: 'e2e',
    name: 'the five shards and the burn-in',
    script: 'node scripts/ci-e2e-local.mjs',
    env: all ? { TEST_ALL: '1' } : {},
  }
  return [...planFor(workflow, { all }), e2eStep].every((step) => runStep(step, checkout))
}

/** The flags ci:local takes: `--all` runs everything, `--check-push` is the pre-push hook. */
export function parseFlags(argv) {
  return {
    all: argv.includes('--all'),
    checkPush: argv.includes('--check-push'),
    prepareOnly: argv.includes('--prepare-only'),
  }
}

/** Why this Node is not the one CI runs, or null when it is. */
export function nodeMismatch(running, nvmrc) {
  const wanted = `v${nvmrc.trim()}`
  if (running === wanted) return null
  return `ci:local needs Node ${wanted} (from .nvmrc) and this is Node ${running}. Switch with \`nvm use\`.`
}

export const lockHash = (lockfile) => createHash('sha256').update(lockfile).digest('hex')

/** Whether the lockfile differs from the one the last install in node_modules was made from. */
export const needsInstall = (currentHash, recordedHash) =>
  recordedHash === null || recordedHash.trim() !== currentHash

const NO_COMMIT = /^0+$/

/** The refs a push names whose commit ci:local has not passed on. `pushed` is the hook's stdin,
 * `<local ref> <local sha> <remote ref> <remote sha>` per line; a deleted ref pushes no code. */
export function unverifiedPushes(pushed, passedSha) {
  return pushed
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([ref, sha]) => ref && sha && !NO_COMMIT.test(sha) && sha !== passedSha)
    .map(([ref]) => ref)
}

/** What a pass records: the commit that passed and the origin/main it was merged with. */
export const passRecord = (headSha, mainSha) => `${headSha} ${mainSha}\n`

/** The commit a pass record names, or null when there is no record. */
export const passedHead = (record) => record?.trim().split(/\s+/)[0] || null

/** Whether the pre-push hook checks a push. A CI job pushing its own commit is CI already. */
export function checksPushes(env) {
  return !env.CI
}

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: checkEnvironment(process.env) }).trim()
const passFile = () =>
  resolve(REPO_ROOT, git(REPO_ROOT, 'rev-parse', '--git-path', 'ci-local-passed'))
const mainCheckout = () => resolve(REPO_ROOT, git(REPO_ROOT, 'rev-parse', '--git-common-dir'), '..')

function checkPush() {
  if (!checksPushes(process.env)) return
  const file = passFile()
  const passed = passedHead(existsSync(file) ? readFileSync(file, 'utf8') : null)
  const refused = unverifiedPushes(readFileSync(0, 'utf8'), passed)
  if (refused.length === 0) return
  console.error(`ci:local has not passed on the commit of ${refused.join(', ')}.`)
  console.error('Run `npm run ci:local`, then push again.')
  process.exit(1)
}

const COMMITTER = ['-c', 'user.name=ci-local', '-c', 'user.email=ci-local@localhost']

/** Puts the check worktree on HEAD merged with origin/main, as CI's pull-request checkout is. */
function checkoutMerge(checkout, mainSha) {
  if (!existsSync(checkout)) git(REPO_ROOT, 'worktree', 'add', '--detach', checkout, 'HEAD')
  git(checkout, 'checkout', '--force', '--detach', git(REPO_ROOT, 'rev-parse', 'HEAD'))
  git(checkout, 'clean', '-fdxq', '-e', 'node_modules')
  try {
    git(checkout, ...COMMITTER, 'merge', '--no-ff', '--no-edit', mainSha)
  } catch {
    git(checkout, 'merge', '--abort')
    console.error(
      `ci:local stopped: HEAD conflicts with origin/main (${mainSha}). Merge it, fix the conflicts, commit.`
    )
    process.exit(1)
  }
}

function installIfLockChanged(checkout) {
  const hashFile = join(checkout, 'node_modules/.lock-hash')
  const current = lockHash(readFileSync(join(checkout, 'package-lock.json')))
  const recorded = existsSync(hashFile) ? readFileSync(hashFile, 'utf8') : null
  if (!needsInstall(current, recorded))
    return console.log('Install: package-lock.json unchanged, keeping node_modules.')
  console.log('Install: package-lock.json changed, running npm ci.')
  if (spawnSync('npm', ['ci'], { cwd: checkout, stdio: 'inherit' }).status !== 0) process.exit(1)
  writeFileSync(hashFile, `${current}\n`)
}

/** Everything before the checks: Node, shas, the merged check worktree and its install. */
function prepare() {
  const mismatch = nodeMismatch(process.version, readFileSync(join(REPO_ROOT, '.nvmrc'), 'utf8'))
  if (mismatch) {
    console.error(mismatch)
    process.exit(1)
  }
  git(REPO_ROOT, 'fetch', 'origin', 'main')
  const headSha = git(REPO_ROOT, 'rev-parse', 'HEAD')
  const mainSha = git(REPO_ROOT, 'rev-parse', 'origin/main')
  console.log(`HEAD        ${headSha}\norigin/main ${mainSha}`)
  const checkout = join(mainCheckout(), '.worktrees/.ci-local')
  checkoutMerge(checkout, mainSha)
  console.log(`Testing ${git(checkout, 'rev-parse', 'HEAD')} in ${checkout}`)
  installIfLockChanged(checkout)
  return { checkout, headSha, mainSha }
}

function setCommitStatus(headSha, mainSha) {
  try {
    const repo = JSON.parse(
      execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], { encoding: 'utf8' })
    )
    execFileSync(
      'gh',
      [
        'api',
        `repos/${repo.nameWithOwner}/statuses/${headSha}`,
        '-f',
        'state=success',
        '-f',
        'context=local-check',
        '-f',
        `description=main ${mainSha.slice(0, 9)}`,
      ],
      { stdio: 'ignore' }
    )
  } catch {
    console.warn(
      'Warning: could not set the local-check status on GitHub; the local record is what the hook reads.'
    )
  }
}

function recordPass(headSha, mainSha) {
  writeFileSync(passFile(), passRecord(headSha, mainSha))
  setCommitStatus(headSha, mainSha)
  console.log(`Recorded the pass for ${headSha} (main ${mainSha}); it can be pushed.`)
}

function main(flags) {
  const { checkout, headSha, mainSha } = prepare()
  if (flags.prepareOnly) return
  if (!runChecks(checkout, flags)) process.exit(1)
  console.log('\nci:local passed. Not run here:')
  for (const [check, why] of Object.entries(NOT_RUN_HERE)) console.log(`  ${check}: ${why}`)
  recordPass(headSha, mainSha)
}

function command() {
  const flags = parseFlags(process.argv.slice(2))
  return flags.checkPush ? checkPush() : main(flags)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) command()
