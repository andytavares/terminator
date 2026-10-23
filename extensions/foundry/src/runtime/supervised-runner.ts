import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { shellQuote } from '@terminator/extension-sdk/node'
import { buildLaunchSpec } from './claude-launch.js'
import { installHookScript } from './hook-script.js'
import type { ControlServer } from './control-server.js'
import {
  createPermissionBridge,
  type PendingPermission,
  type PermissionDecision,
  type PermissionOutcome,
} from './permission-bridge.js'
import { countTurns, transcriptSize } from './transcript-tailer.js'
import type { WatchedRun } from './stall-watcher.js'

/**
 * Which step of the run this is — a run-graph node id.
 *
 * It was one of ten fixed phase names. It is a string now because the shape of
 * work is chosen per order, so the set of steps is not knowable here.
 */
type StepLabel = string

// Running a phase where the operator can see it.
//
// This replaces spawning `claude --print --permission-mode bypassPermissions`
// as a hidden child process. Two things were wrong with that, and they
// compounded: the run was invisible — no terminal, nothing to read, nothing to
// type into, and taking over meant resuming the conversation somewhere else —
// and it approved every tool call on the operator's behalf without telling
// them. A card could rewrite anything in its worktree and the first you knew
// was the diff.
//
// So the agent runs in a real terminal, in the card's own worktree project, and
// every tool call goes through a PreToolUse hook that holds it still until
// somebody decides. The operator can type in that same terminal at any time
// without the runner losing track, because what it watches is the transcript
// and the hooks rather than the process.

export interface SupervisedRun {
  /** The claude session id, which this chose. `--resume` continues it. */
  readonly sessionId: string
  /** The terminal it is running in, so a surface can go to it. */
  readonly terminalSessionId: string
  /** Where the runtime writes its record, known before it exists. */
  readonly transcriptPath: string
  /**
   * How big that transcript was when this run was launched, in bytes.
   *
   * Zero for a new conversation. For a resumed one it marks everything the
   * earlier nodes of this lane wrote: read past it and a rung answers with
   * their tool calls rather than its own. A live run's `test` rung found the
   * architect's `npm test`, from before the change existed.
   */
  readonly transcriptFrom: number
}

export interface StartSupervisedRunOptions {
  featureDir: string
  worktreePath: string
  workspaceId: string
  /** The branch the worktree is on — names the project. */
  branch: string
  /** What the tab is called: the agent, as a person names it ("Red team"). */
  title: string
  /** The order's ticket, linked to the project (ADR-061). */
  issue?: { tracker: 'linear' | 'jira'; key: string }
  /** What to tell the agent: a `/speckit-*` command, or a reply to it. */
  prompt: string
  phase: StepLabel
  /** Resume an existing conversation rather than starting one. */
  resumeSessionId?: string
  /** What `--model` gets. Empty or absent leaves the flag off entirely. */
  model?: string
  /** What `--effort` gets. Absent leaves the flag off entirely. */
  effort?: string
  /**
   * Where this node's skills were mounted, one `--add-dir` per entry. Absent
   * or empty mounts none.
   */
  addDirs?: string[]
  /** Decides without asking when the autonomy ladder allows it. */
  autoDecide?: (toolName: string, input: unknown) => PermissionDecision | 'mode' | null
  /** The ladder refused something without asking. Only refusals are reported. */
  onAutoDenied?: (toolName: string, reason: string) => void
  onPending: (pending: PendingPermission) => void
  onResolved: (requestId: string, decision: PermissionOutcome) => void
  /**
   * The run exists and can be found, before anything is typed into it.
   *
   * Ordering, not decoration: the launch command goes to the terminal inside
   * `start`, and anything the agent does between that write and `start`
   * returning would reach a caller that had not registered the run yet.
   */
  onRegistered?: (run: SupervisedRun) => void
  /** The agent stopped responding and is waiting. Not an ending. */
  onTurnEnd?: (turns: number) => void
  /**
   * The conversation is over, with the terminal's exit code when there is one.
   *
   * Zero when the runtime reported a clean `SessionEnd`; whatever the shell
   * exited with when the process died, and null when closing the tab or a
   * signal ended it. A phase that
   * crashed must not land in `awaiting_review`, which is an approval gate over
   * nothing.
   */
  onEnd?: (exitCode: number | null) => void
}

