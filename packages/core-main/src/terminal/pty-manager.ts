import * as pty from 'node-pty'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { SessionInfo, SpawnSessionOptions } from '@terminator/extension-sdk'

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

interface ActiveSession {
  pty: pty.IPty
  info: SessionInfo
  dataListeners: Set<(data: string) => void>
  exitListeners: Set<(exitCode: number | null) => void>
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

/**
 * A terminal was asked for in a folder that is not there.
 *
 * node-pty does not fail such a spawn: the child forks, cannot chdir, and
 * exits with status 1 having printed nothing. That reaches the operator as a
 * tab which appears and immediately dies with a blank screen and no reason
 * given — the exact shape of "my terminals just exit". A branch whose worktree
 * was removed outside the app, or a repo folder that has been deleted, is this
 * case, so the check lives in the one place every caller goes through.
 */
export class MissingCwdError extends Error {
  constructor(readonly cwd: string) {
    super(`That folder no longer exists: ${cwd}`)
    this.name = 'MissingCwdError'
  }
}

/** The process's exit code, or null when a signal ended it. node-pty reports a signalled process
 * as `exitCode` 0 with the signal beside it (WIFSIGNALED in its src/unix/pty.cc), and 0 alone
 * reads as success. */
function exitStatusOf(exit: { exitCode: number; signal?: number }): number | null {
  return exit.signal ? null : exit.exitCode
}

function assertUsableCwd(cwd: string): void {
  let isDirectory: boolean
  try {
    isDirectory = statSync(cwd).isDirectory()
  } catch {
    throw new MissingCwdError(cwd)
  }
  if (!isDirectory) throw new MissingCwdError(cwd)
}

function spawnPtySession(opts: SpawnSessionOptions): ActiveSession {
  const ptyProcess = pty.spawn(opts.shell, opts.args ?? ['-l'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: opts.cwd,
    env: { ...(process.env as { [key: string]: string }), ...(opts.env ?? {}) },
  })
  return {
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
}

/** Hands output to the listeners, or holds it while the session is holding. */
function deliverOrHold(session: ActiveSession, data: string): void {
  if (session.held === null) {
    for (const listener of session.dataListeners) listener(data)
    return
  }
  session.held.push(data)
  session.heldChars += data.length
  // Oldest first: what matters most on a long-running agent is the recent
  // output, and the alternative is an unbounded buffer.
  while (session.heldChars > MAX_HELD_CHARS && session.held.length > 1) {
    session.heldChars -= session.held.shift()?.length ?? 0
  }
}

/** Everything held, joined, and stops holding; null when nothing was held. */
function takeHeld(session: ActiveSession): string | null {
  if (session.held === null || session.held.length === 0) return null
  const buffered = session.held.join('')
  session.held = null
  session.heldChars = 0
  return buffered
}

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
    // Before the spawn, not after: a PTY started in a missing directory is
    // already dead, and nothing downstream can tell that apart from a shell
    // the operator exited.
    assertUsableCwd(opts.cwd)

    const session = spawnPtySession(opts)
    session.pty.onData((data) => deliverOrHold(session, data))
    session.pty.onExit((exit) => this.endSession(session, exit))

    this.sessions.set(opts.sessionId, session)
    this.persistRegistry()
    return { ...session.info }
  }

  private endSession(session: ActiveSession, exit: { exitCode: number; signal?: number }): void {
    const { sessionId } = session.info
    // Held output goes out first: a process that dies before any tab mounted (a bad flag, the wrong
    // cwd) would otherwise leave the blank terminal the hold prevents. Delivered to whoever
    // listens, and kept on the session for whoever attaches next.
    const buffered = takeHeld(session)
    if (buffered !== null) {
      if (session.dataListeners.size > 0) {
        for (const listener of session.dataListeners) listener(buffered)
      } else {
        // Nothing has mounted yet. Kept for a tab that is still on its way, because the alternative
        // is the blank terminal this hold exists to prevent — and a run that dies at launch is
        // exactly when its output matters most.
        this.rememberForLateAttach(sessionId, buffered)
      }
    }
    this.sessions.delete(sessionId)
    this.persistRegistry()
    const exitCode = exitStatusOf(exit)
    for (const listener of session.exitListeners) listener(exitCode)
    session.dataListeners.clear()
    session.exitListeners.clear()
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

  /** Subscribes to a session's exit: its exit code, or null when a signal ended it. Listeners
   * fire after the session is removed. */
  onExit(sessionId: string, listener: (exitCode: number | null) => void): (() => void) | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    session.exitListeners.add(listener)
    return () => session.exitListeners.delete(listener)
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

  /** Stops reading the PTY, so the child blocks once the kernel buffer fills. */
  pause(sessionId: string): void {
    this.sessions.get(sessionId)?.pty.pause()
  }

  resume(sessionId: string): void {
    this.sessions.get(sessionId)?.pty.resume()
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
    let records: SessionRecord[]
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
