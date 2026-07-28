import { randomUUID } from 'crypto'
import { basename } from 'path'
import type { BrowserWindow } from 'electron'
import type { PtyManager } from '../terminal/pty-manager.js'
import { createProject, listProjects } from '../storage/workspace-store.js'
import type { LaunchSpec } from './agent-runtime/claude-launch.js'
import type { OpenedTerminal, TerminalPlacement } from './agent-runtime/driver-contract.js'

// Giving a supervised session somewhere to live.
//
// This is the difference the operator actually asked for. A session is not a
// row in a console that reports on an agent running somewhere out of sight: it
// is a project in a workspace, on its own worktree, with a terminal in it that
// happens to have `claude` running. You can watch it, you can type in it, you
// can take the work over by hand without the console losing track — because
// what the console watches is the transcript and the hooks, not the process.
//
// Everything here is the shell's job rather than the supervision service's:
// projects and terminals are the application's own furniture, and the service
// is deliberately ignorant of both.

export interface AgentTerminalOptions {
  ptyManager: PtyManager
  getWindow: () => BrowserWindow | null
  defaultShell: () => string
  scrollbackLimit: () => number
}

/** The tab title: the branch, which is what the operator called the work. */
function titleFor(placement: TerminalPlacement | undefined, spec: LaunchSpec): string {
  return placement?.branch ?? basename(spec.cwd)
}

/**
 * Registers the working copy as a project, if it is not already one.
 *
 * Reused rather than duplicated when it exists: restarting an agent on the same
 * branch should land in the project you were already looking at, not beside it
 * in a second one with the same name.
 */
function projectFor(placement: TerminalPlacement | undefined, spec: LaunchSpec): string | null {
  const workspaceId = placement?.workspaceId
  if (workspaceId == null) {
    // No workspace was named. The terminal is still opened — an agent you can
    // see in an unfiled tab beats an agent you cannot see at all.
    return null
  }

  const name = titleFor(placement, spec)
  const existing = listProjects(workspaceId).find(
    (project) => project.worktreePath === spec.cwd || project.name === name
  )
  if (existing !== undefined) return existing.id

  const created = createProject({
    workspaceId,
    name,
    gitBranch: placement?.branch,
    worktreePath: spec.cwd,
    isWorktree: true,
  })
  return 'project' in created ? created.project.id : null
}

export function createAgentTerminal(options: AgentTerminalOptions) {
  const { ptyManager, getWindow } = options

  return {
    /**
     * Opens the terminal the agent will run in and tells the renderer to adopt
     * it, so it appears as an ordinary tab the operator can click into.
     */
    async open(spec: LaunchSpec, placement?: TerminalPlacement): Promise<OpenedTerminal | null> {
      const projectId = projectFor(placement, spec)
      const terminalSessionId = randomUUID()
      const tabTitle = titleFor(placement, spec)

      try {
        ptyManager.spawnSession({
          sessionId: terminalSessionId,
          cwd: spec.cwd,
          shell: options.defaultShell(),
          // Marked as an agent's terminal, not a person's, even though a person
          // can type in it — which is the whole point.
          type: 'agent',
          origin: 'app',
          projectId: projectId ?? undefined,
          tabTitle,
          // The tab that will show this does not exist yet. Held until it does,
          // or the launch command and the agent's first output are printed to
          // nobody and the operator opens a terminal that looks like it never
          // started.
          holdOutput: true,
        })
      } catch {
        // A working copy that vanished between provisioning and starting, or a
        // shell that is not there. Reported as "no terminal", which the driver
        // turns into a failed session rather than a silent one.
        return null
      }

      ptyManager.onData(terminalSessionId, (data) => {
        const win = getWindow()
        if (win && !win.isDestroyed())
          win.webContents.send('terminal:output', { sessionId: terminalSessionId, data })
      })
      ptyManager.onExit(terminalSessionId, (exitCode) => {
        const win = getWindow()
        if (win && !win.isDestroyed())
          win.webContents.send('terminal:process-exit', { sessionId: terminalSessionId, exitCode })
      })

      const win = getWindow()
      if (win && !win.isDestroyed()) {
        // The renderer owns the tab list; without this the terminal exists and
        // runs, and nothing on screen ever shows it.
        win.webContents.send('supervision:terminalOpened', {
          sessionId: spec.sessionId,
          terminalSessionId,
          projectId,
          workspaceId: placement?.workspaceId ?? null,
          tabTitle,
          cwd: spec.cwd,
          scrollbackLimit: options.scrollbackLimit(),
        })
      }

      return { terminalSessionId, projectId }
    },

    write(terminalSessionId: string, data: string): void {
      ptyManager.write(terminalSessionId, data)
    },

    close(terminalSessionId: string): void {
      ptyManager.kill(terminalSessionId)
      const win = getWindow()
      if (win && !win.isDestroyed())
        win.webContents.send('supervision:terminalClosed', { terminalSessionId })
    },
  }
}
