#!/usr/bin/env node
// What .github/workflows/ci.yml runs, run here, so a failure shows on this machine and not in CI.
// Tests what CI tests: HEAD merged with a fresh origin/main in <repo>/.worktrees/.ci-local, on the
// .nvmrc Node and a lockfile-matched install, never the dirty tree. A pass is recorded for HEAD,
// and the pre-push hook (`--check-push`) refuses a commit without one.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installIfLockChanged } from './ci-install.mjs'
import { planFor, readWorkflow, SKIPPED_JOBS } from './ci-plan.mjs'
import { startLinux } from './ci-linux.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** What CI checks that ci:local does not, and why. */
export const NOT_RUN_HERE = {
  ...SKIPPED_JOBS,
  e2e: 'runs here through scripts/ci-e2e-local.mjs, its shards step for step',
  'codecov/patch': 'Codecov works it out from the uploaded coverage; the Test job runs here',
}

/**
 * The environment a check runs in: this one without the GIT_ variables git gives a hook. With
 * GIT_DIR set, every git command a spec runs in its temporary repository acts on this one.
 */
export function checkEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('GIT_')))
}

function runOnMac({ script, env = {} }, cwd) {
  const options = { cwd, stdio: 'inherit', env: checkEnvironment({ ...process.env, ...env }) }
  return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], options).status
}

/** Runs a step where CI does: a step of an Ubuntu job in the Linux container, any other here. */
function runStep(step, { checkout, linux }) {
  console.log(`\n== ${step.job}: ${step.name} (${step.runner ?? 'macos'})`)
  const status = step.runner?.startsWith('ubuntu') ? linux.run(step) : runOnMac(step, checkout)
  if (status !== 0) console.error(`\nci:local failed: ${step.job}: ${step.name} exited ${status}`)
  return status === 0
}

function runChecks(checkout, { all }) {
  const workflow = readWorkflow(join(checkout, '.github/workflows/ci.yml'))
  const e2eStep = {
    job: 'e2e',
    name: 'its shards',
    script: 'node scripts/ci-e2e-local.mjs',
    env: all ? { TEST_ALL: '1' } : {},
  }
  const linux = startLinux({
    checkout,
    gitCommonDir: resolve(checkout, git(checkout, 'rev-parse', '--git-common-dir')),
    nodeVersion: readFileSync(join(checkout, '.nvmrc'), 'utf8').trim(),
  })
  try {
    return [...planFor(workflow, { all }), e2eStep].every((step) =>
      runStep(step, { checkout, linux })
    )
  } finally {
    linux.stop()
  }
}

/** The flags ci:local takes: `--all` runs everything, `--check-push` is the pre-push hook. */
export function parseFlags(argv) {
  return {
    all: argv.includes('--all'),
    checkPush: argv.includes('--check-push'),
    prepareOnly: argv.includes('--prepare-only'),
    publishStatus: argv.includes('--publish-status'),
  }
}

/** Why this Node is not the one CI runs, or null when it is. */
export function nodeMismatch(running, nvmrc) {
  const wanted = `v${nvmrc.trim()}`
  if (running === wanted) return null
  return `ci:local needs Node ${wanted} (from .nvmrc) and this is Node ${running}. Switch with \`nvm use\`.`
}

export { lockHash, needsInstall } from './ci-install.mjs'

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
  if (refused.length === 0) return publishInBackground()
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
  } catch (error) {
    // Only a conflict leaves a merge to abort; any other refusal is git's to explain.
    spawnSync('git', ['merge', '--abort'], { cwd: checkout, stdio: 'ignore' })
    console.error(`ci:local stopped: HEAD does not merge with origin/main (${mainSha}):`)
    console.error(String(error.stderr ?? error.message).trim())
    process.exit(1)
  }
}

/** The Mac's install in the check worktree. */
function installOnMac(checkout) {
  const hashFile = join(checkout, 'node_modules/.lock-hash')
  installIfLockChanged(checkout, {
    where: 'macOS',
    recorded: () => (existsSync(hashFile) ? readFileSync(hashFile, 'utf8') : null),
    install: (hash) => {
      if (spawnSync('npm', ['ci'], { cwd: checkout, stdio: 'inherit' }).status !== 0) return false
      writeFileSync(hashFile, `${hash}\n`)
      return true
    },
  })
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
  installOnMac(checkout)
  return { checkout, headSha, mainSha }
}

const STATUS_TRIES = 24
const STATUS_PAUSE_MS = 5000

/** Waits until GitHub has the commit, then posts its status; `tries` bounds the wait. */
export async function publishWhenPushed({ exists, post, pause, tries }) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await exists()) {
      await post()
      return true
    }
    await pause()
  }
  return false
}

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: 'pipe' })
const repoName = () => JSON.parse(gh('repo', 'view', '--json', 'nameWithOwner')).nameWithOwner

function commitOnGitHub(repo, sha) {
  try {
    gh('api', `repos/${repo}/commits/${sha}`, '--silent')
    return true
  } catch {
    return false
  }
}

function postStatus(repo, headSha, mainSha) {
  const description = `description=main ${mainSha.slice(0, 9)}`
  const fields = ['-f', 'state=success', '-f', 'context=local-check', '-f', description]
  gh('api', `repos/${repo}/statuses/${headSha}`, ...fields)
}

/** The local-check status for the recorded pass, once the push that is starting reaches GitHub:
 * a status needs the commit there, and the hook runs before it is. */
async function publishStatus() {
  const record = readFileSync(passFile(), 'utf8').trim().split(/\s+/)
  const [headSha, mainSha] = record
  const repo = repoName()
  const posted = await publishWhenPushed({
    exists: async () => commitOnGitHub(repo, headSha),
    post: async () => postStatus(repo, headSha, mainSha),
    pause: () => new Promise((resolve) => setTimeout(resolve, STATUS_PAUSE_MS)),
    tries: STATUS_TRIES,
  })
  if (!posted) console.warn(`local-check: ${headSha} never reached GitHub; no status set.`)
}

/** Leaves the hook at once; the publisher outlives it and the push. */
function publishInBackground() {
  const script = fileURLToPath(import.meta.url)
  spawn(process.execPath, [script, '--publish-status'], { detached: true, stdio: 'ignore' }).unref()
}

function recordPass(headSha, mainSha) {
  writeFileSync(passFile(), passRecord(headSha, mainSha))
  console.log(
    `Recorded the pass for ${headSha} (main ${mainSha}); it can be pushed, and the push sets its local-check status.`
  )
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
  if (flags.publishStatus) return publishStatus()
  return flags.checkPush ? checkPush() : main(flags)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) command()
