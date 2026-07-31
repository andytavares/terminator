import * as pty from 'node-pty'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

// PtyManager is the single session authority: it owns the PTY processes, the
// session metadata (origin, project, workspace, timestamps), and the data/exit
// fan-out. Both consumers — the Electron IPC layer and the remote-control
// HTTP/WS routes — are thin views over this interface; neither keeps its own
// session registry.

interface SessionRecord {
  sessionId: string
  pid: number
  cwd: string
  shell: string
}

export type SessionOrigin = 'app' | 'remote'

export interface SpawnSessionOptions {
  sessionId: string
  cwd: string
  shell: string
  type: 'human' | 'agent'
  origin: SessionOrigin
  projectId?: string
  tabTitle?: string
  /**
   * Withhold output until someone attaches.
   *
   * A terminal spawned by the application rather than by the operator starts
   * producing output immediately, while the tab that will show it does not
   * exist yet — the renderer has to be told, adopt it, render, and mount an
   * xterm first. Delivered live, everything in that window is dropped on the
   * floor, which for a supervised agent means the launch command and its first
   * output are simply missing from the terminal the operator opens.
   */
  holdOutput?: boolean
}

export interface SessionInfo {
  sessionId: string
  cwd: string
  type: 'human' | 'agent'
  origin: SessionOrigin
  createdAt: string
  pid: number
  projectId?: string
  tabTitle?: string
  workspaceId?: string
}

interface ActiveSession {
  pty: pty.IPty
  info: SessionInfo
  dataListeners: Set<(data: string) => void>
  exitListeners: Set<(exitCode: number) => void>
  /** Output produced before anything attached; null once released. */
  held: string[] | null
  /**
   * How much is held, tracked rather than recomputed.
   *
   * `held.join('')` inside the trim loop re-joined up to a megabyte on every
   * chunk once the cap was reached — on the main thread, for the whole life of
   * a chatty agent.
   */
  heldChars: number
}

/**
 * How much output to keep for a terminal nobody has attached to yet. Generous
 * enough for a session that takes a while to appear on screen, bounded because
 * a runaway process must not be able to grow it without limit.
 */
const MAX_HELD_CHARS = 1_000_000

const REGISTRY_FILE = () => join(app.getPath('userData'), 'session-registry.json')

/**
 * How long a dead session's held output stays readable.
 *
 * Long enough for a tab that was already opening to mount and ask for it, short
 * enough that nothing accumulates. A run that dies at launch is exactly when
 * its output matters most, and it is also when there is no listener yet.
 */
const LATE_ATTACH_GRACE_MS = 60_000

export class PtyManager {
  private sessions = new Map<string, ActiveSession>()

  /** Held output from sessions that exited before anything attached. */
  private exitedHeld = new Map<
    string,
    { output: string; listeners: Set<(data: string) => void>; expiry: NodeJS.Timeout }
  >()

  private rememberForLateAttach(sessionId: string, output: string): void {
    const expiry = setTimeout(() => this.exitedHeld.delete(sessionId), LATE_ATTACH_GRACE_MS)
    expiry.unref?.()
    this.exitedHeld.set(sessionId, { output, listeners: new Set(), expiry })
  }

  spawnSession(opts: SpawnSessionOptions): SessionInfo {
    const ptyProcess = pty.spawn(opts.shell, ['-l'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: opts.cwd,
      env: process.env as { [key: string]: string },
    })

    const session: ActiveSession = {
      pty: ptyProcess,
      info: {
        sessionId: opts.sessionId,
        cwd: opts.cwd,
        type: opts.type,
        origin: opts.origin,
        createdAt: new Date().toISOString(),
        pid: ptyProcess.pid,
        projectId: opts.projectId,
        tabTitle: opts.tabTitle,
      },
      dataListeners: new Set(),
      exitListeners: new Set(),
      held: opts.holdOutput === true ? [] : null,
      heldChars: 0,
    }

    ptyProcess.onData((data) => {
      if (session.held !== null) {
        session.held.push(data)
        session.heldChars += data.length
        // Oldest first: what matters most on a long-running agent is the recent
        // output, and the alternative is an unbounded buffer.
        while (session.heldChars > MAX_HELD_CHARS && session.held.length > 1) {
          session.heldChars -= session.held.shift()?.length ?? 0
        }
        return
      }
      for (const listener of session.dataListeners) listener(data)
    })
    ptyProcess.onExit(({ exitCode }) => {
      // Everything held goes out first. A process that dies before any tab
      // mounted — a bad flag, a missing binary, the wrong cwd — otherwise took
      // its output to the grave and left exactly the blank terminal this hold
      // exists to prevent. Delivered to whoever is listening; kept on the
      // session for whoever attaches next.
      if (session.held !== null && session.held.length > 0) {
        const buffered = session.held.join('')
        session.held = null
        session.heldChars = 0
        if (session.dataListeners.size > 0) {
          for (const listener of session.dataListeners) listener(buffered)
        } else {
          // Nothing has mounted yet. Kept for a tab that is still on its way,
          // because the alternative is the blank terminal this hold exists to
          // prevent — and a run that dies at launch is exactly when its output
          // matters most.
          this.rememberForLateAttach(opts.sessionId, buffered)
        }
      }
      this.sessions.delete(opts.sessionId)
      this.persistRegistry()
      for (const listener of session.exitListeners) listener(exitCode ?? 0)
      session.dataListeners.clear()
      session.exitListeners.clear()
    })

    this.sessions.set(opts.sessionId, session)
    this.persistRegistry()
    return { ...session.info }
  }

