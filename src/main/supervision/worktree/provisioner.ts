import { join } from 'path'
import { loadRepoConfig } from './repo-config.js'
import { materializeWorktree, type MaterializeResult } from './materialize.js'
import { allocatePortSpan, type PortSpan } from './port-allocator.js'
import { runScript, scriptEnv, type ScriptResult } from './setup-runner.js'
import type { SessionEvent } from '../events/session-event.js'

// Provisioning a working copy per lane (FR-030 – FR-034). The order matters:
// branch, materialise, allocate ports, then run setup — setup is last because
// it is the step that legitimately fails, and it needs everything else in place
// before its result means anything.
//
// A non-zero setup exit publishes setup_finished with the code and output. The
// state machine turns that into `failed` and no agent is started, so a broken
// worktree surfaces on a listing surface rather than inside a transcript.

export interface ProvisionRequest {
  sessionId: string
  workItemId: string
  repoPath: string
  branch: string
  worktreeRoot: string
}

export interface ProvisionResult {
  readonly worktreePath: string
  readonly ports: PortSpan
  readonly materialized: MaterializeResult
  readonly setup: ScriptResult | null
  readonly ok: boolean
}

export interface GitWorktreeOps {
  createWorktree(repoPath: string, worktreePath: string, branch: string): Promise<void>
  removeWorktree(repoPath: string, worktreePath: string): Promise<void>
}

export interface ProvisionerOptions {
  git: GitWorktreeOps
  isPortFree: (port: number) => boolean
  activeSpans: () => readonly PortSpan[]
  publish: (event: SessionEvent) => void
  now: () => number
}

export function createProvisioner(options: ProvisionerOptions) {
  const { git, isPortFree, activeSpans, publish, now } = options

  return {
    async provision(request: ProvisionRequest): Promise<ProvisionResult> {
      const config = loadRepoConfig(request.repoPath)
      const worktreePath = join(
        request.worktreeRoot,
        `${request.workItemId}-${request.branch.replace(/[^\w.-]+/g, '-')}`
      )

      await git.createWorktree(request.repoPath, worktreePath, request.branch)

      const materialized = materializeWorktree({
        primaryPath: request.repoPath,
        worktreePath,
        symlink: config.worktree.symlink,
        copy: config.worktree.copy,
      })

      const ports = allocatePortSpan({
        base: config.worktree.portBase,
        span: config.worktree.portSpan,
        taken: activeSpans(),
        isFree: isPortFree,
      }) ?? { portBase: config.worktree.portBase, portSpan: config.worktree.portSpan }

      const env = scriptEnv({
        portBase: ports.portBase,
        worktreePath,
        workItemId: request.workItemId,
      })

      // No setup command is a valid configuration — provisioning completes and
      // the session starts (spec Edge Cases).
      if (config.scripts.setup === undefined) {
        publish({
          kind: 'setup_finished',
          sessionId: request.sessionId,
          exitCode: 0,
          output: '',
          at: now(),
        })
        return { worktreePath, ports, materialized, setup: null, ok: true }
      }

      const setup = await runScript({ command: config.scripts.setup, cwd: worktreePath, env })
      publish({
        kind: 'setup_finished',
        sessionId: request.sessionId,
        exitCode: setup.exitCode,
        output: setup.output,
        at: now(),
      })

      return { worktreePath, ports, materialized, setup, ok: setup.exitCode === 0 }
    },

    /**
     * Teardown then removal (FR-035). Refusing to archive a running session is
     * the caller's check — this is the mechanism, not the guard.
     */
    async release(request: {
      repoPath: string
      worktreePath: string
      workItemId: string
      portBase: number
    }): Promise<ScriptResult | null> {
      const config = loadRepoConfig(request.repoPath)
      let teardown: ScriptResult | null = null

      if (config.scripts.teardown !== undefined) {
        teardown = await runScript({
          command: config.scripts.teardown,
          cwd: request.worktreePath,
          env: scriptEnv({
            portBase: request.portBase,
            worktreePath: request.worktreePath,
            workItemId: request.workItemId,
          }),
        })
      }

      // The worktree goes even if teardown failed: leaving it behind would
      // accumulate broken checkouts, and the teardown output is returned so the
      // failure is still reportable.
      await git.removeWorktree(request.repoPath, request.worktreePath)
      return teardown
    },
  }
}
