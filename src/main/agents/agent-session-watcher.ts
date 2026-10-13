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

/** Watches for reported conversations (`fs.watch`, ADR-005) and returns the way to stop. Reports
 * written while the app was closed have no event, so the directory is also read once at startup,
 * after the watch is armed so that nothing falls between. */
export function startAgentSessionWatcher(options: WatcherOptions): () => void {
  const directory = reportDirectory()
  fs.mkdirSync(directory, { recursive: true })

  const watcher = fs.watch(directory, (_event, name) => {
    // Some platforms deliver an event without saying which file.
    if (name === null) consumeDirectory(directory, options)
    else if (name.endsWith('.json')) consume(path.join(directory, name), options)
  })
  watcher.on('error', (error) =>
    logger.error('agent session report watch failed', { error: String(error) })
  )
  consumeDirectory(directory, options)
  return () => watcher.close()
}
