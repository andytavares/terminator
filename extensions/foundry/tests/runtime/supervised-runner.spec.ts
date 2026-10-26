import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { spawn as ptySpawn } from 'node-pty'
import { createSupervisedRunner } from '../../src/runtime/supervised-runner.js'
import { createControlServer, type ControlServer } from '../../src/runtime/control-server.js'
import { transcriptPathFor } from '../../src/runtime/claude-launch.js'
import type { PendingPermission } from '../../src/runtime/permission-bridge.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'
import { partialFake } from '../../../../tests/support/fakes'
import type {
  AgentsAPI,
  AgentTurnEnd,
  ExtensionAPI,
  StartAgentInput,
} from '@terminator/extension-sdk'
import { eventually } from '../../../../tests/support/eventually'

// The agent runs over ACP, in a tab of the card's worktree project, and every tool call goes
// through a PreToolUse hook that holds it still until somebody decides. What is asserted
// here is what the operator ends up with: a project, an agent tab, and a tool call that waits.

let dir: string
let control: ControlServer
let created: Array<Record<string, unknown>>
let projectId: string | null
/** The tab a command opens in; null when none can be. */
let terminalId: string | null
let closed: string[]
let ran: Array<{ file: string; args: string[] } & Record<string, unknown>>
/** How the next `runInTerminal` ends; never, unless a test says. */
let nextExit: { exitCode: number | null } | null

/** What the fake `api.agents` was asked, and the ways a test answers it. */
let agentStarts: StartAgentInput[]
let prompts: Array<{ sessionId: string; text: string; end: (turn: AgentTurnEnd) => void }>
let cancelled: string[]
let agentsClosed: string[]
let endListeners: Array<(exitCode: number | null) => void>
let detachedEnd: number
let startsAs: { sessionId: string } | null

function exitWith(exit: { exitCode: number | null }): void {
  nextExit = exit
}

/** The script a command's terminal was asked to run: the last path its `-c` execs. */
function scriptOf(input: { args: string[] }): string {
  const match = /'([^']+)'$/.exec(input.args[input.args.length - 1])
  if (match === null) throw new Error(`no script in ${input.args.join(' ')}`)
  return match[1]
}

function fakeAgents(): AgentsAPI {
  return partialFake<AgentsAPI>({
    start: async (input) => {
      agentStarts.push(input)
      return startsAs === null ? null : { ...startsAs, agentId: 'claude', configOptions: [] }
    },
    prompt: (sessionId, text) =>
      new Promise<AgentTurnEnd>((end) => prompts.push({ sessionId, text, end })),
    cancel: (sessionId) => cancelled.push(sessionId),
    close: async (sessionId) => void agentsClosed.push(sessionId),
    onEnd: (_sessionId, listener) => {
      endListeners.push(listener)
      return () => {
        detachedEnd += 1
      }
    },
  })
}

function runnerCoreApi(): ExtensionAPI {
  return partialFake<ExtensionAPI>({
    workspace: partialFake<ExtensionAPI['workspace']>({
      addProject: async (input) => {
        created.push({ ...input })
        return projectId === null ? null : { id: projectId, workspaceId: 'ws-1', name: 'p' }
      },
    }),
    agents: fakeAgents(),
    pty: partialFake<ExtensionAPI['pty']>({
      closeTerminalTab: (terminal) => void closed.push(terminal),
      runInTerminal: (input) => {
        ran.push({ ...input })
        if (terminalId === null) return Promise.resolve(null)
        if (nextExit === null) return new Promise(() => {})
        return Promise.resolve({ sessionId: terminalId, ...nextExit })
      },
    }),
  })
}

function runner(now: () => number = () => 1_000) {
  return createSupervisedRunner({
    api: runnerCoreApi(),
    control,
    stateDir: join(dir, 'state'),
    now,
  })
}

/**
 * A tool call the runner has put in front of the operator.
 *
 * Tests wait on this rather than on a timer: a held call never answers, so
 * nothing else says the request has crossed loopback, and a fixed sleep lost
 * that race on a loaded CI runner.
 */