/**
 * The parts of a run that belong to the phase rather than to the session.
 *
 * Everything here is rebound when a card moves from one phase to the next in
 * the same conversation: the terminal, the session id and the transcript are
 * the card's, but "which phase finished" is not.
 */
interface PhaseCallbacks {
  onPending: (pending: PendingPermission) => void
  onResolved: (requestId: string, decision: PermissionOutcome) => void
  /** The ladder refused something without asking. Only refusals are reported. */
  onAutoDenied?: (toolName: string, reason: string) => void
  onTurnEnd?: (turns: number) => void
  onEnd?: (exitCode: number | null) => void
}

export interface RunCommandOptions {
  worktreePath: string
  workspaceId: string
  /** The branch the worktree is on — names the project. */
  branch: string
  /** The order's ticket, linked to the project (ADR-061). */
  issue?: { tracker: 'linear' | 'jira'; key: string }
  /** What the tab is called: the check being run. */
  title: string
  command: string
  /** Absolute path to tee the command's combined stdout+stderr into. */
  logPath?: string
  /** Variables the command runs with, exported by the tab's script before it starts. */
  env?: Record<string, string>
}

export interface SupervisedRunner {
  start(options: StartSupervisedRunOptions): Promise<SupervisedRun | null>
  /**
   * Runs the next phase inside a conversation that is already open.
   *
   * A card used to get one terminal, one session and one `claude` process per
   * phase: five tabs for a single card, five transcripts, five agents that had
   * each read the spec from scratch — and, because the earlier ones never
   * exited, four of them sitting idle in the run list looking stalled.
   *
   * Returns null when the session is no longer live, which is the caller's
   * signal to start a fresh one rather than silently drop the phase.
   */
  continueRun(
    sessionId: string,
    options: { prompt: string; phase: StepLabel } & PhaseCallbacks
  ): SupervisedRun | null
  /**
   * Runs one shell command in its own terminal tab, and resolves with its exit
   * status. No agent: a command's inputs fully decide what it does, and its
   * verdict is the exit status, so a model in between adds cost and a
   * transcript to read back, and nothing else.
   *
   * Null when no project or tab could be opened, or when the command ended
   * without an exit status (a signal, or its tab closed first) — "not
   * measured", never a pass.
   */
  runCommand(options: RunCommandOptions): Promise<number | null>
  /** The card's open conversation, if it still has one. */ /**
   * Answers a tool call the operator was asked about.
   *
   * False when it was no longer waiting — already answered, handed back, or the
   * run ended — so a surface can say so rather than report a success that
   * changed nothing.
   */
  resolve(sessionId: string, requestId: string, decision: PermissionDecision): boolean
  /** Gives one back to the terminal, for answering where the agent is. */
  handBackToTerminal(sessionId: string, requestId: string): void
  /** Ends the current turn, leaving the session open so a redirect lands. */
  interrupt(sessionId: string): void
  /** Ends the run, saying why first so the agent's own record carries it. */
  stop(sessionId: string, reason?: string): boolean
  /** Sends a further message — a reply, or a redirect. */
  send(sessionId: string, message: string): boolean
  /**
   * Where a session is running, for a surface that wants to go there.
   *
   * The project as well as the tab: the core's navigation needs both — it
   * selects the workspace and project before the session — and the extension's
   * UI is a separate renderer, so it cannot work the project out for itself.
   */
  terminalFor(sessionId: string): { terminalSessionId: string; projectId: string } | null
  /**
   * The live runs, as the stall detector needs them. Read each tick rather than
   * subscribed to, so a run that ends simply drops out.
   */
  watchable(): WatchedRun[]
  dispose(): void
}

