import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import type { PhaseId } from '../types/speckit.types.js'
import { buildLaunchSpec } from './claude-launch.js'
import { installHookScript } from './hook-script.js'
import type { ControlServer } from './control-server.js'
import {
  createPermissionBridge,
  type PendingPermission,
  type PermissionDecision,
} from './permission-bridge.js'
import { countTurns } from './transcript-tailer.js'

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
  onResolved: (requestId: string, decision: 'allow' | 'deny') => void
  /** The agent stopped responding and is waiting. Not an ending. */
  onTurnEnd?: (turns: number) => void
  /** The conversation is over. */
  onEnd?: () => void
}

export interface SupervisedRunner {
  start(options: StartSupervisedRunOptions): Promise<SupervisedRun | null>
  /** Answers a tool call the operator was asked about. */
  resolve(sessionId: string, requestId: string, decision: PermissionDecision): void
  /** Gives one back to the terminal, for answering where the agent is. */
  handBackToTerminal(sessionId: string, requestId: string): void
  /** Ends the current turn, leaving the session open so a redirect lands. */
  interrupt(sessionId: string): void
  /** Ends the run, saying why first so the agent's own record carries it. */
  stop(sessionId: string, reason?: string): boolean
  /** Sends a further message — a reply, or a redirect. */
  send(sessionId: string, message: string): boolean
  /** Where a session is running, for a surface that wants to go there. */
  terminalFor(sessionId: string): string | null
  dispose(): void
}

/** Escape. Ends the turn and keeps the session, which is what makes a redirect land. */
const INTERRUPT = '\x1b'

/** Ends the conversation the way a person would, so the runtime writes its record. */
const EXIT = '/exit\r'

interface Running {
  bridge: ReturnType<typeof createPermissionBridge>
  terminalSessionId: string
  transcriptPath: string
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
        onPending: start.onPending,
        onResolved: start.onResolved,
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
          start.onEnd?.()
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

      running.set(sessionId, {
        bridge,
        terminalSessionId,
        transcriptPath: spec.transcriptPath,
        release,
      })

      // Typed, exactly as a person would. The skills read these to find the
      // card's spec, plan and tasks regardless of the branch name.
      const featureSlug = path.basename(start.featureDir)
      api.pty.write(
        terminalSessionId,
        `export SPECIFY_FEATURE=${featureSlug} SPECIFY_FEATURE_DIRECTORY=${path.join('specs', featureSlug)}\r`
      )
      api.pty.write(terminalSessionId, `${spec.command}\r`)

      return { sessionId, terminalSessionId, transcriptPath: spec.transcriptPath }
    },

    resolve(sessionId, requestId, decision): void {
      running.get(sessionId)?.bridge.resolve(requestId, decision)
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

    terminalFor(sessionId): string | null {
      return running.get(sessionId)?.terminalSessionId ?? null
    },

    dispose(): void {
      for (const sessionId of [...running.keys()]) end(sessionId)
    },
  }
}
