import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { app } from 'electron'

// How a conversation comes to be known.
//
// A SessionStart hook, registered once in the operator's own Claude settings,
// writes what the agent reports about each conversation: its id, its transcript
// and the folder it runs in. The terminal it belongs to comes from the
// environment this application sets when it opens that terminal.
//
// User level rather than per repository, because the conversations worth
// resuming are mostly ones the operator started by hand, in any branch — and
// one entry in a file they own beats a file written into every repo of theirs.

const SCRIPT_NAME = 'agent-session-hook.cjs'
const REPORT_DIR_NAME = 'agent-sessions'

/**
 * The script the agent executes.
 *
 * Carried as source and written at startup, for the reason ADR-026 gives: a
 * loose script beside the bundle survives development and vanishes from the
 * packaged app.
 *
 * Its whole authority is: read stdin, write one small file, exit 0. It prints
 * nothing — this hook runs before every agent session in every folder, and a
 * hook that fails loudly would break sessions that have nothing to do with it.
 */
export const CAPTURE_SCRIPT = `// Written by Terminator. Do not edit: it is overwritten on every start.
const fs = require('fs')
const path = require('path')

const [reportDir] = process.argv.slice(2)
const terminal = process.env.TERMINATOR_SESSION_ID

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  raw += chunk
})
process.stdin.on('end', () => {
  try {
    // No terminal means the agent is running somewhere this application does
    // not own. There is nothing to attach the conversation to.
    if (!terminal) return
    const payload = JSON.parse(raw)
    if (!payload || typeof payload !== 'object') return
    if (!payload.session_id || !payload.transcript_path || !payload.cwd) return

    fs.mkdirSync(reportDir, { recursive: true })
    const report = {
      terminal,
      provider: 'claude',
      sessionId: payload.session_id,
      transcriptPath: payload.transcript_path,
      cwd: payload.cwd,
      source: typeof payload.source === 'string' ? payload.source : 'unknown',
      at: new Date().toISOString(),
    }
    const target = path.join(reportDir, terminal + '.json')
    fs.writeFileSync(target + '.tmp', JSON.stringify(report), 'utf8')
    fs.renameSync(target + '.tmp', target)
  } catch {
    // Intentionally silent: a session that starts knowing nothing is a session;
    // a session that will not start is a regression.
  } finally {
    process.exit(0)
  }
})
`

/** Where the hook writes, and the watcher reads. */
export function reportDirectory(): string {
  return path.join(app.getPath('userData'), REPORT_DIR_NAME)
}

/** Write the capture script and return its absolute path. */
export async function installCaptureScript(directory: string): Promise<string> {
  await fs.mkdir(directory, { recursive: true })
  const target = path.join(directory, SCRIPT_NAME)
  await fs.writeFile(target, CAPTURE_SCRIPT, 'utf8')
  return target
}

// ── The owned entry in the operator's Claude settings ────────────────────────

interface SettingsFile {
  hooks?: { SessionStart?: unknown[] } & Record<string, unknown>
  [key: string]: unknown
}

interface HookEntry {
  matcher?: string
  hooks?: Array<{ type?: string; command?: string; timeout?: number }>
}

export interface CaptureHookOptions {
  /** Electron's own binary, run in node mode. */
  execPath: string
  scriptPath: string
}

function userSettingsPath(): string {
  return path.join(app.getPath('home'), '.claude', 'settings.json')
}

/** Single-quoted for a POSIX shell, which is what runs this. */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * The command line the agent executes.
 *
 * `ELECTRON_RUN_AS_NODE=1` with the application's own binary, so the hook needs
 * neither a `node` on `PATH` nor whatever a login shell exported — the same
 * reasoning as the issue-context hook.
 */
function captureCommand(options: CaptureHookOptions): string {
  const run = [
    'ELECTRON_RUN_AS_NODE=1',
    quote(options.execPath),
    quote(options.scriptPath),
    quote(reportDirectory()),
  ].join(' ')
  // Guarded by the script's own existence. This entry lives in the operator's
  // settings and outlives any particular install of this application — a
  // development profile, a moved app — and a hook whose script has gone must do
  // nothing at all rather than fail before every agent session on the machine.
  return `test -f ${quote(options.scriptPath)} && ${run} || true`
}

/**
 * Ours, whichever install wrote it.
 *
 * Matched on the script's name rather than its full path: the path contains the
 * application's data directory, which differs between a packaged app, a
 * development run and a test profile. Matching the path would leave one stale
 * entry per profile stacked in the operator's settings.
 */
function isOurs(entry: unknown): boolean {
  const hooks = (entry as HookEntry | null)?.hooks
  if (!Array.isArray(hooks)) return false
  return hooks.some((h) => typeof h?.command === 'string' && h.command.includes(SCRIPT_NAME))
}

async function readSettings(): Promise<SettingsFile | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(userSettingsPath(), 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as SettingsFile) : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    // Malformed is not missing. These are the operator's own settings for every
    // agent session they run; overwriting what cannot be parsed would destroy
    // work that has nothing to do with this application.
    throw new Error(`Could not read ${userSettingsPath()}: ${String(error)}`)
  }
}

/**
 * Register the capture hook in the operator's Claude settings.
 *
 * Merge, never replace: every other `SessionStart` entry and every other key
 * survives, and re-installing replaces exactly our own entry rather than
 * stacking copies. Removing it again is one block in a file the operator owns,
 * and the user guide says which.
 */
export async function installUserHook(options: CaptureHookOptions): Promise<void> {
  const existing = await readSettings()
  const settings: SettingsFile = existing ?? {}
  const hooks = (settings.hooks ?? {}) as NonNullable<SettingsFile['hooks']>
  const sessionStart = Array.isArray(hooks.SessionStart) ? [...hooks.SessionStart] : []

  const ours = {
    matcher: '*',
    hooks: [
      {
        type: 'command',
        command: captureCommand(options),
        // Seconds. Writing one small file; a hook that hung here would hold up
        // the start of every agent session on this machine.
        timeout: 10,
      },
    ],
  }

  const index = sessionStart.findIndex(isOurs)
  if (index === -1) sessionStart.push(ours)
  else sessionStart[index] = ours

  settings.hooks = { ...hooks, SessionStart: sessionStart }

  await fs.mkdir(path.dirname(userSettingsPath()), { recursive: true })
  await fs.writeFile(userSettingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}