/**
 * One line, whatever was typed.
 *
 * A newline in a terminal is "send". A three-line redirect pasted into the box
 * therefore arrived as three separate turns, the agent answering the first
 * fragment before it had read the rest.
 */
function oneLine(text: string): string {
  return text.replace(/\r?\n/g, ' ').trim()
}

// The shell's arguments for a check: `-i -l -c` reads the startup files a typed command
// got (https://zsh.sourceforge.io/Doc/Release/Files.html, https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files.html),
// then `exec` makes the single-quoted script the process whose exit code is reported.
function startupFilesThen(shell: string, script: string): string[] {
  return ['-i', '-l', '-c', `exec ${shellQuote(shell)} ${shellQuote(script)}`]
}

/** Escape. Ends the turn and keeps the session, which is what makes a redirect land. */
const INTERRUPT = '\x1b'

/** Ends the conversation the way a person would, so the runtime writes its record. */
const EXIT = '/exit\r'

interface Running {
  bridge: ReturnType<typeof createPermissionBridge>
  /** Stops listening for the terminal's exit once the run is over. */
  detachExit: (() => void) | null
  terminalSessionId: string
  projectId: string
  transcriptPath: string
  featureDir: string
  startedAt: number
  /** True while a tool call is held: blocked on a person is not stuck. */
  isWaiting: boolean
  release: () => void
  /**
   * Whose callbacks the next hook or turn-end belongs to.
   *
   * A one-field box rather than the callbacks themselves, and shared with the
   * closures `start` installed on the bridge and the control server. The
   * session outlives the phase, so `continueRun` has to redirect callbacks
   * those closures captured before this record existed — a permission raised
   * during `plan` must not be reported against `specify`.
   */
  readonly phase: { current: PhaseCallbacks & { id: StepLabel } }
}

export interface SupervisedRunnerOptions {
  api: ExtensionAPI
  control: ControlServer
  /** Where per-session settings and the hook script are written. */
  stateDir: string
  now?: () => number
}

/**
 * The parent Claude Code session's own variables.
 *
 * Identity and transport, never preferences: an agent that inherits these is
 * an agent talking on somebody else's channel.
 */
const INHERITED_SESSION_VARS = [
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_PID',
  'CLAUDECODE',
] as const

/** What every part of one runner shares: the host, the control server, and the live runs. */
interface RunnerContext {
  readonly api: ExtensionAPI
  readonly control: ControlServer
  /** Where per-session settings and the hook script are written. */
  readonly stateDir: string
  readonly now: () => number
  readonly hookScriptPath: string
  readonly running: Map<string, Running>
}

function runnerContext(options: SupervisedRunnerOptions): RunnerContext {
  return {
    api: options.api,
    control: options.control,
    stateDir: options.stateDir,
    now: options.now ?? Date.now,
    hookScriptPath: installHookScript(options.stateDir),
    running: new Map<string, Running>(),
  }
}

export function createSupervisedRunner(options: SupervisedRunnerOptions): SupervisedRunner {
  const context = runnerContext(options)
  const { running } = context
  return {
    start: (start) => startSupervisedRun(context, start),
    runCommand: (command) => runCommandInTab(context, command),
    continueRun: (sessionId, next) => continueRun(context, sessionId, next),
    resolve: (sessionId, requestId, decision) =>
      running.get(sessionId)?.bridge.resolve(requestId, decision) ?? false,
    handBackToTerminal: (sessionId, requestId) =>
      running.get(sessionId)?.bridge.handBackToTerminal(requestId),
    interrupt: (sessionId) => interruptRun(context, sessionId),
    stop: (sessionId, reason) => stopSupervisedRun(context, sessionId, reason),
    send: (sessionId, message) => sendToSession(context, sessionId, message),
    terminalFor: (sessionId) => terminalOf(running.get(sessionId)),
    watchable: () => watchableRuns(running),
    dispose: () => {
      for (const [sessionId, run] of [...running.entries()]) {
        end(context, sessionId, false)
        // The session is gone with no exit code of its own, so whatever waits on it can end.
        run.phase.current.onEnd?.(null)
      }
    },
  }
}

