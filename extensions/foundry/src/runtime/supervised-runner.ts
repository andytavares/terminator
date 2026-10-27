import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  AgentPermissionAsk,
  AgentUpdate,
  ExtensionAPI,
  StartAgentInput,
} from '@terminator/extension-sdk'
import { shellQuote } from '@terminator/extension-sdk/node'
import { transcriptPathFor } from './claude-launch.js'
import {
  createPermissionBridge,
  type PendingPermission,
  type PermissionDecision,
  type PermissionOutcome,
  type ToolVerdict,
} from './permission-bridge.js'
import type { ClaudePermissionMode, ClaudeSettings } from './role-settings.js'
import { countTurns, transcriptSize } from './transcript-tailer.js'
import type { WatchedRun } from './stall-watcher.js'
import { trackToolActivity, type ToolActivityTracker } from './tool-activity.js'

/**
 * Which step of the run this is — a run-graph node id.
 *
 * It was one of ten fixed phase names. It is a string now because the shape of
 * work is chosen per order, so the set of steps is not knowable here.
 */
type StepLabel = string

// A phase runs over ACP in an agent tab the operator can see and type in (ADR 130). The
// agent's permission mode is set per role; each permission ask waits for Foundry's policy or
// a person, and the runner watches the transcript, the asks and each prompt's end.

export interface SupervisedRun {
  /** The claude session id, which the agent chose. `resume` continues it. */
  readonly sessionId: string
  /** The agent tab it is running in (the ACP session id), so a surface can go to it. */
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
  /** The model to run. Empty or absent leaves the operator's own configuration. */
  model?: string
  /** The effort to run at. Absent leaves the operator's own configuration. */
  effort?: string
  /**
   * Where this node's skills were mounted. Absent or empty mounts none.
   */
  addDirs?: string[]
  /** The permission mode `roleSettings` chose. */
  mode: ClaudePermissionMode
  /** The role's permission rules and sandbox (`roleSettings`), which Claude enforces itself. */
  settings?: ClaudeSettings
  /** Decides without asking when the autonomy ladder allows it. */
  autoDecide?: (toolName: string, input: unknown) => PermissionDecision | null
  /** The ladder refused something without asking. Only refusals are reported. */
  onAutoDenied?: (toolName: string, reason: string) => void
  onPending: (pending: PendingPermission) => void
  onResolved: (requestId: string, decision: PermissionOutcome) => void
  /**
   * The run exists and can be found, before the first prompt is sent.
   *
   * Ordering, not decoration: the prompt is sent inside `start`, and anything
   * the agent does after it would reach a caller that had not registered the
   * run yet.
   */
  onRegistered?: (run: SupervisedRun) => void
  /** A JSON Schema the agent's final answer must match; Claude validates and retries it itself. */
  outputSchema?: object
  /** The agent's answer in `outputSchema`, as Claude validated it. Needs `outputSchema`. */
  onStructuredOutput?: (answer: unknown) => void
  /** The agent stopped responding and is waiting. Not an ending. */
  onTurnEnd?: (turns: number) => void
  /**
   * The conversation is over, with the agent process's exit code when there is one.
   *
   * Zero when it exited cleanly; whatever it exited with when it died, and
   * null when a signal ended it. A phase that
   * crashed must not land in `awaiting_review`, which is an approval gate over
   * nothing.
   */
  onEnd?: (exitCode: number | null) => void
}

/**
 * The parts of a run that belong to the phase rather than to the session.
 *
 * Everything here is rebound when a card moves from one phase to the next in
 * the same conversation: the tab, the session id and the transcript are
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
   * A card used to get one tab, one session and one `claude` process per
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
  /** Drops one from Foundry's held list; its ask stays open in the agent tab. */
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
  /** Calls the listener once the agent behind the session has exited; returns how to stop listening. */
  onEnd(sessionId: string, listener: () => void): () => void
  dispose(): void
}