function held() {
  const seen: PendingPermission[] = []
  let arrive: () => void = () => {}
  const arrived = new Promise<void>((resolve) => (arrive = resolve))
  return {
    seen,
    arrived,
    onPending: (p: PendingPermission) => {
      seen.push(p)
      arrive()
    },
  }
}

const start = {
  featureDir: '/repo/specs/021-thing',
  worktreePath: '/wt/feat-thing',
  workspaceId: 'ws-1',
  branch: 'feat/thing',
  title: 'Builder',
  prompt: '/speckit-implement',
  phase: 'implement' as never,
  onPending: () => {},
  onResolved: () => {},
}

beforeEach(async () => {
  dir = makeTempDir('supervised-runner-')
  control = await createControlServer()
  created = []
  projectId = 'project-1'
  terminalId = 'terminal-1'
  closed = []
  ran = []
  nextExit = null
  agentStarts = []
  prompts = []
  cancelled = []
  agentsClosed = []
  endListeners = []
  detachedEnd = 0
  startsAs = { sessionId: 'acp-1' }
})

afterEach(async () => {
  await control.close()
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
})

/** The options the runner handed Claude: settings file, model, env and the rest. */
function claudeOptions(): Record<string, unknown> {
  const meta = agentStarts[0].agentMeta as { claudeCode: { options: Record<string, unknown> } }
  return meta.claudeCode.options
}

/** The id the hook script is given: the last quoted argument of the PreToolUse command. */
function runIdOfHook(): string {
  const settings = JSON.parse(readFileSync(claudeOptions().settings as string, 'utf8'))
  const match = /'([^']+)'$/.exec(settings.hooks.PreToolUse[0].hooks[0].command)
  if (match === null) throw new Error('no run id in the hook command')
  return match[1]
}

function ask(runId: string): Promise<unknown> {
  const pending = fetch(control.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: runId, toolName: 'Bash', input: { command: 'rm -rf /' } }),
  }).then((r) => r.json())
  pending.catch(() => {})
  return pending
}

/** Ends the turn that began with `text`, as the agent does when it stops responding. */
function endTurn(text: string, stopReason = 'end_turn'): void {
  const turn = prompts.find((p) => p.text === text)
  if (turn === undefined) throw new Error(`no prompt "${text}" among ${prompts.map((p) => p.text)}`)
  turn.end({ stopReason })
}

/** Writes `count` assistant lines where the transcript of session `acp-1` would be. */
function writeTranscript(count: number): void {
  const file = transcriptPathFor(start.worktreePath, 'acp-1')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '{"type":"assistant"}\n'.repeat(count))
}

describe('the supervised runner over ACP', () => {
  beforeEach(() => {
    vi.stubEnv('HOME', join(dir, 'home'))
  })
  afterEach(() => vi.unstubAllEnvs())

  describe('starting a run', startingARunTests)
  describe('the options Claude gets', claudeOptionsTests)
  describe('mode and resume', modeAndResumeTests)
  describe('tracking the run', trackingTests)
  describe('nothing started', nothingStartedTests)
  describe('a tool call the agent may not make on its own', toolCallTests)
  describe('the operator answers', answeringTests)
  describe('the ladder answers', ladderTests)
  describe('turns', turnTests)
  describe('kinds of turn end', turnKindsTests)
  describe('the next phase', nextPhaseTests)
  describe('the next phase’s clock', phaseClockTests)
  describe('the end of the agent', endOfTheAgentTests)
  describe('disposing', disposeTests)
  describe('taking the run over', takingOverTests)
  describe('sending to the session', sendingTests)
  describe('stopping', stoppingTests)
  describe('a session that is not there', missingSessionTests)
})

function startingARunTests() {
  it('registers the worktree as a project and links the ticket (ADR-061)', async () => {
    await runner().start({ ...start, issue: { tracker: 'linear', key: 'TAV-15' } })
    expect(created[0]).toMatchObject({
      workspaceId: 'ws-1',
      name: 'feat/thing',
      worktreePath: '/wt/feat-thing',
      gitBranch: 'feat/thing',
      issue: { tracker: 'linear', key: 'TAV-15' },
    })
  })

  it('starts the agent in the worktree, as a tab of that project', async () => {
    await runner().start(start)
    expect(agentStarts[0]).toMatchObject({
      agentId: 'claude',
      cwd: '/wt/feat-thing',
      tab: { projectId: 'project-1', title: 'Builder' },
    })
    expect(agentStarts[0].resume).toBeUndefined()
  })
}

