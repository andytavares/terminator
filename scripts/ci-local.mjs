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
import {
  canaryRequired,
  PASS_FILE as CANARY_PASS_FILE,
  REFUSAL as CANARY_REFUSAL,
} from './foundry-canary.mjs'
import { artifactPaths, planFor, readWorkflow, SKIPPED_JOBS, withoutUnitWork } from './ci-plan.mjs'
import { spawnToSink, startLinux } from './ci-linux.mjs'

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

const checkEnvironmentOf = (env) => checkEnvironment({ ...process.env, ...env })

function runOnMac({ script, env = {} }, cwd, write) {
  const bash = ['-e', '-o', 'pipefail', '-c', script]
  return spawnToSink('bash', bash, { cwd, env: checkEnvironmentOf(env), write })
}

/** Runs a step where CI does: a step of an Ubuntu job in the Linux container, any other here. */
async function runStep(step, { checkout, linux }, write) {
  write(`\n== ${step.job}: ${step.name} (${step.runner ?? 'macos'})\n`)
  const onLinux = step.runner?.startsWith('ubuntu')
  const status = await (onLinux ? linux.run(step, write) : runOnMac(step, checkout, write))
  if (status !== 0) write(`\nci:local failed: ${step.job}: ${step.name} exited ${status}\n`)
  return status === 0
}

/** `git clean` arguments that leave the checkout as a CI job starts it: node_modules, installed
 * once here, and what CI hands between jobs as artifacts are all that stay. */
export function cleanArguments(keep) {
  return ['clean', '-fdxq', ...['node_modules', ...keep].flatMap((path) => ['-e', path])]
}

/** Whether the select step's output (`name=value` lines) has CI run the unit job. */
export const unitSelected = (output) => /^run_unit=true$/m.test(output)

/** What CI's select job decides, asked of the same command, in the checkout under test. */
function unitSelectedIn(checkout, { all }) {
  const env = checkEnvironmentOf(all ? { TEST_ALL: '1' } : {})
  const output = execFileSync('node', ['scripts/test-select.mjs', '--github-output'], {
    cwd: checkout,
    env,
    encoding: 'utf8',
  })
  return unitSelected(output)
}

/** The two checkouts of one commit: the Mac lane's, and the Linux lane's, so the lanes share no files. */
export const checkoutPaths = (root) => ({
  mac: join(root, '.worktrees/.ci-local'),
  linux: join(root, '.worktrees/.ci-local-linux'),
})

/** The plan's steps as jobs, in workflow order, each with the jobs it needs (`needs` in ci.yml). */
export function jobsOf(steps, workflow) {
  const jobs = new Map()
  for (const step of steps) {
    const needs = [workflow.jobs[step.job]?.needs ?? []].flat()
    if (!jobs.has(step.job))
      jobs.set(step.job, { id: step.job, runner: step.runner, needs, steps: [] })
    jobs.get(step.job).steps.push(step)
  }
  return [...jobs.values()]
}

/** Where CI runs the job: Ubuntu jobs in the Linux container, the others on this Mac. */
export const ciLaneOf = (job) => (job.runner?.startsWith('ubuntu') ? 'linux' : 'mac')

/** Runs every job as soon as the jobs it needs have passed, as CI does; a need ci:local skips
 * counts as passed. A failure stops no running job; a job whose need did not pass never starts.
 * Resolves `{ id, status }` per job: passed, failed or skipped. */
export async function runScheduled(jobs, runJob) {
  const byId = new Map(jobs.map((job) => [job.id, job]))
  const statuses = new Map()
  const jobStatus = (id) => {
    if (!statuses.has(id)) statuses.set(id, startWhenNeedsPass(byId.get(id)))
    return statuses.get(id)
  }
  const startWhenNeedsPass = async (job) => {
    const needed = await Promise.all(job.needs.filter((id) => byId.has(id)).map(jobStatus))
    if (needed.some((status) => status !== 'passed')) return 'skipped'
    return (await runJob(job)) ? 'passed' : 'failed'
  }
  return Promise.all(jobs.map(async (job) => ({ id: job.id, status: await jobStatus(job.id) })))
}

// Jobs that fill every core by design: the unit suite, and the stability gate, which runs under
// load on purpose. Two at once overloaded the container until a spec hit its hang bound.
const WHOLE_MACHINE = new Set(['unit', 'stability-shard'])

/** `exclusive(work)` runs `work` after every earlier one has ended, in call order. */
export function oneAtATime() {
  let last = Promise.resolve()
  return (work) => {
    const result = last.then(work)
    last = result.catch(() => {})
    return result
  }
}

/** One job's steps in order, in the lane CI runs it. Its output prints as one block when it ends. */
async function runJob(job, context, durations) {
  const output = []
  const started = Date.now()
  let passed = true
  for (const step of job.steps) {
    if (!passed) break
    passed = await runStep(step, context[ciLaneOf(job)], (chunk) => output.push(String(chunk)))
  }
  const seconds = Math.round((Date.now() - started) / 1000)
  durations.set(job.id, seconds)
  process.stdout.write(
    `\n##### ${job.id}: ${passed ? 'passed' : 'FAILED'} in ${seconds}s\n${output.join('')}`
  )
  return passed
}

function reportJobs(outcomes, durations) {
  console.log('\nJob seconds:')
  for (const { id, status } of outcomes)
    console.log(`  ${id}: ${durations.get(id) ?? 0}s ${status}`)
  const unpassed = outcomes.filter(({ status }) => status !== 'passed')
  for (const { id, status } of unpassed) console.error(`ci:local: ${id} ${status}`)
  return unpassed.length === 0
}

