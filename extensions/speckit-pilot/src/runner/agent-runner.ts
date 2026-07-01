import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import type { PhaseId } from '../types/speckit.types.js'

/** Absolute path to a phase's persisted output log. */
export function phaseLogPath(featureDir: string, phase: PhaseId): string {
  return path.join(featureDir, '.pilot', 'logs', `${phase}.log`)
}

/**
 * Delete persisted phase logs older than the retention window (best-effort).
 * Returns the number of log files removed.
 */
export async function pruneOldLogs(
  featureDir: string,
  retentionDays: number,
  now: number = Date.now()
): Promise<number> {
  const logsDir = path.join(featureDir, '.pilot', 'logs')
  const cutoff = now - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000
  let removed = 0
  let entries: string[]
  try {
    entries = await fs.promises.readdir(logsDir)
  } catch {
    return 0
  }
  for (const name of entries) {
    if (!name.endsWith('.log')) continue
    const file = path.join(logsDir, name)
    try {
      const stat = await fs.promises.stat(file)
      if (stat.mtimeMs < cutoff) {
        await fs.promises.unlink(file)
        removed++
      }
    } catch {
      // ignore unreadable entries
    }
  }
  return removed
}

export interface RunnerHandle {
  stop(): void
}

export interface StartPhaseRunnerOpts {
  featureDir: string
  worktreePath: string
  phaseCommand: string
  phase: PhaseId
  feedbackNote?: string
  batchIndex?: number
  onStart?: () => void | Promise<void>
  onComplete?: (exitCode: number) => void | Promise<void>
}

export interface AgentRunner {
  startPhaseRunner(opts: StartPhaseRunnerOpts): RunnerHandle
}

const SELF_REVIEW_CMD = [
  'npm run format',
  'npm run lint',
  'npx vitest run --coverage',
  'claude --print /google-review',
].join(' && ')

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

export function createAgentRunner(api: ExtensionAPI): AgentRunner {
  return {
    startPhaseRunner(opts) {
      const {
        featureDir,
        worktreePath,
        phaseCommand,
        phase,
        feedbackNote,
        batchIndex,
        onStart,
        onComplete,
      } = opts

      const shellBin = process.env.SHELL ?? '/bin/sh'
      const spawnOpts = {
        cwd: worktreePath,
        env: process.env as Record<string, string>,
        stdio: ['ignore', 'pipe', 'pipe'] as const,
      }

      let cmd: string
      if (phase === 'self-review') {
        cmd = SELF_REVIEW_CMD
      } else {
        const prompt = feedbackNote
          ? `${phaseCommand}\n\nFeedback from reviewer:\n${feedbackNote}`
          : phaseCommand
        cmd = `claude --print ${shellQuote(prompt)}`
      }

      const child = spawn(shellBin, ['-l', '-c', cmd], spawnOpts)

      if (onStart) void Promise.resolve(onStart())

      const outputBuffer: string[] = []

      // Persist output so it can be reviewed after the run finishes.
      let logStream: fs.WriteStream | null = null
      try {
        const logPath = phaseLogPath(featureDir, phase)
        fs.mkdirSync(path.dirname(logPath), { recursive: true })
        logStream = fs.createWriteStream(logPath, { flags: 'a' })
        logStream.write(`\n=== run ${new Date().toISOString()} — ${phase} ===\n`)
      } catch {
        logStream = null
      }
      const persist = (line: string) => {
        try {
          logStream?.write(line + '\n')
        } catch {
          // best-effort logging; never break the run
        }
      }

      const handleData = (data: Buffer | string) => {
        const text = typeof data === 'string' ? data : data.toString()
        outputBuffer.push(text)
        for (const line of text.split('\n')) {
          if (line) {
            persist(line)
            api.window.broadcast('speckit:run-output', {
              featureDir,
              phase,
              line,
              ts: new Date().toISOString(),
            })
          }
        }
      }

      child.stdout?.on('data', handleData)
      child.stderr?.on('data', (data: Buffer | string) => {
        // Collect stderr separately; only surface on error to avoid duplicating
        // output that claude --print writes to both stdout and stderr.
        const text = typeof data === 'string' ? data : data.toString()
        outputBuffer.push(text)
        persist(text.replace(/\n$/, ''))
      })

      child.on('error', (err) => {
        persist(`[runner error] ${err.message}`)
        logStream?.end()
        api.window.broadcast('speckit:run-output', {
          featureDir,
          phase,
          line: `[runner error] ${err.message}`,
          ts: new Date().toISOString(),
        })
        if (onComplete) void Promise.resolve(onComplete(1))
        api.window.broadcast('speckit:run-phase-complete', { featureDir, phase, exitCode: 1 })
      })

      child.on('close', (exitCode) => {
        const code = exitCode ?? 0
        logStream?.end()
        if (onComplete) void Promise.resolve(onComplete(code))
        if (phase === 'implement' && batchIndex !== undefined) {
          api.window.broadcast('speckit:checkin-ready', {
            featureDir,
            batchIndex,
            diffSummary: outputBuffer.join('').slice(-500),
          })
        } else {
          api.window.broadcast('speckit:run-phase-complete', {
            featureDir,
            phase,
            exitCode: code,
          })
        }
      })

      return {
        stop() {
          child.kill('SIGTERM')
        },
      }
    },
  }
}