function claudeOptionsTests() {
  it('gives Claude its settings, model, effort, skill folders and environment', async () => {
    await runner().start({
      ...start,
      model: 'opus',
      effort: 'high',
      addDirs: ['/order/skills/build'],
    })
    expect(claudeOptions()).toMatchObject({
      model: 'opus',
      effort: 'high',
      additionalDirectories: ['/order/skills/build'],
      env: {
        SPECIFY_FEATURE: '021-thing',
        SPECIFY_FEATURE_DIRECTORY: 'specs/021-thing',
        CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1',
        FOUNDRY_RUN: '1',
        CLAUDE_CODE_ARTIFACT_AUTO_OPEN: '0',
      },
    })
    expect(existsSync(claudeOptions().settings as string)).toBe(true)
  })

  it('leaves the model and effort off when none was chosen, so the operator config wins', async () => {
    await runner().start({ ...start, model: '' })
    expect(claudeOptions().model).toBeUndefined()
    expect(claudeOptions().effort).toBeUndefined()
  })
}

function modeAndResumeTests() {
  it('asks for auto mode, which decides what the ladder defers', async () => {
    await runner().start(start)
    expect(agentStarts[0].mode).toBe('auto')
  })

  it('resumes an existing conversation rather than starting a second one', async () => {
    await runner().start({ ...start, resumeSessionId: 'earlier' })
    expect(agentStarts[0].resume).toBe('earlier')
  })
}

function trackingTests() {
  it('tracks the run under the id the agent chose, and says which tab it is', async () => {
    const run = await runner().start(start)
    expect(run).toMatchObject({
      sessionId: 'acp-1',
      terminalSessionId: 'acp-1',
      transcriptPath: transcriptPathFor('/wt/feat-thing', 'acp-1'),
      transcriptFrom: 0,
    })
  })

  it('marks where its own turn starts in a transcript it did not begin', async () => {
    writeTranscript(2)
    const run = await runner().start({ ...start, resumeSessionId: 'acp-1' })
    expect(run?.transcriptFrom).toBe(readFileSync(run?.transcriptPath ?? '').length)
  })

  it('registers the run before the first prompt is sent', async () => {
    const order: string[] = []
    const supervised = runner()
    await supervised.start({
      ...start,
      onRegistered: () => order.push(`registered after ${prompts.length} prompts`),
    })
    expect(order).toEqual(['registered after 0 prompts'])
    expect(prompts.map((p) => p.text)).toEqual(['/speckit-implement'])
    expect(supervised.terminalFor('acp-1')).toEqual({
      terminalSessionId: 'acp-1',
      projectId: 'project-1',
    })
  })
}

function nothingStartedTests() {
  it('starts nothing when the worktree cannot be made a project', async () => {
    projectId = null
    await expect(runner().start(start)).resolves.toBeNull()
    expect(agentStarts).toEqual([])
  })

  it('starts no run when the agent has no tab to show — an unseen agent is the old failure', async () => {
    startsAs = null
    await expect(runner().start(start)).resolves.toBeNull()
    expect(prompts).toEqual([])
  })
}

function toolCallTests() {
  it('reaches the operator, who is asked rather than the call approved for them', async () => {
    const call = held()
    const r = runner()
    await r.start({ ...start, onPending: call.onPending })
    const pending = ask(runIdOfHook())
    await call.arrived
    expect(call.seen[0]).toMatchObject({ toolName: 'Bash', summary: 'rm -rf /' })
    expect(r.resolve('acp-1', call.seen[0].requestId, { allow: false })).toBe(true)
    await pending
  })
}

