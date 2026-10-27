import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { app } from 'electron'
import { shellQuote } from '@terminator/extension-sdk/node'
import { putHook } from '../integrations/claude-settings.js'
import { sessionContextDirectory } from '../integrations/session-context.js'

// How the app learns what Claude Code does in a terminal tab, including one the operator typed by hand.
//
// ONE script and ONE set of entries in the operator's own Claude settings
// (payloads: https://code.claude.com/docs/en/hooks). The script reads the event name from stdin:
//   SessionStart                          -> agent-sessions/<terminal>.json (the conversation's id,
//                                            transcript and folder), plus the linked issue as context
//   Notification, UserPromptSubmit,
//   Stop, StopFailure                     -> agent-sessions/asks/<microseconds>-<pid>.json
// A file drop, not an `http` hook: the app runs no local server a hook could reach.
// A project's own `.claude/settings.local.json` runs the same script with a third argument, the
// project's context file (see integrations/session-hook.ts).

const SCRIPT_NAME = 'claude-hook.cjs'
// Scripts of earlier versions. Their entries are collapsed into ours and the files removed.
const LEGACY_SCRIPT_NAMES = [
  'agent-ask-hook.cjs',
  'agent-session-hook.cjs',
  'session-start-hook.cjs',
]
const REPORT_DIR_NAME = 'agent-sessions'
const ASKS_DIR_NAME = 'asks'
const EVENTS = ['SessionStart', 'Notification', 'UserPromptSubmit', 'Stop', 'StopFailure']

/** Every name an entry of ours can carry, current and legacy. */
export const HOOK_MARKERS = [SCRIPT_NAME, ...LEGACY_SCRIPT_NAMES]

/**
 * The script the agent executes. Carried as source and written at startup (ADR-026): a loose
 * script beside the bundle survives development and vanishes from the packaged app.
 * It is silent on any error: it runs before every agent session in every folder, and a hook that
 * fails loudly would break sessions that have nothing to do with this application.
 * @internal
 */
export const HOOK_SCRIPT = `// Written by Terminator. Do not edit: it is overwritten on every start.
const fs = require('fs')
const path = require('path')

const [reportDir, sessionContextDir, projectContextFile] = process.argv.slice(2)
const terminal = process.env.TERMINATOR_SESSION_ID
const ASK_EVENTS = { Notification: 'notification', Stop: 'stop', StopFailure: 'stop', UserPromptSubmit: 'prompt' }

function writeAtomically(target, report) {
  fs.writeFileSync(target + '.tmp', JSON.stringify(report), 'utf8')
  fs.renameSync(target + '.tmp', target)
}

function recordSession(payload) {
  if (!payload.session_id || !payload.transcript_path || !payload.cwd) return
  fs.mkdirSync(reportDir, { recursive: true })
  writeAtomically(path.join(reportDir, terminal + '.json'), {
    terminal,
    provider: 'claude',
    sessionId: payload.session_id,
    transcriptPath: payload.transcript_path,
    cwd: payload.cwd,
    source: typeof payload.source === 'string' ? payload.source : 'unknown',
    at: new Date().toISOString(),
  })
}

function recordAsk(payload, event) {
  const directory = path.join(reportDir, ${JSON.stringify(ASKS_DIR_NAME)})
  fs.mkdirSync(directory, { recursive: true })
  // Microseconds since the epoch, fixed width: the watcher applies files in name order, and
  // two hooks of one turn can land in the same millisecond.
  const at = (performance.timeOrigin + performance.now()).toFixed(3)
  writeAtomically(path.join(directory, at + '-' + process.pid + '.json'), {
    terminal,
    event,
    message: typeof payload.message === 'string' ? payload.message : '',
    notificationType: typeof payload.notification_type === 'string' ? payload.notification_type : null,
    at: new Date().toISOString(),
  })
}

function printContext(file) {
  const context = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!context || typeof context.markdown !== 'string' || context.markdown.length === 0) return
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        // Required. Without it the runtime ignores the whole object.
        hookEventName: 'SessionStart',
        additionalContext: context.markdown,
        sessionTitle: typeof context.key === 'string' ? context.key : undefined,
      },
    })
  )
}

function handleReport(payload) {
  const event = ASK_EVENTS[payload.hook_event_name]
  if (event) recordAsk(payload, event)
  else if (payload.hook_event_name === 'SessionStart') recordSession(payload)
}

function handleContext() {
  const sessionFile = terminal && sessionContextDir && path.join(sessionContextDir, terminal + '.json')
  if (!projectContextFile) return sessionFile && printContext(sessionFile)
  // The project's link yields to the terminal's own, which the user-level entry already printed.
  if (sessionFile && fs.existsSync(sessionFile)) return
  printContext(projectContextFile)
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  raw += chunk
})
process.stdin.on('end', () => {
  try {
    // No terminal: the agent runs somewhere this application does not own.
    const payload = terminal && reportDir && !projectContextFile ? JSON.parse(raw) : null
    if (payload && typeof payload === 'object') handleReport(payload)
  } catch {
    // Intentionally silent: an unseen event is a missed badge; a failing hook breaks a session.
  }
  try {
    const payload = projectContextFile ? { hook_event_name: 'SessionStart' } : JSON.parse(raw)
    if (payload && payload.hook_event_name === 'SessionStart' && (terminal || projectContextFile)) handleContext()
  } catch {
    // No context, or it could not be read: print nothing.
  } finally {
    process.exit(0)
  }
})
`

/** Where the hook writes, and the watchers read. */
export function reportDirectory(): string {
  return path.join(app.getPath('userData'), REPORT_DIR_NAME)
}

/** Where the hook writes asks. */
export function asksDirectory(): string {
  return path.join(reportDirectory(), ASKS_DIR_NAME)
}

/** The operator's Claude settings, under HOME. Not Electron's home: on macOS that is the account's
 * whatever HOME says, so a sealed test run wrote the developer's own file. @internal */
export function userSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

/** Write the script, remove the scripts of earlier versions, and return its absolute path. */
export async function installHookScript(directory: string): Promise<string> {
  await fs.mkdir(directory, { recursive: true })
  const target = path.join(directory, SCRIPT_NAME)
  await fs.writeFile(target, HOOK_SCRIPT, 'utf8')
  await Promise.all(
    LEGACY_SCRIPT_NAMES.map((name) => fs.rm(path.join(directory, name), { force: true }))
  )
  return target
}

export interface HookOptions {
  /** Electron's own binary, run in node mode. */
  execPath: string
  scriptPath: string
}

// Claude settings are global: skip outside a Terminator terminal, and when the script is gone
// (this entry outlives any install of the application). Always exits 0.
function userCommand(options: HookOptions): string {
  const run = [
    'ELECTRON_RUN_AS_NODE=1',
    shellQuote(options.execPath),
    shellQuote(options.scriptPath),
    shellQuote(reportDirectory()),
    shellQuote(sessionContextDirectory()),
  ].join(' ')
  return `[ -n "$TERMINATOR_SESSION_ID" ] && test -f ${shellQuote(options.scriptPath)} && ${run} || true`
}

/** One entry per event in the operator's Claude settings. Entries of this script, at any path or
 * under any legacy name, collapse into it; every other entry survives. */
export async function installUserHooks(options: HookOptions): Promise<void> {
  const ours = { marker: HOOK_MARKERS, command: userCommand(options) }
  for (const event of EVENTS) await putHook(userSettingsPath(), event, ours)
}
