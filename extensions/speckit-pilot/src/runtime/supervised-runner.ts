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
  /** The claude session id, which this chose. `--resume` takes it. */
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

export interface SupervisedRunner {
  start(options: StartSupervisedRunOptions): Promise<SupervisedRun | null>
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
      const sessionId = start.resumeSessionId ?? randomUUID()

      const bridge = createPermissionBridge({
        sessionId,
        now,
        autoDecide: start.autoDecide,
        onPending: (pending) => {
          // Held on a person, so the detector must not call it stuck.
          const run = running.get(sessionId)
          if (run !== undefined) run.isWaiting = true
          start.onPending(pending)
        },
        onResolved: (requestId, decision) => {
          const run = running.get(sessionId)
          if (run !== undefined) run.isWaiting = false
          start.onResolved(requestId, decision)
        },
      })

      const spec = buildLaunchSpec({
        sessionId,
        cwd: start.worktreePath,
        prompt: start.prompt,
        settingsDirectory: path.join(stateDir, 'settings'),
        hookScriptPath,
        controlUrl: control.url,
        controlEventUrl: control.eventUrl,
        controlToken: control.token,
      })

      const release = control.register(sessionId, {
        decide: (request) => bridge.canUseTool(request.toolName, request.input),
        onEvent: (kind) => {
          if (kind === 'stop') {
            start.onTurnEnd?.(countTurns(spec.transcriptPath))
            return
          }
          start.onEnd?.(0)
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
          start.onEnd?.(exitCode)
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
        api.pty.write(run.terminalSessionId, `${reason.trim()}\r`)
      }
      api.pty.write(run.terminalSessionId, EXIT)
      return true
    },

    send(sessionId, message): boolean {
      const run = running.get(sessionId)
      if (run === undefined) return false
      // Claude Code queues input arriving mid-turn, so a redirect does not
      // require the agent to be idle first.
      api.pty.write(run.terminalSessionId, `${message}\r`)
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