// The shell's arguments for a check: `-i -l -c` reads the startup files a typed command
// got (https://zsh.sourceforge.io/Doc/Release/Files.html, https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files.html),
// then `exec` makes the single-quoted script the process whose exit code is reported.
function startupFilesThen(shell: string, script: string): string[] {
  return ['-i', '-l', '-c', `exec ${shellQuote(shell)} ${shellQuote(script)}`]
}

interface Running {
  bridge: ReturnType<typeof createPermissionBridge>
  /** Stops listening for the agent's exit once the run is over. */
  detachEnd: () => void
  terminalSessionId: string
  projectId: string
  transcriptPath: string
  featureDir: string
  startedAt: number
  /** The ids of the tool calls held on a person. Blocked on a person is not stuck, however many. */
  readonly heldCalls: Set<string>
  /** True once a turn has ended and the agent sits at its prompt. */
  atPrompt: boolean
  /** The run's tool calls, from its ACP updates. */
  readonly tools: ToolActivityTracker
  /** Settles when the prompt now running has ended, however it ended. */
  turn: Promise<void>
  /** Stops listening for the agent's asks. */
  release: () => void
  /**
   * Whose callbacks the next ask or turn-end belongs to.
   *
   * A one-field box rather than the callbacks themselves, and shared with the
   * closures `start` installed on the bridge and the ask listeners. The
   * session outlives the phase, so `continueRun` has to redirect callbacks
   * those closures captured before this record existed — a permission raised
   * during `plan` must not be reported against `specify`.
   */
  readonly phase: { current: PhaseCallbacks & { id: StepLabel } }
}

export interface SupervisedRunnerOptions {
  api: ExtensionAPI
  /** Where the scripts of the checks are written. */
  stateDir: string
  now?: () => number
}

/** What every part of one runner shares: the host and the live runs. */
interface RunnerContext {
  readonly api: ExtensionAPI
  /** Where the scripts of the checks are written. */
  readonly stateDir: string
  readonly now: () => number
  readonly running: Map<string, Running>
}

function runnerContext(options: SupervisedRunnerOptions): RunnerContext {
  return {
    api: options.api,
    stateDir: options.stateDir,
    now: options.now ?? Date.now,
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
    onEnd: (sessionId, listener) => context.api.agents.onEnd(sessionId, () => listener()),
    dispose: () => {
      for (const [sessionId, run] of [...running.entries()]) {
        end(context, sessionId, false)
        // The session is gone with no exit code of its own, so whatever waits on it can end.
        run.phase.current.onEnd?.(null)
      }
    },
  }
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
  run.detachEnd()
  run.tools.stop()
  // Anything still waiting can no longer be answered from here, and an
  // unresolved promise holds the agent's tool call open forever.
  run.bridge.rejectAll('This run has ended')
  run.release()
  if (clean) void context.api.agents.close(sessionId).catch(() => undefined)
}

