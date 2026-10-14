import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AgentConversation, SessionSnapshot } from '../../shared/types/index.js'
import { parseHookReport } from '../../shared/agent-sessions/report.js'
import { setAgent } from '../sessions/session-record-store.js'
import { reportDirectory } from './agent-session-hook.js'
import { makeLogger } from '../logger.js'

// Folding what the capture hook writes into the session records.
//
// The hook is a separate process with no route into this one, so a file is the
// channel: one per terminal, replaced each time that terminal's agent reports.
// Watching the directory is what makes a conversation resumable seconds after
// it starts, without polling.

export interface WatcherOptions {
  /** Where the named terminal lives, or null when this process does not know it. */
  snapshotFor: (sessionId: string) => SessionSnapshot | null
}

const logger = makeLogger('agent-session-watcher')

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

/** Folds one report in and deletes it, so each is handled once however many events announce it;
 * one for a terminal this process cannot place is stale and deleted too. Renamed before it is read,
 * so a report the hook writes meanwhile lands as a new file instead of being deleted unread. */
function consume(file: string, options: WatcherOptions): void {
  const claimed = `${file}.claimed`
  try {
    fs.renameSync(file, claimed)
  } catch {
    return // Already handled by an earlier event.
  }
  try {
    const report = parseHookReport(JSON.parse(fs.readFileSync(claimed, 'utf8')))
    const snapshot = report && options.snapshotFor(report.terminal)
    if (report && snapshot) void setAgent(snapshot, conversationOf(report))
  } catch {
    // Not a report, or unreadable: nothing to record.
  } finally {
    fs.rmSync(claimed, { recursive: true, force: true })
  }
}

function consumeDirectory(directory: string, options: WatcherOptions): void {
  let names: string[]
  try {
    names = fs.readdirSync(directory)
  } catch {
    return
  }
  for (const name of names) {
    if (name.endsWith('.json')) consume(path.join(directory, name), options)
  }
}

const ARMED_PROBE = '.armed'
const PROBE_RETRY_MS = 50
const PROBE_TRIES = 40

/** Writes the probe file until the watch reports it, which is the only proof the watch is armed:
 * macOS arms `fs.watch` a moment after it returns and has no event for it
 * (https://nodejs.org/api/fs.html#caveats). Returns how to stop trying. */
function probeUntilArmed(directory: string, isArmed: () => boolean): () => void {
  const probe = path.join(directory, ARMED_PROBE)
  let timer: NodeJS.Timeout | undefined
  const tryOnce = (triesLeft: number): void => {
    if (isArmed() || triesLeft === 0) return
    fs.writeFileSync(probe, String(triesLeft))
    timer = setTimeout(() => tryOnce(triesLeft - 1), PROBE_RETRY_MS)
  }
  tryOnce(PROBE_TRIES)
  return () => {
    clearTimeout(timer)
    fs.rmSync(probe, { force: true })
  }
}

/** Watches for reported conversations (`fs.watch`, ADR-005) and returns the way to stop. The
 * directory is read at startup, for reports written while the app was closed, and once more when
 * the watch proves it is armed, for reports written before that. */
export function startAgentSessionWatcher(options: WatcherOptions): () => void {
  const directory = reportDirectory()
  fs.mkdirSync(directory, { recursive: true })
  let armed = false
  let stopProbing = (): void => undefined

  const watcher = fs.watch(directory, (_event, name) => {
    if (!armed) {
      armed = true
      stopProbing()
      consumeDirectory(directory, options)
    } else if (name === null) consumeDirectory(directory, options)
    else if (name.endsWith('.json')) consume(path.join(directory, name), options)
  })
  watcher.on('error', (error) =>
    logger.error('agent session report watch failed', { error: String(error) })
  )
  consumeDirectory(directory, options)
  stopProbing = probeUntilArmed(directory, () => armed)
  return () => {
    stopProbing()
    watcher.close()
  }
}
