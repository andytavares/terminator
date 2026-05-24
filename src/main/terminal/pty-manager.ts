import * as pty from 'node-pty'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

interface SessionRecord {
  sessionId: string
  pid: number
  cwd: string
  shell: string
}

interface ActiveSession {
  pty: pty.IPty
  sessionId: string
  type: 'human' | 'agent'
  onDataCallback?: (data: string) => void
  onExitCallback?: (exitCode: number) => void
}

const REGISTRY_FILE = () => join(app.getPath('userData'), 'session-registry.json')

export class PtyManager {
  private sessions = new Map<string, ActiveSession>()

  spawn(
    sessionId: string,
    cwd: string,
    shell: string,
    type: 'human' | 'agent',
    onData: (data: string) => void,
    onExit: (exitCode: number) => void
  ): string {
    const ptyProcess = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as { [key: string]: string },
    })

    const session: ActiveSession = {
      pty: ptyProcess,
      sessionId,
      type,
      onDataCallback: onData,
      onExitCallback: onExit,
    }

    ptyProcess.onData(onData)
    ptyProcess.onExit(({ exitCode }) => {
      this.sessions.delete(sessionId)
      this.persistRegistry()
      onExit(exitCode ?? 0)
    })

    this.sessions.set(sessionId, session)
    this.persistRegistry()
    return sessionId
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
        cwd: '',
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
