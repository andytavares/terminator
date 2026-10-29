#!/usr/bin/env node
// npm run canary [--dry-run]: one real Foundry order on this repository, from a real Linear ticket
// to an open draft pull request, with the real `claude`, `gh` and `git`. Local only: never in CI
// (Constitution XIV). What it proves and what it cleans up: docs/adr/136-*.md.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { errorLines } from './smoke-start.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Outside every repository: the canary's orders and worktrees never land in a checkout.
const DATA_ROOT = join(homedir(), '.foundry-canary')
const OVERALL_BOUND_MS = 60 * 60_000
const INTAKE_BOUND_MS = 20 * 60_000
const POLL_MS = 5_000
const TEAM_KEY = 'TAV'
const LABEL = 'canary'
const TICKET_TITLE = 'Canary: add one line to docs/foundry-canary.md'

/** Where the canary's pass for a commit is recorded, beside ci:local's. */
export const PASS_FILE = 'foundry-canary-passed'

/** The paths whose change needs a canary pass before a push: the one list (ADR 136). A path ending
 * in `/` is a folder; any other is a file. */
export const CANARY_PATHS = [
  'extensions/foundry/src/runtime/',
  // Each starts a Claude agent: the architect and read-only rounds, and every Line node.
  'extensions/foundry/src/forge/intake-turn.ts',
  'extensions/foundry/src/line/node-session.ts',
  'src/main/agents/acp/',
  'extensions/foundry/src/line/integrate.ts',
  'extensions/foundry/src/line/worktree.ts',
  'extensions/foundry/src/line/commit.ts',
  'extensions/foundry/src/trackers/',
  'extensions/foundry/recipes/',
]
const LOCKED_PACKAGES = [
  'node_modules/@agentclientprotocol/claude-agent-acp',
  'node_modules/@anthropic-ai/claude-code',
]

export const REFUSAL =
  'This push changes how Foundry talks to Claude, git, GitHub or Linear. Run `npm run canary`, then push again.'

/** The locked version of each package whose change needs a canary. */
export function canaryPackageVersions(lockText) {
  const { packages = {} } = JSON.parse(lockText)
  return LOCKED_PACKAGES.map((name) => packages[name]?.version)
}

/** Whether a push of these changed files, with the lock before and after, needs a canary pass. */
export function canaryRequired({ changed, lockBefore, lockAfter }) {
  const touched = changed.some((path) =>
    CANARY_PATHS.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry))
  )
  if (touched) return true
  if (!changed.includes('package-lock.json')) return false
  return canaryPackageVersions(lockBefore).join() !== canaryPackageVersions(lockAfter).join()
}

export const isCanaryBranch = (name) => name.startsWith('canary/')

/** The canary branches in `git ls-remote --heads` output. */
export function remoteCanaryBranches(output) {
  return output
    .split('\n')
    .map((line) => line.split('\trefs/heads/')[1])
    .filter((name) => name !== undefined && isCanaryBranch(name))
}

/** What a canary run left behind, one line each: empty when it left nothing. */
export function leftovers(found) {
  return [
    ...found.pullRequests
      .filter((pr) => isCanaryBranch(pr.headRefName))
      .map((pr) => `pull request #${pr.number} (${pr.headRefName})`),
    ...found.remoteBranches.map((name) => `remote branch ${name}`),
    ...found.localBranches.filter(isCanaryBranch).map((name) => `local branch ${name}`),
    ...found.worktrees.map((path) => `worktree ${path}`),
    ...found.orderFolders.map((path) => `order folder ${path}`),
    ...found.tickets.map((key) => `open ticket ${key}`),
  ]
}

/** Why the canary failed, one line each; empty when it passed. */
export function verdict({ failure, left, logErrors }) {
  return [
    ...(failure === null ? [] : [failure]),
    ...(left.length === 0 ? [] : [`left behind: ${left.join('; ')}`]),
    ...logErrors.map((line) => `app log: ${line.trim()}`),
  ]
}

