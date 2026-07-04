import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import type { PhaseId } from '../types/speckit.types.js'
import {
  noteFromStreamJsonLine,
  sessionIdFromStreamJsonLine,
  textFromStreamJsonLine,
} from './stream-json.js'

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
  // When set, resume the given Claude session instead of starting fresh — used
  // to answer the model's questions from the run console (the reply is
  // `phaseCommand`).
  resumeSessionId?: string
  // Kill the run if it hasn't finished in this long (default 15 min).
  timeoutMs?: number
  onStart?: () => void | Promise<void>
  onComplete?: (exitCode: number) => void | Promise<void>
  // Fires with the Claude session id as soon as it's known, so the pilot can
  // resume the conversation later.
  onSession?: (sessionId: string) => void
}

export interface AgentRunner {
  startPhaseRunner(opts: StartPhaseRunnerOpts): RunnerHandle
}

const SELF_REVIEW_CMD = [
  'npm run format',
  'npm run lint',
  'npx vitest run --coverage',
  'claude --print --permission-mode bypassPermissions --strict-mcp-config /google-review',
].join(' && ')

// Kill a phase that has produced nothing for this long — a headless run that
// hangs (e.g. on a blocked API call) would otherwise wait forever.
const DEFAULT_PHASE_TIMEOUT_MS = 15 * 60 * 1000

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
        resumeSessionId,
        timeoutMs = DEFAULT_PHASE_TIMEOUT_MS,
        onStart,
        onComplete,
        onSession,
      } = opts

      const shellBin = process.env.SHELL ?? '/bin/sh'
      // Point the native `/speckit-*` skills at this card's feature directory so
      // they operate on the right spec/plan/tasks files regardless of the git
      // branch name (SpecKit's common.sh honors these over branch inference).
      // The dir is relative to the worktree cwd, matching SpecKit's own
      // `specs/<slug>` convention.
      const featureSlug = path.basename(featureDir)
      const spawnOpts = {
        cwd: worktreePath,
        env: {
          ...process.env,
          SPECIFY_FEATURE: featureSlug,
          SPECIFY_FEATURE_DIRECTORY: path.join('specs', featureSlug),
        } as Record<string, string>,
        stdio: ['ignore', 'pipe', 'pipe'] as const,
      }

      // Self-review runs a shell chain (npm/vitest/google-review) whose stdout is
      // already plain, line-buffered text. Every other phase runs claude in
      // stream-json mode so its assistant output streams to the console in real
      // time instead of arriving in one chunk when --print buffers to the end.
      const streaming = phase !== 'self-review'
      let cmd: string
      if (phase === 'self-review') {
        cmd = SELF_REVIEW_CMD
      } else {
        const prompt = feedbackNote
          ? `${phaseCommand}\n\nFeedback from reviewer:\n${feedbackNote}`
          : phaseCommand
        // A reply resumes the existing conversation so the model has full context
        // for the answer; a fresh phase run starts a new session.
        const resumeFlag = resumeSessionId ? `--resume ${shellQuote(resumeSessionId)} ` : ''
        // Phases run headless in the card's isolated worktree, so bypass
        // permission prompts — a spawned `--print` process has no interactive
        // channel to approve tool calls, and without this every Write/Edit/Bash
        // stalls forever (see ADR-007). `--strict-mcp-config` (with no
        // --mcp-config) disables all MCP servers, which otherwise hang the
        // headless spawn on startup (context7, Linear, Gmail, …).
        cmd = `claude --print ${resumeFlag}--permission-mode bypassPermissions --strict-mcp-config --output-format stream-json --verbose --include-partial-messages ${shellQuote(prompt)}`
      }

      const child = spawn(shellBin, ['-l', '-c', cmd], spawnOpts)

      // Safety net: a hung headless run (blocked API call, wedged tool) would
      // otherwise never emit `close`. Kill it and let the close handler report.
      const killTimer = setTimeout(() => {
        api.window.broadcast('speckit:run-output', {
          featureDir,
          phase,
          line: `⚠ no response after ${Math.round(timeoutMs / 60000)} min — stopping this phase`,
          ts: new Date().toISOString(),
        })
        child.kill('SIGTERM')
        setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            // already gone
          }
        }, 3000)
      }, timeoutMs)

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

      const emitLine = (line: string) => {
        outputBuffer.push(line + '\n')
        persist(line)
        api.window.broadcast('speckit:run-output', {
          featureDir,
          phase,
          line,
          ts: new Date().toISOString(),
        })
      }

      // Show immediate activity so the console isn't a silent "Waiting for
      // output…" while the agent boots (it can be seconds before the first
      // assistant token, and longer if it's stuck).
      emitLine(`▶ ${phase}${phaseCommand ? `: ${phaseCommand}` : ''}`)

      // Two-level line buffering for stream-json: stdout chunks can split a JSON
      // event, and a display line can span several text deltas.
      let jsonlBuffer = ''
      let displayBuffer = ''

      let sessionCaptured = false
      const handleStreamJson = (text: string) => {
        jsonlBuffer += text
        const jsonLines = jsonlBuffer.split('\n')
        jsonlBuffer = jsonLines.pop() ?? ''
        for (const jline of jsonLines) {
          if (!sessionCaptured) {
            const sid = sessionIdFromStreamJsonLine(jline)
            if (sid) {
              sessionCaptured = true
              onSession?.(sid)
              // Confirm the agent actually launched, before any assistant text.
              emitLine(`· session ${sid.slice(0, 8)} started`)
            }
          }
          const chunk = textFromStreamJsonLine(jline)
          if (!chunk) {
            // No assistant text — surface tool activity / errors so a run that's
            // busy with tool calls (or has failed) isn't a silent blank console.
            const note = noteFromStreamJsonLine(jline)
            if (note) {
              if (displayBuffer.length > 0) {
                emitLine(displayBuffer)
                displayBuffer = ''
              }
              emitLine(note)
            }
            continue
          }
          displayBuffer += chunk
          const displayLines = displayBuffer.split('\n')
          displayBuffer = displayLines.pop() ?? ''
          for (const dline of displayLines) emitLine(dline)
        }
      }

      // Emit any buffered trailing text (a final line with no terminating newline).
      const flushStreamJson = () => {
        if (jsonlBuffer.trim()) {
          displayBuffer += textFromStreamJsonLine(jsonlBuffer)
          jsonlBuffer = ''
        }
        if (displayBuffer.length > 0) {
          emitLine(displayBuffer)
          displayBuffer = ''
        }
      }

      const handleData = (data: Buffer | string) => {
        const text = typeof data === 'string' ? data : data.toString()
        if (streaming) {
          handleStreamJson(text)
        } else {
          for (const line of text.split('\n')) {
            if (line) emitLine(line)
          }
        }
      }

      child.stdout?.on('data', handleData)
      // In stream-json mode stdout is pure JSON, so stderr carries only
      // diagnostics (command-not-found, rate-limit notices, node errors). Stream
      // it to the console so a stalled or failed run is visible instead of a
      // silent "Waiting for output…".
      let stderrBuffer = ''
      child.stderr?.on('data', (data: Buffer | string) => {
        const text = typeof data === 'string' ? data : data.toString()
        outputBuffer.push(text)
        stderrBuffer += text
        const lines = stderrBuffer.split('\n')
        stderrBuffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          persist(line)
          api.window.broadcast('speckit:run-output', {
            featureDir,
            phase,
            line: `⚠ ${line}`,
            ts: new Date().toISOString(),
          })
        }
      })

      child.on('error', (err) => {
        clearTimeout(killTimer)
        flushStreamJson()
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
        clearTimeout(killTimer)
        flushStreamJson()
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
          clearTimeout(killTimer)
          child.kill('SIGTERM')
        },
      }
    },
  }
}