async function startSupervisedRun(
  context: RunnerContext,
  start: StartSupervisedRunOptions
): Promise<SupervisedRun | null> {
  // The worktree becomes a project, so the agent has a tab to live in and the
  // operator can find it in the sidebar rather than only in a card.
  const project = await addWorktreeProject(context.api, start)
  if (project === null) return null

  const started = await context.api.agents.start(agentStartInput(start, project.id))
  // No tab, no run. Said out loud rather than starting an agent nobody can see.
  if (started === null) return null

  const { sessionId } = started
  // A box shared with the record, so `continueRun` can move an ask to another phase
  // without a new session; the closures exist before the record does.
  const phase: Running['phase'] = { current: { id: start.phase, ...start } }
  const bridge = permissionBridgeFor(context, sessionId, { phase, autoDecide: start.autoDecide })
  const stopAsks = listenForAsks(context, sessionId, bridge)
  const stopAnswer = listenForAnswer(context.api, sessionId, start.onStructuredOutput)
  const release = (): void => {
    stopAsks()
    stopAnswer()
  }
  const run = trackRun(context, sessionId, {
    bridge,
    release,
    phase,
    projectId: project.id,
    terminalSessionId: sessionId,
    transcriptPath: transcriptPathFor(start.worktreePath, sessionId),
    featureDir: start.featureDir,
  })

  // Registered before the first prompt: an ask or turn end arriving before the
  // caller had added the run would hit an empty registry and be dropped.
  start.onRegistered?.({ ...run })
  promptSession(context, sessionId, start.prompt)
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
      running.get(sessionId)?.heldCalls.add(pending.requestId)
      phase.current.onPending(pending)
    },
    onResolved: (requestId, decision) => {
      const run = running.get(sessionId)
      if (run !== undefined) {
        run.heldCalls.delete(requestId)
        // However long the operator took is not the agent's silence.
        run.startedAt = now()
      }
      phase.current.onResolved(requestId, decision)
    },
  })
}

/** The Claude options for one run: model, effort, skill folders and environment. */
function claudeOptions(start: StartSupervisedRunOptions): object {
  return {
    // Empty means "follow the operator's own configuration", so it is left out.
    ...(start.model ? { model: start.model } : {}),
    ...(start.effort ? { effort: start.effort } : {}),
    additionalDirectories: start.addDirs ?? [],
    // The agent must not load the operator's ~/.claude CLAUDE.md, hooks or MCP connectors.
    settingSources: ['project'],
    ...(start.settings ? { settings: start.settings } : {}),
    ...(start.outputSchema
      ? { outputFormat: { type: 'json_schema', schema: start.outputSchema } }
      : {}),
    // Also removes the denied tools from the agent's view, which a settings rule alone does not.
    disallowedTools: start.settings?.permissions.deny ?? [],
    env: {
      CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1',
      FOUNDRY_RUN: '1',
      CLAUDE_CODE_ARTIFACT_AUTO_OPEN: '0',
    },
  }
}

/** What `api.agents.start` is given for one run. */
function agentStartInput(start: StartSupervisedRunOptions, projectId: string): StartAgentInput {
  return {
    // Claude, whatever the default agent is: its tool names and ask options are what Foundry's policy knows.
    agentId: 'claude',
    cwd: start.worktreePath,
    resume: start.resumeSessionId,
    mode: start.mode,
    tab: { projectId, title: start.title },
    agentMeta: { claudeCode: { options: claudeOptions(start) } },
  }
}

/** The Claude tool an ACP kind stands for, when the agent sent no tool name. */
const TOOL_OF_KIND: Readonly<Record<string, string>> = {
  execute: 'Bash',
  read: 'Read',
  search: 'Grep',
  edit: 'Write',
  delete: 'Bash',
  move: 'Bash',
  fetch: 'WebFetch',
}

function toolNameOf(ask: AgentPermissionAsk): string {
  const named = (ask.toolCallMeta?.claudeCode as { toolName?: unknown } | undefined)?.toolName
  if (typeof named === 'string') return named
  return TOOL_OF_KIND[ask.kind ?? ''] ?? ask.title
}

/** The option that carries a verdict, or null (which cancels the ask) when the agent offers none. */
function optionFor(ask: AgentPermissionAsk, verdict: 'allow' | 'deny'): string | null {
  const kind = verdict === 'allow' ? 'allow_once' : 'reject_once'
  return ask.options.find((option) => option.kind === kind)?.optionId ?? null
}

/** Decides one ask with the bridge and sends the verdict; an `ask` verdict leaves it open in the tab. */
async function decideAsk(
  context: RunnerContext,
  { bridge, ask }: { bridge: Running['bridge']; ask: AgentPermissionAsk }
): Promise<void> {
  const { api } = context
  const verdict: ToolVerdict = await bridge.canUseTool(toolNameOf(ask), ask.rawInput, ask.requestId)
  if (verdict.permissionDecision === 'ask') return
  await api.agents.answer(ask.sessionId, ask.requestId, optionFor(ask, verdict.permissionDecision))
  if (verdict.answer !== undefined) sendWhenTurnEnds(context, ask.sessionId, verdict.answer)
}