const PLAN = [
  'sweep leftovers: canary/* pull requests and branches, canary order folders, open `canary` tickets',
  `create a Linear ticket in team ${TEAM_KEY} labelled ${LABEL}: "${TICKET_TITLE}"`,
  'create the order from the ticket, converge it, compile it with commit, start the run',
  'wait for run.complete, an open draft pull request on canary/<order id> and the Linear write-backs',
  'always: close the pull request, delete the branches, remove the order, cancel the ticket, quit the app',
  'fail if anything is left or the app log shows an error; on a pass record it for HEAD',
]

// ---- outside services -------------------------------------------------------------------------

const run = (command, args, cwd = REPO_ROOT) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The operator's Linear key. The installed app's copy is sealed to its own keychain entry,
 * which a development build cannot open, so the canary takes it from the environment. */
export function linearKey(env = process.env) {
  const key = env.LINEAR_API_KEY?.trim()
  if (!key) throw new Error('Set LINEAR_API_KEY to a Linear API key for team TAV, then run again.')
  return key
}

/** Connects the fresh profile's Linear tracker the way Settings does, so Foundry reads the ticket. */
async function connectTracker(page, key) {
  const connected = await page.evaluate(
    (apiKey) => window.electronAPI.integrations.connect({ tracker: 'linear', apiKey }),
    key
  )
  if (!('connection' in connected)) {
    throw new Error(`Linear did not connect: ${JSON.stringify(connected)}`)
  }
}

/** Linear's API with the operator's key. */
function linearClient(key) {
  return async (query, variables = {}) => {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: key },
      body: JSON.stringify({ query, variables }),
    })
    const body = await response.json()
    if (body.errors) throw new Error(`Linear: ${JSON.stringify(body.errors)}`)
    return body.data
  }
}

async function createTicket(linear) {
  const { teams } = await linear(`query($key:String!){teams(filter:{key:{eq:$key}}){nodes{id}}}`, {
    key: TEAM_KEY,
  })
  const teamId = teams.nodes[0].id
  const found = await linear(`query($n:String!){issueLabels(filter:{name:{eq:$n}}){nodes{id}}}`, {
    n: LABEL,
  })
  const labelId =
    found.issueLabels.nodes[0]?.id ??
    (
      await linear(
        `mutation($t:String!,$n:String!){issueLabelCreate(input:{teamId:$t,name:$n}){issueLabel{id}}}`,
        { t: teamId, n: LABEL }
      )
    ).issueLabelCreate.issueLabel.id
  const made = await linear(
    `mutation($i:IssueCreateInput!){issueCreate(input:$i){issue{id identifier}}}`,
    { i: { teamId, title: TICKET_TITLE, description: TICKET_TITLE, labelIds: [labelId] } }
  )
  return made.issueCreate.issue
}

const OPEN_CANARY_TICKETS = `{issues(filter:{labels:{name:{eq:"${LABEL}"}},state:{type:{nin:["canceled","completed"]}}}){nodes{id identifier}}}`

async function openTickets(linear) {
  return (await linear(OPEN_CANARY_TICKETS)).issues.nodes
}

async function cancelTicket(linear, id) {
  const { workflowStates } = await linear(
    `query($key:String!){workflowStates(filter:{team:{key:{eq:$key}},type:{eq:"canceled"}}){nodes{id}}}`,
    { key: TEAM_KEY }
  )
  await linear(
    `mutation($id:String!,$s:String!){issueUpdate(id:$id,input:{stateId:$s}){success}}`,
    {
      id,
      s: workflowStates.nodes[0].id,
    }
  )
}

/** The ticket's state type and comment count: what the write-backs left on it. */
async function ticketWriteBacks(linear, id) {
  const { issue } = await linear(
    `query($id:String!){issue(id:$id){state{type} comments{nodes{body}}}}`,
    { id }
  )
  return { stateType: issue.state.type, comments: issue.comments.nodes.length }
}