// The launch as a file the terminal runs, not a typed line: canonical mode mangles a
// line past `MAX_CANON`, and a brief is longer. The `cat` echo keeps the whole command
// readable in the terminal (SUPERVISION.md, "The launch is a file, not a typed line").
function writeLaunchScript(
  stateDir: string,
  sessionId: string,
  parts: { exports: string; command: string }
): string {
  const dir = path.join(stateDir, 'launch')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${sessionId}.sh`)
  fs.writeFileSync(
    file,
    [
      '#!/bin/sh',
      '# Written by Terminator. One per session; overwritten on every start.',
      // A fresh agent must not inherit the parent Claude Code session's identity from
      // the environment (SUPERVISION.md, "A fresh agent, not the parent's session").
      `unset ${INHERITED_SESSION_VARS.join(' ')}`,
      parts.exports,
      // A quoted heredoc: nothing in the brief is expanded or run.
      "cat <<'TERMINATOR_LAUNCH'",
      parts.command,
      'TERMINATOR_LAUNCH',
      `exec ${parts.command}`,
      '',
    ].join('\n'),
    { mode: 0o700 }
  )
  return file
}

/** One check's command, the id its script is named by, and where its output is kept. */
interface CommandScript {
  readonly id: string
  readonly command: string
  readonly logPath?: string
  readonly env?: Readonly<Record<string, string>>
}

// A script that shows the command, runs it and exits with its status, which is the
// tab's. Run by the shell, not `exec`ed, so `&&` in a command still works.
function writeCommandScript(
  stateDir: string,
  { id, command, logPath, env = {} }: CommandScript
): string {
  const dir = path.join(stateDir, 'launch')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${id}.sh`)
  fs.writeFileSync(
    file,
    [
      '#!/bin/sh',
      '# Written by Terminator. One per command; overwritten on every run.',
      // Real `export` lines: `exec VAR=1 cmd` once broke every agent with exit 127.
      ...Object.entries(env).map(([name, value]) => `export ${name}=${shellQuote(value)}`),
      "cat <<'TERMINATOR_LAUNCH'",
      command,
      'TERMINATOR_LAUNCH',
      logPath === undefined ? command : teedRunLine(file, command, logPath),
      '',
    ].join('\n'),
    { mode: 0o700 }
  )
  return file
}

// The line that runs the command, output kept in `logPath`, status the script's. No
// `pipefail` (the user's $SHELL may lack it): a status file survives the pipe to tee.
function teedRunLine(file: string, command: string, logPath: string): string {
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  const statusFile = `${file}.status`
  // A subshell, not a brace group: a command that calls `exit` would otherwise end the
  // script before the status file is written.
  return `{ ( ${command} ); echo $? > ${shellQuote(statusFile)}; } 2>&1 | tee ${shellQuote(logPath)}; exit "$(cat ${shellQuote(statusFile)})"`
}

/** `clean` closes a finished agent's tab; a failed one stays open to read why. */
function end(context: RunnerContext, sessionId: string, clean: boolean): void {
  const run = context.running.get(sessionId)
  if (run === undefined) return
  context.running.delete(sessionId)
  run.detachExit?.()
  // Anything still waiting can no longer be answered from here, and an
  // unresolved promise holds the agent's tool call open forever.
  run.bridge.rejectAll('This run has ended')
  run.release()
  // Last and optional: an installed host older than `closeTerminalTab`
  // threw here and skipped everything after it.
  if (clean) context.api.pty.closeTerminalTab?.(run.terminalSessionId)
}