function answeringTests() {
  it('waits while nobody has answered, then proceeds on allow', async () => {
    const call = held()
    const r = runner()
    await r.start({ ...start, onPending: call.onPending })
    const pending = ask(runIdOfHook())
    await call.arrived
    await expect(Promise.race([pending, Promise.resolve('unanswered')])).resolves.toBe('unanswered')
    r.resolve('acp-1', call.seen[0].requestId, { allow: true })
    expect(await pending).toMatchObject({ permissionDecision: 'allow' })
  })

  it('carries a real answer back, since the reason is the only channel for words', async () => {
    const call = held()
    const r = runner()
    await r.start({ ...start, onPending: call.onPending })
    const pending = ask(runIdOfHook())
    await call.arrived
    r.resolve('acp-1', call.seen[0].requestId, { allow: false, answer: 'use the staging host' })
    expect(await pending).toEqual({ permissionDecision: 'deny', reason: 'use the staging host' })
  })
}

function ladderTests() {
  it('is settled by the autonomy ladder without troubling the operator', async () => {
    const seen: PendingPermission[] = []
    await runner().start({
      ...start,
      autoDecide: () => ({ allow: true }),
      onPending: (p) => seen.push(p),
    })
    expect(await ask(runIdOfHook())).toMatchObject({ permissionDecision: 'allow' })
    expect(seen).toEqual([])
  })

  it('is not answered once the run has ended', async () => {
    const r = runner()
    await r.start(start)
    r.dispose()
    expect(await ask(runIdOfHook())).toMatchObject({ permissionDecision: 'ask' })
  })

  it('counts as blocked on a person while held, and working again once answered', async () => {
    const call = held()
    const r = runner()
    await r.start({ ...start, onPending: call.onPending })
    const pending = ask(runIdOfHook())
    await call.arrived
    expect(r.watchable()[0].isWaiting).toBe(true)
    r.resolve('acp-1', call.seen[0].requestId, { allow: true })
    await pending
    expect(r.watchable()[0].isWaiting).toBe(false)
  })
}

function turnTests() {
  it('reports the turn count of the transcript when the first prompt resolves', async () => {
    const turns: number[] = []
    const r = runner()
    await r.start({ ...start, onTurnEnd: (n) => turns.push(n) })
    writeTranscript(3)
    endTurn('/speckit-implement')
    await eventually(() => expect(turns).toEqual([3]))
    expect(r.watchable()[0].isWaiting).toBe(true)
  })
}

function turnKindsTests() {
  it('does not call a turn end the end of the run', async () => {
    const ends: unknown[] = []
    const r = runner()
    await r.start({ ...start, onEnd: (code) => ends.push(code) })
    endTurn('/speckit-implement')
    await eventually(() => expect(r.watchable()[0].isWaiting).toBe(true))
    expect(ends).toEqual([])
    expect(r.terminalFor('acp-1')).not.toBeNull()
  })

  it.each(['cancelled', 'error'])('reports no turn end for a %s turn', async (stopReason) => {
    const turns: number[] = []
    const r = runner()
    await r.start({ ...start, onTurnEnd: (n) => turns.push(n) })
    endTurn('/speckit-implement', stopReason)
    r.send('acp-1', 'later')
    endTurn('later')
    await eventually(() => expect(turns).toHaveLength(1))
  })
}

function nextPhaseTests() {
  it('moves the next phase into the same session and reports its turn, not the last', async () => {
    const reported: string[] = []
    const r = runner()
    const run = await r.start({ ...start, onTurnEnd: () => reported.push('implement') })
    const next = r.continueRun('acp-1', {
      prompt: '/speckit-plan\nwith a second line',
      phase: 'plan' as never,
      onPending: () => {},
      onResolved: () => {},
      onTurnEnd: () => reported.push('plan'),
    })
    expect(next).toMatchObject({ sessionId: 'acp-1', terminalSessionId: run?.terminalSessionId })
    expect(agentStarts).toHaveLength(1)
    endTurn('/speckit-plan\nwith a second line')
    await eventually(() => expect(reported).toEqual(['plan']))
  })
}

function phaseClockTests() {
  it('clears the waiting flag and restarts the silence clock on a new phase', async () => {
    let clock = 1_000
    const r = runner(() => clock)
    await r.start(start)
    endTurn('/speckit-implement')
    await eventually(() => expect(r.watchable()[0].isWaiting).toBe(true))
    clock = 20 * 60_000
    r.continueRun('acp-1', {
      prompt: '/speckit-plan',
      phase: 'plan' as never,
      onPending: () => {},
      onResolved: () => {},
    })
    expect(r.watchable()[0]).toMatchObject({ isWaiting: false, startedAt: 20 * 60_000 })
  })

  it('answers null for a session that is gone, so the caller starts a fresh one', () => {
    const next = runner().continueRun('nope', {
      prompt: '/x',
      phase: 'plan' as never,
      onPending: () => {},
      onResolved: () => {},
    })
    expect(next).toBeNull()
    expect(prompts).toEqual([])
  })
}