/** A refusal never cancels the turn; the operator's words follow as a prompt once it has ended. */
function sendWhenTurnEnds(context: RunnerContext, sessionId: string, message: string): void {
  void context.running.get(sessionId)?.turn.then(() => sendToSession(context, sessionId, message))
}

/** Listens for the session's asks and for the tab answering one; returns what stops both. */
function listenForAsks(
  context: RunnerContext,
  sessionId: string,
  bridge: Running['bridge']
): () => void {
  const { agents } = context.api
  const stopAsks = agents.onPermission(sessionId, (ask) => {
    decideAsk(context, { bridge, ask }).catch(() => undefined)
  })
  const stopSettled = agents.onPermissionSettled(sessionId, ({ requestId, outcome }) =>
    bridge.withdraw(requestId, outcome)
  )
  return () => {
    stopAsks()
    stopSettled()
  }
}

/** Hands over the agent's answer in the requested schema, which arrives as a `StructuredOutput` tool call. */
function listenForAnswer(
  api: ExtensionAPI,
  sessionId: string,
  onAnswer: StartSupervisedRunOptions['onStructuredOutput']
): () => void {
  if (onAnswer === undefined) return () => undefined
  // The adapter streams the answer as it grows; only `completed` means it is whole.
  const latest = new Map<unknown, unknown>()
  return api.agents.onUpdate(sessionId, (update) => {
    if (updateToolName(update) !== 'StructuredOutput') return
    if (update.rawInput != null) latest.set(update.toolCallId, update.rawInput)
    if (update.status !== 'completed' || !latest.has(update.toolCallId)) return
    onAnswer(latest.get(update.toolCallId))
    latest.delete(update.toolCallId)
  })
}

function updateToolName(update: AgentUpdate): unknown {
  return (update._meta as { claudeCode?: { toolName?: unknown } } | undefined)?.claudeCode?.toolName
}

/** Sends a prompt; its end is a turn end, unless the turn was cut short or failed. */
function promptSession(context: RunnerContext, sessionId: string, text: string): void {
  const prompted = context.api.agents.prompt(sessionId, text).then(
    ({ stopReason }) => {
      if (stopReason === 'error') promptFailed(context, sessionId)
      else if (stopReason !== 'cancelled') turnEnded(context, sessionId)
    },
    () => promptFailed(context, sessionId)
  )
  const run = context.running.get(sessionId)
  if (run !== undefined) run.turn = prompted
}

/** The agent cannot answer, though its process may live on: the run ends as a crash does. */
function promptFailed(context: RunnerContext, sessionId: string): void {
  const run = context.running.get(sessionId)
  if (run === undefined) return
  run.phase.current.onEnd?.(null)
  end(context, sessionId, false)
}

function turnEnded(context: RunnerContext, sessionId: string): void {
  const run = context.running.get(sessionId)
  if (run === undefined) return
  // Finished responding and sitting at the prompt is blocked on a person, like a
  // held call, so the stall detector must not read a finished phase as stuck.
  run.atPrompt = true
  run.phase.current.onTurnEnd?.(countTurns(run.transcriptPath))
}

/** The worktree as a project of the card's workspace. */
function addWorktreeProject(
  api: ExtensionAPI,
  options: Pick<RunCommandOptions, 'workspaceId' | 'branch' | 'worktreePath' | 'issue'>
) {
  return api.workspace.addProject({
    workspaceId: options.workspaceId,
    name: options.branch,
    worktreePath: options.worktreePath,
    gitBranch: options.branch,
    issue: options.issue,
  })
}