  /** @deprecated since ExtensionAPI v1.4.0 — use spawnSession() plus onData()/onExit(). */
  spawn(
    sessionId: string,
    cwd: string,
    shell: string,
    type: 'human' | 'agent',
    onData: (data: string) => void,
    onExit: (exitCode: number) => void
  ): string {
    this.spawnSession({ sessionId, cwd, shell, type, origin: 'app' })
    this.onData(sessionId, onData)
    this.onExit(sessionId, onExit)
    return sessionId
  }

  /**
   * Delivers everything held back and resumes live output. Called when a tab is
   * actually on screen and ready to display it; a no-op for a session that was
   * never holding, and for one that has already been released.
   */
  releaseOutput(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) {
      // It has already exited. Its last words are still here if the tab is only
      // just mounting.
      const remembered = this.exitedHeld.get(sessionId)
      if (remembered === undefined) return false
      this.exitedHeld.delete(sessionId)
      clearTimeout(remembered.expiry)
      for (const listener of remembered.listeners) listener(remembered.output)
      return true
    }
    if (session.held === null) return false
    const buffered = session.held.join('')
    session.held = null
    session.heldChars = 0
    if (buffered !== '') {
      for (const listener of session.dataListeners) listener(buffered)
    }
    return true
  }

  /** Subscribes to a session's output. Returns a disposer, or null if unknown. */
  onData(sessionId: string, listener: (data: string) => void): (() => void) | null {
    const session = this.sessions.get(sessionId)
    if (!session) {
      // A tab mounting onto a session that has already exited: it can still be
      // told what the session said, once it asks to be shown it.
      const remembered = this.exitedHeld.get(sessionId)
      if (remembered === undefined) return null
      remembered.listeners.add(listener)
      return () => remembered.listeners.delete(listener)
    }
    session.dataListeners.add(listener)
    return () => session.dataListeners.delete(listener)
  }

  /** Subscribes to a session's exit. Listeners fire after the session is removed. */
  onExit(sessionId: string, listener: (exitCode: number) => void): (() => void) | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    session.exitListeners.add(listener)
    return () => session.exitListeners.delete(listener)
  }

  /** @deprecated since ExtensionAPI v1.4.0 — alias of onData(). */
  attachOnData(sessionId: string, onData: (data: string) => void): (() => void) | null {
    return this.onData(sessionId, onData)
  }

  /** @deprecated since ExtensionAPI v1.4.0 — alias of onExit(). */
  attachOnExit(sessionId: string, onExit: (exitCode: number) => void): (() => void) | null {
    return this.onExit(sessionId, onExit)
  }

  getSession(sessionId: string): SessionInfo | undefined {
    const session = this.sessions.get(sessionId)
    return session ? { ...session.info } : undefined
  }

  listSessions(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }))
  }

  setWorkspace(sessionId: string, workspaceId: string | null): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.info.workspaceId = workspaceId ?? undefined
    return true
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.pty.resize(cols, rows)
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.pty.write(data)
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      try {
        session.pty.kill()
      } catch {
        // Already exited
      }
      this.sessions.delete(sessionId)
      this.persistRegistry()
    }
  }

  async killAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    for (const id of ids) {
      this.kill(id)
    }
    this.clearRegistry()
  }

  getSessionIds(): string[] {
    return [...this.sessions.keys()]
  }

  getPid(sessionId: string): number | undefined {
    return this.sessions.get(sessionId)?.pty.pid
  }

  cleanupOrphans(): { cleanedCount: number } {
    const registryPath = REGISTRY_FILE()
    if (!existsSync(registryPath)) return { cleanedCount: 0 }
    let records: SessionRecord[] = []
    try {
      records = JSON.parse(readFileSync(registryPath, 'utf-8'))
    } catch {
      return { cleanedCount: 0 }
    }
    let cleanedCount = 0
    for (const record of records) {
      if (isProcessRunning(record.pid)) {
        try {
          process.kill(record.pid, 'SIGTERM')
          cleanedCount++
        } catch {
          // Process already gone
        }
      }
    }
    this.clearRegistry()
    return { cleanedCount }
  }

  private persistRegistry(): void {
    const records: SessionRecord[] = []
    for (const [sessionId, session] of this.sessions) {
      records.push({
        sessionId,
        pid: session.pty.pid,
        cwd: session.info.cwd,
        shell: '',
      })
    }
    try {
      writeFileSync(REGISTRY_FILE(), JSON.stringify(records))
    } catch {
      // Best-effort
    }
  }

  private clearRegistry(): void {
    try {
      writeFileSync(REGISTRY_FILE(), JSON.stringify([]))
    } catch {
      // Best-effort
    }
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