function endOfTheAgentTests() {
  it('ends the run clean on exit 0, and closes the tab', async () => {
    const ends: unknown[] = []
    const r = runner()
    await r.start({ ...start, onEnd: (code) => ends.push(code) })
    endListeners[0](0)
    expect(ends).toEqual([0])
    expect(agentsClosed).toEqual(['acp-1'])
    expect(r.terminalFor('acp-1')).toBeNull()
    expect(r.watchable()).toEqual([])
  })

  it.each([1, null])('ends on exit %s and leaves the tab open to read why', async (code) => {
    const ends: unknown[] = []
    await runner().start({ ...start, onEnd: (exitCode) => ends.push(exitCode) })
    endListeners[0](code)
    expect(ends).toEqual([code])
    expect(agentsClosed).toEqual([])
  })

  it('stops listening for the exit once the run is over', async () => {
    await runner().start(start)
    endListeners[0](0)
    expect(detachedEnd).toBe(1)
  })
}

function disposeTests() {
  it('ends each running session with no exit code on dispose, so nothing waits for ever', async () => {
    const ends: unknown[] = []
    const r = runner()
    await r.start({ ...start, onEnd: (code) => ends.push(code) })
    r.dispose()
    expect(ends).toEqual([null])
    expect(r.watchable()).toEqual([])
  })
}

function takingOverTests() {
  it('sends a message to the session, multi-line text as it is', async () => {
    const r = runner()
    await r.start(start)
    expect(r.send('acp-1', 'use staging\nnot prod')).toBe(true)
    expect(prompts.at(-1)).toMatchObject({ sessionId: 'acp-1', text: 'use staging\nnot prod' })
  })
}

function sendingTests() {
  it('is working again once it has been given something to do', async () => {
    let clock = 1_000
    const r = runner(() => clock)
    await r.start(start)
    endTurn('/speckit-implement')
    await eventually(() => expect(r.watchable()[0].isWaiting).toBe(true))
    clock = 9 * 60_000
    r.send('acp-1', 'carry on')
    expect(r.watchable()[0]).toMatchObject({ isWaiting: false, startedAt: 9 * 60_000 })
  })

  it('interrupts by cancelling the turn, leaving the run open', async () => {
    const r = runner()
    await r.start(start)
    r.interrupt('acp-1')
    expect(cancelled).toEqual(['acp-1'])
    expect(r.terminalFor('acp-1')).not.toBeNull()
  })
}

function stoppingTests() {
  it('cancels the turn, says the reason, waits for that turn, then closes', async () => {
    const r = runner()
    await r.start(start)
    expect(r.stop('acp-1', 'budget is spent')).toBe(true)
    expect(cancelled).toEqual(['acp-1'])
    expect(prompts.at(-1)?.text).toBe('budget is spent')
    expect(agentsClosed).toEqual([])
    endTurn('budget is spent')
    await eventually(() => expect(agentsClosed).toEqual(['acp-1']))
  })

  it('closes at once when there is nothing to say', async () => {
    const r = runner()
    await r.start(start)
    r.stop('acp-1')
    await eventually(() => expect(agentsClosed).toEqual(['acp-1']))
    expect(prompts.map((p) => p.text)).toEqual(['/speckit-implement'])
  })
}

function missingSessionTests() {
  it('refuses, reports false or shrugs, for every action', () => {
    const r = runner()
    expect(r.resolve('nope', 'r', { allow: true })).toBe(false)
    expect(r.stop('nope')).toBe(false)
    expect(r.send('nope', 'hi')).toBe(false)
    expect(r.terminalFor('nope')).toBeNull()
    r.interrupt('nope')
    r.handBackToTerminal('nope', 'r')
    expect(cancelled).toEqual([])
  })

  it('ends twice without complaint, since the agent and a dispose may both report it', async () => {
    const ends: unknown[] = []
    const r = runner()
    await r.start({ ...start, onEnd: (code) => ends.push(code) })
    endListeners[0](0)
    expect(() => r.dispose()).not.toThrow()
    expect(ends).toEqual([0])
  })
}

