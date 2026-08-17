import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import type { PhaseId } from '../types/speckit.types.js'
import { buildLaunchSpec, shellQuote } from './claude-launch.js'
import { installHookScript } from './hook-script.js'
import type { ControlServer } from './control-server.js'
import {
  createPermissionBridge,
  type PendingPermission,
  type PermissionDecision,
  type PermissionOutcome,
} from './permission-bridge.js'
import { countTurns } from './transcript-tailer.js'
import type { WatchedRun } from './stall-watcher.js'

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
}

export interface StartSupervisedRunOptions {
  featureDir: string
  worktreePath: string
  workspaceId: string
  /** The branch the worktree is on — names the project and the tab. */
  branch: string
  /** What to tell the agent: a `/speckit-*` command, or a reply to it. */
  prompt: string
  phase: PhaseId
  /** Resume an existing conversation rather than starting one. */
  resumeSessionId?: string
  /** What `--model` gets. Empty or absent leaves the flag off entirely. */
  model?: string
  /** Decides without asking when the autonomy ladder allows it. */
  autoDecide?: (toolName: string, input: unknown) => PermissionDecision | null
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
   * exited with when the tab was closed or the process died. A phase that
   * crashed must not land in `awaiting_review`, which is an approval gate over
   * nothing.
   */
  onEnd?: (exitCode: number) => void
}

/**
 * The parts of a run that belong to the phase rather than to the session.
 *
 * Everything here is rebound when a card moves from one phase to the next in
 * the same conversation: the terminal, the session id and the transcript are
 * the card's, but "which phase finished" is not.
 */
export interface PhaseCallbacks {
  onPending: (pending: PendingPermission) => void
  onResolved: (requestId: string, decision: PermissionOutcome) => void
  onTurnEnd?: (turns: number) => void
  onEnd?: (exitCode: number) => void
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
    options: { prompt: string; phase: PhaseId } & PhaseCallbacks
  ): SupervisedRun | null
  /** The card's open conversation, if it still has one. */
  liveSessionFor(featureDir: string): string | null
  /**
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
  readonly phase: { current: PhaseCallbacks & { id: PhaseId } }
}

export interface SupervisedRunnerOptions {
  api: ExtensionAPI
  control: ControlServer
  /** Where per-session settings and the hook script are written. */
  stateDir: string
  now?: () => number
}