async function startSupervisedRun(
  context: RunnerContext,
  start: StartSupervisedRunOptions
): Promise<SupervisedRun | null> {
  // Ours, not the runtime's. Choosing it means the transcript path is known
  // before the process exists and a hook callback needs no correlation.
  const sessionId = start.resumeSessionId ?? randomUUID()

  // A box shared with the record, so `continueRun` can move a hook to another phase
  // without a new session; the closures exist before the record does.
  const phase: Running['phase'] = { current: { id: start.phase, ...start } }

  const bridge = permissionBridgeFor(context, sessionId, { phase, autoDecide: start.autoDecide })
  const spec = launchSpecFor(context, sessionId, start)
  const release = registerControl(context, sessionId, { bridge, phase, spec })

  const opened = await openSupervisedTerminal(context, start)
  if (opened === null) {
    release()
    return null
  }
  const { projectId, terminalSessionId } = opened
  const { transcriptPath } = spec
  const featureDir = start.featureDir
  const run = trackRun(context, sessionId, {
    bridge,
    release,
    phase,
    projectId,
    terminalSessionId,
    transcriptPath,
    featureDir,
  })

  // Registered before a single keystroke reaches the terminal: the launch
  // command is written below, and a hook or turn-end arriving before the
  // caller had added the run would hit an empty registry and be dropped.
  start.onRegistered?.({ ...run })
  typeLaunch(context, run, { featureDir, command: spec.command })
  return run
}

/** What a run's permission bridge reports to: the phase it belongs to now. */
interface BridgeSeams {
  readonly phase: Running['phase']
  readonly autoDecide: StartSupervisedRunOptions['autoDecide']
}

function permissionBridgeFor(
  context: RunnerContext,
  sessionId: string,
  { phase, autoDecide }: BridgeSeams
): Running['bridge'] {
  const { running, now } = context
  return createPermissionBridge({
    sessionId,
    now,
    autoDecide,
    onAutoDenied: (toolName, reason) => phase.current.onAutoDenied?.(toolName, reason),
    onPending: (pending) => {
      // Held on a person, so the detector must not call it stuck.
      const run = running.get(sessionId)
      if (run !== undefined) run.isWaiting = true
      phase.current.onPending(pending)
    },
    onResolved: (requestId, decision) => {
      const run = running.get(sessionId)
      if (run !== undefined) {
        run.isWaiting = false
        // However long the operator took is not the agent's silence.
        run.startedAt = now()
      }
      phase.current.onResolved(requestId, decision)
    },
  })
}

function launchSpecFor(
  context: RunnerContext,
  sessionId: string,
  start: StartSupervisedRunOptions
): ReturnType<typeof buildLaunchSpec> {
  const { control } = context
  return buildLaunchSpec({
    sessionId,
    resume: start.resumeSessionId !== undefined,
    cwd: start.worktreePath,
    prompt: start.prompt,
    model: start.model,
    effort: start.effort,
    addDirs: start.addDirs,
    settingsDirectory: path.join(context.stateDir, 'settings'),
    hookScriptPath: context.hookScriptPath,
    controlUrl: control.url,
    controlEventUrl: control.eventUrl,
    controlToken: control.token,
  })
}

/** What the control server's hooks for one session reach. */
interface ControlSeams {
  readonly bridge: Running['bridge']
  readonly phase: Running['phase']
  readonly spec: { readonly transcriptPath: string }
}

/** The session's hooks on the control server; returns what releases them. */
function registerControl(
  context: RunnerContext,
  sessionId: string,
  { bridge, phase, spec }: ControlSeams
): () => void {
  return context.control.register(sessionId, {
    decide: (request) => bridge.canUseTool(request.toolName, request.input),
    onEvent: (kind) => {
      const run = context.running.get(sessionId)
      if (kind === 'stop') {
        // Finished responding and sitting at the prompt is blocked on a person, like a
        // held call, so the stall detector must not read a finished phase as stuck.
        if (run !== undefined) run.isWaiting = true
        phase.current.onTurnEnd?.(countTurns(spec.transcriptPath))
        return
      }
      phase.current.onEnd?.(0)
      end(context, sessionId, true)
    },
  })
}

