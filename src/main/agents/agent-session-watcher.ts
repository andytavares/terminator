import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AgentConversation, SessionSnapshot } from '../../shared/types/index.js'
import { parseHookReport } from '../../shared/agent-sessions/report.js'
import { setAgent } from '../sessions/session-record-store.js'
import { reportDirectory } from './agent-session-hook.js'

// Folding what the capture hook writes into the session records.
//
// The hook is a separate process with no route into this one, so a file is the
// channel: one per terminal, replaced each time that terminal's agent reports.
// Watching it is what makes a conversation resumable seconds after it starts,
// without polling.

export interface WatcherOptions {
  /** Where the named terminal lives, or null when this process does not know it. */
  snapshotFor: (sessionId: string) => SessionSnapshot | null
  /** How often the reports are read. Left alone outside tests. */
  intervalMs?: number
}

/** Often enough for a conversation to be resumable seconds after it starts (SC-001). */
const DEFAULT_INTERVAL_MS = 1000

function conversationOf(
  report: NonNullable<ReturnType<typeof parseHookReport>>
): AgentConversation {
  return {
    provider: report.provider,
    sessionId: report.sessionId,
    transcriptPath: report.transcriptPath,
    cwd: report.cwd,
    capturedAt: report.at,
  }
}

/** What was last folded per terminal, so one report is not written twice. */
const lastSeen = new Map<string, string>()

function fold(file: string, options: WatcherOptions): void {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    // Being written as we read it, or already gone. The next sweep brings it.
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  const report = parseHookReport(parsed)
  if (report === null) return

  const seen = `${report.sessionId}:${report.at}`
  if (lastSeen.get(report.terminal) === seen) return

  const snapshot = options.snapshotFor(report.terminal)
  // A conversation in a terminal this process cannot place: an old report, or
  // one from a session that has already gone. There is nothing to attach it to.
  if (snapshot === null) return

  lastSeen.set(report.terminal, seen)
  void setAgent(snapshot, conversationOf(report))
}

/**
 * Watch for reported conversations. Returns the way to stop.
 *
 * Swept rather than watched: `fs.watch` on a directory is the platform's
 * business, and a report that arrives while the application is closed has no
 * event to deliver anyway. A handful of small files read once a second costs
 * nothing, and each is folded in only when it changes.
 */
export function startAgentSessionWatcher(options: WatcherOptions): () => void {
  const directory = reportDirectory()
  fs.mkdirSync(directory, { recursive: true })
  lastSeen.clear()

  const sweep = (): void => {
    let names: string[]
    try {
      names = fs.readdirSync(directory)
    } catch {
      return
    }
    for (const name of names) {
      if (name.endsWith('.json')) fold(path.join(directory, name), options)
    }
  }

  sweep()
  const timer = setInterval(sweep, options.intervalMs ?? DEFAULT_INTERVAL_MS)
  // Never a reason to hold the process open.
  timer.unref?.()
  return () => clearInterval(timer)
}