export function createSupervisedRunner(options: SupervisedRunnerOptions): SupervisedRunner {
  const { api, control, stateDir } = options
  const now = options.now ?? Date.now
  const hookScriptPath = installHookScript(stateDir)
  const running = new Map<string, Running>()

  function end(sessionId: string): void {
    const run = running.get(sessionId)
    if (run === undefined) return
    running.delete(sessionId)
    run.detachExit?.()
    // Anything still waiting can no longer be answered from here, and an
    // unresolved promise holds the agent's tool call open forever.
    run.bridge.rejectAll('This run has ended')
    run.release()
  }

  return {
    async start(start: StartSupervisedRunOptions): Promise<SupervisedRun | null> {
      // Ours, not the runtime's. Choosing it means the transcript path is known
      // before the process exists and a hook callback needs no correlation.
      const resuming = start.resumeSessionId !== undefined
      const sessionId = start.resumeSessionId ?? randomUUID()

      // Shared with the record below rather than closed over by value, so
      // `continueRun` can swap which phase a hook belongs to without tearing
      // the session down and building a new one. A box, because these closures
      // are installed before the record exists.
      const phase: Running['phase'] = { current: { id: start.phase, ...start } }

      const bridge = createPermissionBridge({
        sessionId,
        now,
        autoDecide: start.autoDecide,
        onPending: (pending) => {
          // Held on a person, so the detector must not call it stuck.
          const run = running.get(sessionId)
          if (run !== undefined) run.isWaiting = true
          phase.current.onPending(pending)
        },
        onResolved: (requestId, decision) => {
          const run = running.get(sessionId)
          if (run !== undefined) run.isWaiting = false
          phase.current.onResolved(requestId, decision)
        },
      })

      const spec = buildLaunchSpec({
        sessionId,
        resume: resuming,
        cwd: start.worktreePath,
        prompt: start.prompt,
        model: start.model,
        settingsDirectory: path.join(stateDir, 'settings'),
        hookScriptPath,
        controlUrl: control.url,
        controlEventUrl: control.eventUrl,
        controlToken: control.token,
      })

      const release = control.register(sessionId, {
        decide: (request) => bridge.canUseTool(request.toolName, request.input),
        onEvent: (kind) => {
          const run = running.get(sessionId)
          if (kind === 'stop') {
            // The agent has finished responding and is sitting at its prompt.
            // That is blocked on a person — the same state as a held tool call
            // — and the stall detector must not read it as stuck. It used to:
            // a phase that finished cleanly and was waiting to be approved
            // went quiet, fired a stall eight minutes later, and stayed in the
            // Stalls tab offering to interrupt work that was already done.
            if (run !== undefined) run.isWaiting = true
            phase.current.onTurnEnd?.(countTurns(spec.transcriptPath))
            return
          }
          phase.current.onEnd?.(0)
          end(sessionId)
        },
      })

      // The worktree becomes a project, so the terminal has somewhere to live
      // and the operator can find it in the sidebar rather than only in a card.
      const project = api.workspace.createProject({
        workspaceId: start.workspaceId,
        name: start.branch,
        worktreePath: start.worktreePath,
        gitBranch: start.branch,
      })
      if (project === null) {
        release()
        return null
      }

      const terminalSessionId = api.pty.openTerminalTab({
        projectId: project.id,
        cwd: start.worktreePath,
        tabTitle: start.branch,
        type: 'agent',
      })
      if (terminalSessionId === null) {
        // No terminal, no run. Said out loud rather than starting an agent
        // nobody can see, which is the thing this replaced.
        release()
        return null
      }

      // The terminal dying is the other way a run ends. Without this, closing
      // the tab left the phase `running` with no completion ever delivered:
      // `session_end` only arrives when the runtime exits cleanly enough to
      // fire its hook.
      const detachExit =
        api.pty.onExit?.(terminalSessionId, (exitCode: number) => {
          phase.current.onEnd?.(exitCode)
          end(sessionId)
        }) ?? null

      running.set(sessionId, {
        detachExit,
        bridge,
        terminalSessionId,
        projectId: project.id,
        transcriptPath: spec.transcriptPath,
        featureDir: start.featureDir,
        startedAt: now(),
        isWaiting: false,
        release,
        phase,
      })

      // Registered before a single keystroke reaches the terminal: the launch
      // command is written below, and a hook or turn-end arriving before the
      // caller had added the run would hit an empty registry and be dropped.
      start.onRegistered?.({
        sessionId,
        terminalSessionId,
        transcriptPath: spec.transcriptPath,
      })

      // Typed, exactly as a person would. The skills read these to find the
      // card's spec, plan and tasks regardless of the branch name.
      const featureSlug = path.basename(start.featureDir)
      // CLAUDE_CODE_FORCE_SESSION_PERSISTENCE, because everything this runtime
      // knows it reads from the transcript. The runtime sets
      // CLAUDE_CODE_CHILD_SESSION=1 in every process it spawns, and a nested
      // interactive session carrying that marker is excluded from history —
      // "Transcript saving is off" — so when the console itself was started
      // from a Claude Code session, its agents write no transcript and the
      // stall detector, the turn count and the card's console all read empty
      // forever. Documented as the override for exactly this case.
      api.pty.write(
        terminalSessionId,
        `export SPECIFY_FEATURE=${shellQuote(featureSlug)} SPECIFY_FEATURE_DIRECTORY=${shellQuote(path.join('specs', featureSlug))} CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1\r`
      )
      api.pty.write(terminalSessionId, `${spec.command}\r`)

      return { sessionId, terminalSessionId, transcriptPath: spec.transcriptPath }
    },

    continueRun(sessionId, next): SupervisedRun | null {
      const run = running.get(sessionId)
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

      // Typed as a person would type it. The agent is sitting at its prompt
      // with the whole card's conversation behind it: the spec it wrote, the
      // plan it derived from it, and every decision made in between.
      api.pty.write(run.terminalSessionId, `${oneLine(next.prompt)}\r`)

      return {
        sessionId,
        terminalSessionId: run.terminalSessionId,
        transcriptPath: run.transcriptPath,
      }
    },

    liveSessionFor(featureDir): string | null {
      for (const [sessionId, run] of running) {
        if (run.featureDir === featureDir) return sessionId
      }
      return null
    },

    resolve(sessionId, requestId, decision): boolean {
      return running.get(sessionId)?.bridge.resolve(requestId, decision) ?? false
    },

    handBackToTerminal(sessionId, requestId): void {
      running.get(sessionId)?.bridge.handBackToTerminal(requestId)
    },

    interrupt(sessionId): void {
      const run = running.get(sessionId)
      if (run === undefined) return
      api.pty.write(run.terminalSessionId, INTERRUPT)
    },

    stop(sessionId, reason): boolean {
      const run = running.get(sessionId)
      if (run === undefined) return false
      // The turn first, or the reason queues behind whatever it is part-way
      // through and the run outlives the instruction to end.
      api.pty.write(run.terminalSessionId, INTERRUPT)
      if (reason !== undefined && reason.trim() !== '') {
        api.pty.write(run.terminalSessionId, `${oneLine(reason)}\r`)
      }
      api.pty.write(run.terminalSessionId, EXIT)
      return true
    },

    send(sessionId, message): boolean {
      const run = running.get(sessionId)
      if (run === undefined) return false
      // It has been given something to do, so it is no longer waiting on us.
      run.isWaiting = false
      // Claude Code queues input arriving mid-turn, so a redirect does not
      // require the agent to be idle first.
      api.pty.write(run.terminalSessionId, `${oneLine(message)}\r`)
      return true
    },

    terminalFor(sessionId): { terminalSessionId: string; projectId: string } | null {
      const run = running.get(sessionId)
      return run === undefined
        ? null
        : { terminalSessionId: run.terminalSessionId, projectId: run.projectId }
    },

    watchable(): WatchedRun[] {
      return [...running].map(([sessionId, run]) => ({
        sessionId,
        featureDir: run.featureDir,
        transcriptPath: run.transcriptPath,
        startedAt: run.startedAt,
        isWaiting: run.isWaiting,
      }))
    },

    dispose(): void {
      for (const sessionId of [...running.keys()]) end(sessionId)
    },
  }
}