const command = {
  worktreePath: '/wt/feat-thing',
  workspaceId: 'ws-1',
  branch: 'feat/thing',
  title: 'Lint',
  command: 'npm run lint',
}

describe('running one command in a terminal, with no agent', () => {
  describe('opening the tab', openingTheTabTests)
  describe('exit statuses', supervisedRunnerExitStatusesTests)
})

function openingTheTabTests() {
  it("links the order's ticket to the project a command opens, too", async () => {
    exitWith({ exitCode: 0 })
    await runner().runCommand({ ...command, issue: { tracker: 'linear', key: 'TAV-15' } })
    expect(created[0]).toMatchObject({ issue: { tracker: 'linear', key: 'TAV-15' } })
  })

  it('opens a plain terminal tab in the worktree project', async () => {
    exitWith({ exitCode: 0 })
    await runner().runCommand(command)
    expect(created[0]).toMatchObject({ worktreePath: '/wt/feat-thing', gitBranch: 'feat/thing' })
    expect(ran[0]).toMatchObject({
      projectId: 'project-1',
      cwd: '/wt/feat-thing',
      tabTitle: 'Lint',
      type: 'human',
    })
  })

  // Typed into an interactive shell, the verdict was that shell's exit, and closing the tab
  // read as exit 0 (extensions/foundry/CLAUDE.md, "Verification commands").
  it("runs the command's script as the terminal's process, typing nothing", async () => {
    exitWith({ exitCode: 0 })
    await runner().runCommand(command)
    const shell = process.env.SHELL ?? '/bin/sh'
    expect(ran[0].file).toBe(shell)
    // An interactive login shell reads the startup files, then execs the script.
    expect(ran[0].args).toEqual(['-i', '-l', '-c', `exec '${shell}' '${scriptOf(ran[0])}'`])
    expect(readFileSync(scriptOf(ran[0]), 'utf8')).toContain('npm run lint')
  })
}

function supervisedRunnerExitStatusesTests() {
  it('resolves 0 for a command that exited 0, and closes its tab', async () => {
    exitWith({ exitCode: 0 })
    await expect(runner().runCommand(command)).resolves.toBe(0)
    expect(closed).toEqual(['terminal-1'])
  })

  it('resolves the status of a command that failed, and keeps its tab on screen', async () => {
    exitWith({ exitCode: 2 })
    await expect(runner().runCommand(command)).resolves.toBe(2)
    expect(closed).toEqual([])
  })

  // Killed by a signal, or its tab closed before it finished: the core has no
  // exit status to give, and "not measured" is the only honest verdict.
  it('resolves null, never 0, for a command that ended without an exit status', async () => {
    exitWith({ exitCode: null })
    await expect(runner().runCommand(command)).resolves.toBeNull()
    expect(closed).toEqual([])
  })

  it('resolves null when no project or terminal could be opened', async () => {
    projectId = null
    await expect(runner().runCommand(command)).resolves.toBeNull()
    projectId = 'project-1'
    terminalId = null
    await expect(runner().runCommand(command)).resolves.toBeNull()
  })
}

// A command step's output used to vanish the moment the tab scrolled past it.
// logPath tees stdout+stderr to a file while keeping the script's own exit
// status as the verdict — the command's status, never tee's.
const LOG_SHELLS = ['/bin/sh', ...(existsSync('/bin/zsh') ? ['/bin/zsh'] : [])]

let logDir: string

/** The script the runner hands the terminal for `commandLine`, teeing to `logPath` if given. */
async function scriptFor(
  commandLine: string,
  logPath?: string,
  env?: Record<string, string>
): Promise<string> {
  exitWith({ exitCode: 0 })
  await runner().runCommand({
    worktreePath: '/wt/feat-thing',
    workspaceId: 'ws-1',
    branch: 'feat/thing',
    title: 'Check',
    command: commandLine,
    logPath,
    env,
  })
  return scriptOf(ran[ran.length - 1])
}