/** The e2e step runs alone after the lanes: it waits for a quiet machine (ci-e2e-local.mjs). */
function runE2e(context, { all }) {
  const step = {
    job: 'e2e',
    name: 'its shards',
    script: 'node scripts/ci-e2e-local.mjs',
    env: all ? { TEST_ALL: '1' } : {},
  }
  return runStep(step, context.mac, (chunk) => process.stdout.write(chunk))
}

async function runChecks(checkouts, { all }) {
  const workflow = readWorkflow(join(checkouts.mac, '.github/workflows/ci.yml'))
  const keep = artifactPaths(workflow)
  const linux = startLinux({
    checkout: checkouts.linux,
    gitCommonDir: resolve(checkouts.mac, git(checkouts.mac, 'rev-parse', '--git-common-dir')),
    nodeVersion: readFileSync(join(checkouts.mac, '.nvmrc'), 'utf8').trim(),
  })
  try {
    for (const checkout of Object.values(checkouts)) git(checkout, ...cleanArguments(keep))
    const context = {
      mac: { checkout: checkouts.mac },
      linux: { checkout: checkouts.linux, linux },
    }
    const durations = new Map()
    const planned = planFor(workflow, { all })
    const steps = unitSelectedIn(checkouts.mac, { all }) ? planned : withoutUnitWork(planned)
    const jobs = jobsOf(steps, workflow)
    const exclusive = oneAtATime()
    const run = (job) => runJob(job, context, durations)
    const outcomes = await runScheduled(jobs, (job) =>
      WHOLE_MACHINE.has(job.id) ? exclusive(() => run(job)) : run(job)
    )
    return reportJobs(outcomes, durations) && (await runE2e(context, { all }))
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

/**
 * Whether the pre-push hook checks a push. A CI job pushing its own commit is CI already.
 * Foundry marks its pushes with `git -c foundry.push=true`: its final check ran, and CI runs
 * on the draft it opens (ADR 139).
 */
export function checksPushes(env, foundryPush = '') {
  return !env.CI && foundryPush !== 'true'
}

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: checkEnvironment(process.env) }).trim()
/** A git setting, or '' when it is not set. */
function gitSetting(name) {
  try {
    return git(REPO_ROOT, 'config', '--get', name)
  } catch {
    return ''
  }
}
const passFile = () =>
  resolve(REPO_ROOT, git(REPO_ROOT, 'rev-parse', '--git-path', 'ci-local-passed'))
const mainCheckout = () => resolve(REPO_ROOT, git(REPO_ROOT, 'rev-parse', '--git-common-dir'), '..')

/** The pushed lines whose commit changes how Foundry talks to Claude, git, GitHub or Linear. */
function pushesNeedingCanary(pushed) {
  return pushed
    .split('\n')
    .filter((line) => {
      const sha = line.trim().split(/\s+/)[1]
      if (!sha || NO_COMMIT.test(sha)) return false
      const changed = git(REPO_ROOT, 'diff', '--name-only', 'origin/main', sha).split('\n')
      const lock = (rev) =>
        changed.includes('package-lock.json')
          ? git(REPO_ROOT, 'show', `${rev}:package-lock.json`)
          : ''
      return canaryRequired({ changed, lockBefore: lock('origin/main'), lockAfter: lock(sha) })
    })
    .join('\n')
}

const recordedHead = (file) => passedHead(existsSync(file) ? readFileSync(file, 'utf8') : null)

function checkPush() {
  if (!checksPushes(process.env, gitSetting('foundry.push'))) return
  const pushed = readFileSync(0, 'utf8')
  const refused = unverifiedPushes(pushed, recordedHead(passFile()))
  if (refused.length > 0) {
    console.error(`ci:local has not passed on the commit of ${refused.join(', ')}.`)
    console.error('Run `npm run ci:local`, then push again.')
    process.exit(1)
  }
  const canaryFile = resolve(REPO_ROOT, git(REPO_ROOT, 'rev-parse', '--git-path', CANARY_PASS_FILE))
  const unproven = unverifiedPushes(pushesNeedingCanary(pushed), recordedHead(canaryFile))
  if (unproven.length > 0) {
    console.error(`${CANARY_REFUSAL} (${unproven.join(', ')})`)
    process.exit(1)
  }
  publishInBackground()
}

const COMMITTER = ['-c', 'user.name=ci-local', '-c', 'user.email=ci-local@localhost']

/** Puts a check worktree, made if missing, on `sha`, with nothing left but its node_modules. */
function checkoutCommit(checkout, sha) {
  if (!existsSync(checkout)) git(REPO_ROOT, 'worktree', 'add', '--detach', checkout, 'HEAD')
  git(checkout, 'checkout', '--force', '--detach', sha)
  git(checkout, 'clean', '-fdxq', '-e', 'node_modules')
}

/** Puts the check worktree on HEAD merged with origin/main, as CI's pull-request checkout is. */
function checkoutMerge(checkout, mainSha) {
  checkoutCommit(checkout, git(REPO_ROOT, 'rev-parse', 'HEAD'))
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
  const checkouts = checkoutPaths(mainCheckout())
  checkoutMerge(checkouts.mac, mainSha)
  const merged = git(checkouts.mac, 'rev-parse', 'HEAD')
  checkoutCommit(checkouts.linux, merged)
  console.log(`Testing ${merged} in ${checkouts.mac} (Mac) and ${checkouts.linux} (Linux)`)
  installOnMac(checkouts.mac)
  return { checkouts, headSha, mainSha }
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

async function main(flags) {
  const { checkouts, headSha, mainSha } = prepare()
  if (flags.prepareOnly) return
  if (!(await runChecks(checkouts, flags))) process.exit(1)
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