/** Where a run lives: its worktree's project, and the terminal tab in it. */
async function openSupervisedTerminal(
  { api }: RunnerContext,
  start: StartSupervisedRunOptions
): Promise<{ projectId: string; terminalSessionId: string } | null> {
  // The worktree becomes a project, so the terminal has somewhere to live
  // and the operator can find it in the sidebar rather than only in a card.
  const project = await api.workspace.addProject({
    workspaceId: start.workspaceId,
    name: start.branch,
    worktreePath: start.worktreePath,
    gitBranch: start.branch,
    issue: start.issue,
  })
  if (project === null) return null

  const terminalSessionId = await api.pty.openTerminal({
    projectId: project.id,
    cwd: start.worktreePath,
    tabTitle: start.title,
    type: 'agent',
  })
  // No terminal, no run. Said out loud rather than starting an agent
  // nobody can see, which is the thing this replaced.
  if (terminalSessionId === null) return null
  return { projectId: project.id, terminalSessionId }
}

/** The record of a run, from the moment its terminal exists; returns how a caller finds it. */
function trackRun(
  context: RunnerContext,
  sessionId: string,
  run: Omit<Running, 'detachExit' | 'startedAt' | 'isWaiting'>
): SupervisedRun {
  // The terminal dying is the other way a run ends: `session_end` fires only when the
  // runtime exits cleanly, so a closed tab would leave the phase `running`.
  const detachExit =
    context.api.pty.onExit?.(run.terminalSessionId, (exitCode: number | null) => {
      run.phase.current.onEnd?.(exitCode)
      end(context, sessionId, exitCode === 0)
    }) ?? null

  context.running.set(sessionId, {
    ...run,
    detachExit,
    startedAt: context.now(),
    isWaiting: false,
  })

  // Before a keystroke reaches the terminal: everything already in this
  // file belongs to the nodes that came before this one in the lane's
  // conversation, and reading past it attributes their work to this node.
  const { terminalSessionId, transcriptPath } = run
  return {
    sessionId,
    terminalSessionId,
    transcriptPath,
    transcriptFrom: transcriptSize(transcriptPath),
  }
}

// The launch, run through its script with the card's paths exported for the skills, and
// `; exit` so the tab ends with the script's status (SUPERVISION.md, "Two things the runtime
// does to a supervised run" and "The launch is a file, not a typed line").
function typeLaunch(
  context: RunnerContext,
  { sessionId, terminalSessionId }: SupervisedRun,
  { featureDir, command }: { featureDir: string; command: string }
): void {
  const featureSlug = path.basename(featureDir)
  const launchScript = writeLaunchScript(context.stateDir, sessionId, {
    exports: `export SPECIFY_FEATURE=${shellQuote(featureSlug)} SPECIFY_FEATURE_DIRECTORY=${shellQuote(path.join('specs', featureSlug))} CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 FOUNDRY_RUN=1`,
    command,
  })
  context.api.pty.write(
    terminalSessionId,
    `${shellQuote(process.env.SHELL ?? '/bin/sh')} ${shellQuote(launchScript)}; exit\r`
  )
}