describe('running a command with a log file', () => {
  beforeEach(() => {
    logDir = makeTempDir('supervised-runner-log-')
  })

  afterEach(() => {
    rmSync(logDir, { recursive: true, force: true, maxRetries: 5 })
  })

  for (const shell of LOG_SHELLS) loggedCommandTests(shell)
  for (const shell of LOG_SHELLS) exportedEnvironmentTests(shell)

  it('has no tee when logPath is absent', async () => {
    expect(readFileSync(await scriptFor('npm run lint'), 'utf8')).not.toContain('tee')
  })
})

function loggedCommandTests(shell: string) {
  it(`(${shell}) exits with the command's status, not tee's, and writes the log`, async () => {
    const logPath = join(logDir, 'false.log')
    const result = spawnSync(shell, [await scriptFor('false', logPath)])
    expect(result.status).toBe(1)
    expect(existsSync(logPath)).toBe(true)
  })

  it(`(${shell}) captures the command's exit code and its combined output in the log`, async () => {
    const logPath = join(logDir, 'echo.log')
    const result = spawnSync(shell, [await scriptFor('echo hello; exit 3', logPath)])
    expect(result.status).toBe(3)
    expect(readFileSync(logPath, 'utf8')).toContain('hello')
  })
}

// A line like `exec VAR=1 cmd` once broke every agent (exit 127), so the variables are
// real `export` lines, and this runs them in a real shell with a value that needs quoting.
function exportedEnvironmentTests(shell: string) {
  const awkward = `my folder/it's "quoted" $HOME`

  it(`(${shell}) gives the command the variable exactly as set, with and without a log`, async () => {
    const out = join(logDir, 'seen.txt')
    const printing = `printf '%s' "$FOUNDRY_PICTURES" > '${out}'`
    for (const logPath of [undefined, join(logDir, 'env.log')]) {
      const script = await scriptFor(printing, logPath, { FOUNDRY_PICTURES: awkward })
      expect(spawnSync(shell, [script]).status).toBe(0)
      expect(readFileSync(out, 'utf8')).toBe(awkward)
      rmSync(out)
    }
  })

  it(`(${shell}) exports each variable on its own line before the command runs`, async () => {
    const script = readFileSync(await scriptFor('true', undefined, { ONE: '1', TWO: '2' }), 'utf8')
    expect(script).toMatch(/^export ONE='1'\nexport TWO='2'$/m)
    expect(script.indexOf("export TWO='2'")).toBeLessThan(script.lastIndexOf('true'))
  })
}

// The app adopts only PATH from the login shell, so a bare `$SHELL script` lost what startup
// files export (extensions/foundry/CLAUDE.md, "Verification commands"). A real PTY and a
// temporary HOME whose startup file is the only place a variable is set; the check must see it.
interface StartupShell {
  shell: string
  files: Record<string, string>
}

/** Each shell there is, and the startup files where it reads the one variable a check needs. */
const EVERY_STARTUP_SHELL: StartupShell[] = [
  // An interactive login bash reads ~/.bash_profile, which is where the
  // usual setup sources ~/.bashrc from.
  {
    shell: '/bin/bash',
    files: {
      '.bash_profile': '[ -f ~/.bashrc ] && . ~/.bashrc\n',
      '.bashrc': 'export FOUNDRY_RC_ONLY=from-rc\n',
    },
  },
  {
    shell: '/bin/zsh',
    files: {
      // Debian and Ubuntu's /etc/zsh/zshrc runs compinit, which stops to ask
      // about group-writable system directories on CI's runner; that file's
      // own documented opt-out is this line in ~/.zshenv.
      '.zshenv': 'skip_global_compinit=1\n',
      '.zshrc': 'export FOUNDRY_RC_ONLY=from-rc\n',
    },
  },
]

const STARTUP_SHELLS = EVERY_STARTUP_SHELL.filter(({ shell }) => existsSync(shell))

let home: string
const savedEnv = { HOME: process.env.HOME, SHELL: process.env.SHELL }
/** What the tab printed, so a check that never ends says what the shell is waiting on. */
let printed = ''