/** The record of a run, from the moment its agent exists; returns how a caller finds it. */
function trackRun(
  context: RunnerContext,
  sessionId: string,
  run: Omit<Running, 'detachEnd' | 'startedAt' | 'heldCalls' | 'atPrompt' | 'tools' | 'turn'>
): SupervisedRun {
  // The agent dying is how a run ends, whether it exited or the tab was closed.
  const detachEnd = context.api.agents.onEnd(sessionId, (exitCode: number | null) => {
    // Already ended by a failed prompt or a stop.
    if (!context.running.has(sessionId)) return
    run.phase.current.onEnd?.(exitCode)
    end(context, sessionId, exitCode === 0)
  })

  context.running.set(sessionId, {
    ...run,
    detachEnd,
    startedAt: context.now(),
    heldCalls: new Set(),
    atPrompt: false,
    tools: trackToolActivity(context.api.agents, sessionId, context.now),
    turn: Promise.resolve(),
  })

  // Before the first prompt: everything already in this file belongs to the
  // nodes that came before this one in the lane's conversation, and reading
  // past it attributes their work to this node.
  const { terminalSessionId, transcriptPath } = run
  return {
    sessionId,
    terminalSessionId,
    transcriptPath,
    transcriptFrom: transcriptSize(transcriptPath),
  }
}

async function runCommandInTab(
  { api, stateDir }: RunnerContext,
  options: RunCommandOptions
): Promise<number | null> {
  const project = await addWorktreeProject(api, options)
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
  // Saying so lets the caller open a fresh one rather than sending a
  // `/speckit-plan` to a session that is not there.
  if (run === undefined) return null

  // Swapped before the prompt is sent, or the first thing the
  // new phase does is reported against the phase that just finished.
  run.phase.current = { id: next.phase, ...next }
  // Held calls stay counted: a call still open from the last phase still blocks this one.
  run.atPrompt = false
  // A new turn is a new state, and silence counts from when the state began, so a
  // conversation resumed after a gap is not judged against a stale start.
  run.startedAt = context.now()

  // The agent is sitting at its prompt with the whole card's conversation
  // behind it: the spec it wrote, the plan it derived from it, and every
  // decision made in between.
  promptSession(context, sessionId, next.prompt)

  return {
    sessionId,
    terminalSessionId: run.terminalSessionId,
    transcriptPath: run.transcriptPath,
    transcriptFrom: transcriptSize(run.transcriptPath),
  }
}

/** Ends the current turn, leaving the session open so a redirect lands. */
function interruptRun(context: RunnerContext, sessionId: string): void {
  if (context.running.has(sessionId)) context.api.agents.cancel(sessionId)
}

function stopSupervisedRun(context: RunnerContext, sessionId: string, reason?: string): boolean {
  if (!context.running.has(sessionId)) return false
  const { agents } = context.api
  // The turn first, or the reason queues behind whatever it is part-way
  // through and the run outlives the instruction to end.
  agents.cancel(sessionId)
  const said =
    reason !== undefined && reason.trim() !== ''
      ? agents.prompt(sessionId, reason.trim())
      : Promise.resolve(undefined)
  // A stop asked for is a clean end, as `/exit` was: report 0, then close.
  void said
    .then(() => {
      context.running.get(sessionId)?.phase.current.onEnd?.(0)
      end(context, sessionId, true)
    })
    .catch(() => undefined)
  return true
}

function sendToSession(context: RunnerContext, sessionId: string, message: string): boolean {
  const run = context.running.get(sessionId)
  if (run === undefined) return false
  // It has been given something to do, so it is no longer waiting on us,
  // and the silence the detector measures starts again here.
  run.atPrompt = false
  run.startedAt = context.now()
  promptSession(context, sessionId, message)
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
    activity: run.tools.activity(),
    startedAt: run.startedAt,
    isWaiting: run.atPrompt || run.heldCalls.size > 0,
  }))
}