// ---- leftovers --------------------------------------------------------------------------------

function canaryOrderFolders() {
  const orders = join(DATA_ROOT, 'orders')
  if (!existsSync(orders)) return []
  return readdirSync(orders)
    .map((id) => join(orders, id))
    .filter((folder) => {
      try {
        const { source } = JSON.parse(readFileSync(join(folder, 'order.json'), 'utf8'))
        return isCanaryBranch(source?.branch ?? '')
      } catch {
        return false
      }
    })
}

// Its own clone of this repository, on main: the order's base is main, never the branch under test.
const CANARY_REPO = join(DATA_ROOT, 'repo')
const gitInRepo = (...args) => run('git', args, CANARY_REPO)

/** Clones this repository's origin once, then puts the clone on a clean origin/main. */
function prepareCanaryRepo() {
  if (!existsSync(CANARY_REPO)) {
    run('git', ['clone', '--quiet', run('git', ['remote', 'get-url', 'origin']), CANARY_REPO])
  }
  gitInRepo('fetch', '--quiet', 'origin')
  gitInRepo('checkout', '--quiet', '-B', 'main', 'origin/main')
  gitInRepo('clean', '-fdq')
}

const canaryWorktrees = () =>
  gitInRepo('worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
    .filter((path) => path.startsWith(join(DATA_ROOT, 'orders')))

async function findLeftovers(linear) {
  const pullRequests = JSON.parse(
    run('gh', ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,headRefName'])
  )
  return {
    pullRequests,
    remoteBranches: remoteCanaryBranches(gitInRepo('ls-remote', '--heads', 'origin', 'canary/*')),
    localBranches: gitInRepo('branch', '--format=%(refname:short)', '--list', 'canary/*')
      .split('\n')
      .filter(Boolean),
    worktrees: canaryWorktrees(),
    orderFolders: canaryOrderFolders(),
    tickets: (await openTickets(linear)).map((ticket) => ticket.identifier),
  }
}

/** Removes everything `findLeftovers` names. Each step is tried on its own so one failure leaves
 * the rest undone no longer. */
async function clean(found, linear) {
  const steps = [
    ...found.pullRequests
      .filter((pr) => isCanaryBranch(pr.headRefName))
      .map((pr) => () => run('gh', ['pr', 'close', String(pr.number), '--delete-branch'])),
    // A pull request's branch goes with it (`--delete-branch`), so only an orphan is deleted here.
    ...found.remoteBranches
      .filter((name) => !found.pullRequests.some((pr) => pr.headRefName === name))
      .map((name) => () => gitInRepo('push', 'origin', '--delete', name)),
    // Foundry adds its worktrees locked, and a locked one needs the force twice.
    ...found.worktrees.map((path) => () => gitInRepo('worktree', 'remove', '-f', '-f', path)),
    ...found.localBranches.map((name) => () => gitInRepo('branch', '-D', name)),
    ...found.orderFolders.map((folder) => () => rmSync(folder, { recursive: true, force: true })),
    ...(await openTickets(linear)).map((ticket) => () => cancelTicket(linear, ticket.id)),
  ]
  for (const step of steps) {
    try {
      await step()
    } catch (error) {
      console.error(`cleanup step failed: ${error.message}`)
    }
  }
  gitInRepo('worktree', 'prune')
}

// ---- driving the app --------------------------------------------------------------------------

async function launchApp(userDataDirectory, logDirectory) {
  const { _electron } = await import('@playwright/test')
  const app = await _electron.launch({
    args: ['.', `--user-data-dir=${userDataDirectory}`],
    cwd: REPO_ROOT,
    // The operator's own HOME and PATH: the real claude, gh and git.
    // HUSKY=0: the clone's hooks would gate Foundry's push on ci:local, which ran on this branch
    // before the canary; the canary proves Foundry's own push.
    env: {
      ...process.env,
      TERMINATOR_RUN_IN_BACKGROUND: '1',
      HUSKY: '0',
      // Its own log: other apps and test runs write the shared one at the same time.
      TERMINATOR_LOG_DIR: logDirectory,
    },
  })
  return { app, page: await app.firstWindow() }
}

const invoke = (page, channel, payload = {}) =>
  page.evaluate(
    ([name, body]) => window.electronAPI.extensionBridge.invoke(name, body),
    [channel, payload]
  )

async function whenFoundryAnswers(page) {
  const deadline = Date.now() + 120_000
  for (;;) {
    try {
      await invoke(page, 'foundry:order.list')
      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await wait(1_000)
    }
  }
}

const readOrder = (id) =>
  JSON.parse(readFileSync(join(DATA_ROOT, 'orders', id, 'order.json'), 'utf8'))

async function until(what, bound, check) {
  const deadline = Date.now() + bound
  while (Date.now() < deadline) {
    const answer = await check()
    if (answer) return answer
    await wait(POLL_MS)
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function ledger(page, orderId, action) {
  const { entries } = await invoke(page, 'foundry:ledger.query', { orderId, action })
  return entries
}

async function intake(page, id) {
  await invoke(page, 'foundry:order.converge', { id })
  return until('the red-team rounds to finish', INTAKE_BOUND_MS, () => {
    const state = readOrder(id).intake
    if (state?.state === 'failed') throw new Error(`intake failed: ${state.reason}`)
    return state?.state === 'ready'
  })
}

// Hand-off waits for main to be proven, as the Forge's Hand off button does (ADR 111).
async function baseProven(page, id) {
  return until('main to be proven', OVERALL_BOUND_MS, async () => {
    const failing = await ledger(page, id, 'environment.failing')
    if (failing.length > 0) throw new Error(`main could not be proven: ${failing[0].reason}`)
    return (await ledger(page, id, 'environment.proven')).length > 0
  })
}

async function handOff(page, id) {
  const compiled = await invoke(page, 'foundry:order.compile', { id, commit: true })
  if (compiled.error || compiled.refused || compiled.order?.status !== 'agreed') {
    throw new Error(`compile did not agree the order: ${compiled.error ?? compiled.refused}`)
  }
  const started = await invoke(page, 'foundry:run.start', { id })
  if (started.error) throw new Error(`run did not start: ${started.error}`)
}

async function awaitRun(page, id) {
  return until('the run to end', OVERALL_BOUND_MS, async () => {
    if ((await ledger(page, id, 'run.complete')).length > 0) return 'complete'
    for (const action of ['run.failed', 'run.halted', 'ship.refused', 'run.refused']) {
      const [entry] = await ledger(page, id, action)
      if (entry) throw new Error(`${action}: ${entry.reason}`)
    }
    return false
  })
}

function draftPullRequest(branch) {
  const [pr] = JSON.parse(
    run('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,isDraft'])
  )
  if (!pr?.isDraft) throw new Error(`no open draft pull request on ${branch}`)
  return pr
}

async function checkWriteBacks({ page, linear, ticket, id }) {
  const failed = await ledger(page, id, 'writeback.failed')
  if (failed.length > 0) throw new Error(`write-back failed: ${failed[0].reason}`)
  const seen = await ticketWriteBacks(linear, ticket.id)
  if (seen.comments === 0 || seen.stateType !== 'started') {
    throw new Error(`the ticket shows no write-back: ${JSON.stringify(seen)}`)
  }
}

async function createOrder({ page, linear, stage }) {
  stage.name = 'ticket'
  stage.ticket = await createTicket(linear)
  stage.name = 'order'
  const created = await invoke(page, 'foundry:order.create', {
    source: { kind: 'tracker', tracker: 'linear', key: stage.ticket.identifier },
    repoPaths: [CANARY_REPO],
    canary: true,
  })
  stage.id = (created.order ?? created.existing)?.id
  if (stage.id === undefined) throw new Error(`no order was made: ${JSON.stringify(created)}`)
}

/** The order, from ticket to draft pull request; `stage.name` says how far it got. */
async function proveOrder({ page, linear, stage }) {
  await whenFoundryAnswers(page)
  await page.evaluate(
    (folderPath) =>
      window.electronAPI.workspace.create({
        name: 'canary',
        folderPath,
        color: '#336699',
        tags: [],
      }),
    CANARY_REPO
  )
  await createOrder({ page, linear, stage })
  stage.name = 'intake'
  await intake(page, stage.id)
  stage.name = 'base branch'
  await baseProven(page, stage.id)
  stage.name = 'hand-off'
  await handOff(page, stage.id)
  stage.name = 'run'
  await awaitRun(page, stage.id)
  stage.name = 'pull request'
  draftPullRequest(`canary/${stage.id.toLowerCase()}`)
  stage.name = 'write-backs'
  await checkWriteBacks({ page, linear, ticket: stage.ticket, id: stage.id })
}

async function explain(page, stage, error) {
  console.error(`\nCanary failed at stage "${stage.name}": ${error.message}`)
  if (stage.id === undefined) return
  const { entries } = await invoke(page, 'foundry:ledger.query', { orderId: stage.id, limit: 20 })
  console.error(`Last ${entries.length} ledger entries, newest first:`)
  for (const e of entries)
    console.error(`  ${e.at} ${e.actor} ${e.action} ${e.subject}: ${e.reason}`)
}

async function quit(app) {
  const electron = app.process()
  await Promise.race([app.close().catch(() => {}), wait(15_000)])
  if (electron.exitCode === null) electron.kill('SIGKILL')
}

function recordPass() {
  const git = (...args) => run('git', args)
  const file = resolve(REPO_ROOT, git('rev-parse', '--git-path', PASS_FILE))
  writeFileSync(file, `${git('rev-parse', 'HEAD')} ${git('rev-parse', 'origin/main')}\n`)
}

/** A fresh profile holding only the operator's tracker connection. */
function freshProfile() {
  const userData = mkdtempSync(join(tmpdir(), 'terminator-canary-'))
  writeFileSync(
    join(userData, 'extension-settings.json'),
    JSON.stringify({ values: { 'terminator.foundry.dataDir': DATA_ROOT } })
  )
  return userData
}

async function main() {
  const key = linearKey()
  const userData = freshProfile()
  const logDirectory = join(userData, 'logs')
  run('npx', ['electron-vite', 'build'])
  prepareCanaryRepo()
  const { app, page } = await launchApp(userData, logDirectory)
  const stage = { name: 'start' }
  let failure = null
  let linear
  try {
    linear = linearClient(key)
    await connectTracker(page, key)
    stage.name = 'sweep'
    await clean(await findLeftovers(linear), linear)
    await proveOrder({ page, linear, stage })
  } catch (error) {
    failure = `stage "${stage.name}": ${error.message}`
    await explain(page, stage, error).catch(() => {})
  } finally {
    await quit(app)
  }
  const left = linear ? await finalSweep(linear) : []
  const logPath = join(logDirectory, 'terminator.log')
  const logTail = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  rmSync(userData, { recursive: true, force: true })
  return verdict({ failure, left, logErrors: errorLines(logTail) })
}

async function finalSweep(linear) {
  await clean(await findLeftovers(linear), linear)
  return leftovers(await findLeftovers(linear))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help') || process.argv.includes('--dry-run')) {
    console.log(`foundry-canary: ${PLAN.map((step, i) => `\n  ${i + 1}. ${step}`).join('')}`)
  } else {
    const problems = await main()
    if (problems.length > 0) {
      console.error(`\nCanary FAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
      process.exit(1)
    }
    recordPass()
    console.log(
      '\nCanary passed: a real order reached an open draft pull request and was cleaned up.'
    )
  }
}