/** Runs `input` in a real node-pty, ending it the way the core does when its tab closes. */
function runInRealPty(input: { file: string; args: string[]; cwd: string }) {
  return new Promise((resolve) => {
    const proc = ptySpawn(input.file, input.args, {
      cwd: input.cwd,
      env: process.env as Record<string, string>,
    })
    proc.onData((data) => {
      printed += data
      // Closing the tab: the core sends the process SIGHUP.
      if (data.includes('hang-up-now')) proc.kill('SIGHUP')
    })
    // As PtyManager reports it: null when a signal ended the process.
    proc.onExit(({ exitCode, signal }) =>
      resolve({ sessionId: 'terminal-1', exitCode: signal ? null : exitCode })
    )
  })
}

/** The core's runInTerminal, over a real node-pty and nothing else. */
function realPtyApi(): ExtensionAPI {
  const project = { id: 'project-1', workspaceId: 'ws-1', name: 'p' }
  return partialFake<ExtensionAPI>({
    workspace: partialFake<ExtensionAPI['workspace']>({ addProject: async () => project }),
    pty: partialFake<ExtensionAPI['pty']>({
      write: () => {},
      closeTerminalTab: () => {},
      runInTerminal: runInRealPty as ExtensionAPI['pty']['runInTerminal'],
    }),
  })
}

function runCheck(commandLine: string, logPath?: string): Promise<number | null> {
  return createSupervisedRunner({
    api: realPtyApi(),
    control,
    stateDir: join(dir, 'state'),
    now: () => 1_000,
  }).runCommand({
    worktreePath: dir,
    workspaceId: 'ws-1',
    branch: 'feat/thing',
    title: 'Check',
    command: commandLine,
    logPath,
  })
}

async function checkOrTimeOut(commandLine: string, logPath?: string): Promise<number | null> {
  const result: { ended: boolean; exitCode: number | null } = { ended: false, exitCode: null }
  const check = runCheck(commandLine, logPath).then((exitCode) =>
    Object.assign(result, { ended: true, exitCode })
  )
  await eventually(() => {
    if (!result.ended) throw new Error(`the check never ended; it printed:\n${printed}`)
  })
  await check
  return result.exitCode
}

/** Makes `startup.shell` the user's shell, in a HOME holding only its startup files. */
function withStartupShell(startup: StartupShell): void {
  for (const [name, body] of Object.entries(startup.files)) writeFileSync(join(home, name), body)
  process.env.HOME = home
  process.env.SHELL = startup.shell
}

describe('a check sees what the user’s shell startup files export', () => {
  beforeEach(() => {
    printed = ''
    home = makeTempDir('supervised-runner-home-')
    delete process.env.FOUNDRY_RC_ONLY
  })

  afterEach(() => {
    process.env.HOME = savedEnv.HOME
    process.env.SHELL = savedEnv.SHELL
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })

  for (const startup of STARTUP_SHELLS) startupFileTests(startup)
})

function startupFileTests(startup: StartupShell) {
  const { shell } = startup

  it(`(${shell}) passes a check that needs a variable only a startup file exports`, async () => {
    withStartupShell(startup)
    await expect(checkOrTimeOut('test "$FOUNDRY_RC_ONLY" = from-rc')).resolves.toBe(0)
  })

  it(`(${shell}) still resolves the command's own exit code, not the shell's`, async () => {
    withStartupShell(startup)
    await expect(checkOrTimeOut('echo "$FOUNDRY_RC_ONLY"; exit 3')).resolves.toBe(3)
  })

  // bash ends by the signal (null, "not measured"); zsh catches SIGHUP and
  // exits 1. Either way a check nobody let finish is never a pass.
  it(`(${shell}) never passes a check whose tab was closed while it ran`, async () => {
    withStartupShell(startup)
    await expect(checkOrTimeOut('echo hang-up-"now"; sleep 30')).resolves.not.toBe(0)
  })

  it(`(${shell}) keeps both through the log file`, async () => {
    withStartupShell(startup)
    const logPath = join(home, 'logs', 'check.log')
    await expect(checkOrTimeOut('echo "$FOUNDRY_RC_ONLY"; exit 3', logPath)).resolves.toBe(3)
    expect(readFileSync(logPath, 'utf8')).toContain('from-rc')
  })
}