async function runCommandInTab(
  { api, stateDir }: RunnerContext,
  options: RunCommandOptions
): Promise<number | null> {
  const project = await api.workspace.addProject({
    workspaceId: options.workspaceId,
    name: options.branch,
    worktreePath: options.worktreePath,
    gitBranch: options.branch,
    issue: options.issue,
  })
  if (project === null) return null

  // The script is the tab's own process, so the exit the core reports is
  // the command's, and null when a signal or a closed tab ended it first.
  const script = writeCommandScript(stateDir, { ...options, id: randomUUID() })
  const shell = process.env.SHELL ?? '/bin/sh'
  const exit = await api.pty.runInTerminal({
    projectId: project.id,
    cwd: options.worktreePath,
    tabTitle: options.title,
    type: 'human',
    file: shell,
    args: startupFilesThen(shell, script),
  })
  if (exit === null) return null
  // A failure stays open, exited, as the record of what ran; a pass
  // closes, and its output is in the log.
  if (exit.exitCode === 0) api.pty.closeTerminalTab(exit.sessionId)
  return exit.exitCode
}

function continueRun(
  context: RunnerContext,
  sessionId: string,
  next: { prompt: string; phase: StepLabel } & PhaseCallbacks
): SupervisedRun | null {
  const run = context.running.get(sessionId)
  // Gone: the tab was closed, the agent exited, or the console restarted.
  // Saying so lets the caller open a fresh one rather than typing a
  // `/speckit-plan` into a terminal that is not there.
  if (run === undefined) return null

  // Swapped before a keystroke reaches the terminal, or the first thing the
  // new phase does is reported against the phase that just finished.
  run.phase.current = { id: next.phase, ...next }
  // A phase that begins on a held tool call is a phase that begins blocked,
  // not stalled — but the previous phase left this true if it ended while
  // something was waiting, and nothing else clears it.
  run.isWaiting = false
  // A new turn is a new state, and silence counts from when the state began, so a
  // conversation resumed after a gap is not judged against a stale start.
  run.startedAt = context.now()

  // Typed as a person would type it. The agent is sitting at its prompt
  // with the whole card's conversation behind it: the spec it wrote, the
  // plan it derived from it, and every decision made in between.
  context.api.pty.write(run.terminalSessionId, `${oneLine(next.prompt)}\r`)

  return {
    sessionId,
    terminalSessionId: run.terminalSessionId,
    transcriptPath: run.transcriptPath,
    transcriptFrom: transcriptSize(run.transcriptPath),
  }
}

/** Ends the current turn, leaving the session open so a redirect lands. */
function interruptRun(context: RunnerContext, sessionId: string): void {
  const run = context.running.get(sessionId)
  if (run !== undefined) context.api.pty.write(run.terminalSessionId, INTERRUPT)
}

function stopSupervisedRun(context: RunnerContext, sessionId: string, reason?: string): boolean {
  const run = context.running.get(sessionId)
  if (run === undefined) return false
  const { pty } = context.api
  // The turn first, or the reason queues behind whatever it is part-way
  // through and the run outlives the instruction to end.
  pty.write(run.terminalSessionId, INTERRUPT)
  if (reason !== undefined && reason.trim() !== '') {
    pty.write(run.terminalSessionId, `${oneLine(reason)}\r`)
  }
  pty.write(run.terminalSessionId, EXIT)
  return true
}

function sendToSession(context: RunnerContext, sessionId: string, message: string): boolean {
  const run = context.running.get(sessionId)
  if (run === undefined) return false
  // It has been given something to do, so it is no longer waiting on us,
  // and the silence the detector measures starts again here.
  run.isWaiting = false
  run.startedAt = context.now()
  // Claude Code queues input arriving mid-turn, so a redirect does not
  // require the agent to be idle first.
  context.api.pty.write(run.terminalSessionId, `${oneLine(message)}\r`)
  return true
}

function terminalOf(
  run: Running | undefined
): { terminalSessionId: string; projectId: string } | null {
  return run === undefined
    ? null
    : { terminalSessionId: run.terminalSessionId, projectId: run.projectId }
}

function watchableRuns(running: ReadonlyMap<string, Running>): WatchedRun[] {
  return [...running].map(([sessionId, run]) => ({
    sessionId,
    featureDir: run.featureDir,
    transcriptPath: run.transcriptPath,
    startedAt: run.startedAt,
    isWaiting: run.isWaiting,
  }))
}
