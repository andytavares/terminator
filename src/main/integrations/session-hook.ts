import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { contextFilePath } from './agent-context.js'

// How an agent session comes to already know the issue.
//
// A SessionStart hook, registered in the project's own
// `.claude/settings.local.json`, runs a script that prints the context file's
// markdown as `additionalContext`. That file is documented as the
// highest-precedence settings file and is gitignored by convention, and hooks
// from every level merge rather than replace.
//
// It is a hook rather than `claude --settings` at launch because FR-020
// requires a session the operator starts *by hand*, in an ordinary shell, to
// get the same context — and a launch flag only ever covers sessions this
// application starts.

/**
 * The script the runtime executes.
 *
 * Carried as source and written to disk at startup rather than shipped as a
 * loose asset — the bundler emits one file per entry point, and a stray script
 * beside it survives development and vanishes from the packaged app. The same
 * reasoning, and the same shape, as the supervised-run hook in ADR-026.
 *
 * Its whole authority is: read one file, print, exit 0. No credential, no
 * network, no knowledge of trackers.
 */
export const HOOK_SCRIPT = `// Written by Terminator. Do not edit: it is overwritten on every start.
const fs = require('fs')

const [contextFile] = process.argv.slice(2)

// Anything at all wrong — no file, unreadable, malformed — exits quietly. A
// session with no issue context is a session; a session that will not start is
// a regression.
try {
  const raw = fs.readFileSync(contextFile, 'utf8')
  const context = JSON.parse(raw)
  if (context && typeof context.markdown === 'string' && context.markdown.length > 0) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          // Required. Without it the runtime ignores the whole object, and it
          // does so silently — see ADR-026.
          hookEventName: 'SessionStart',
          additionalContext: context.markdown,
          sessionTitle: typeof context.key === 'string' ? context.key : undefined,
        },
      })
    )
  }
} catch {
  // Intentionally silent.
}

process.exit(0)
`

const SCRIPT_NAME = 'session-start-hook.cjs'

/** Write the hook script and return its absolute path. */
export async function installHookScript(directory: string): Promise<string> {
  await fs.mkdir(directory, { recursive: true })
  const target = path.join(directory, SCRIPT_NAME)
  await fs.writeFile(target, HOOK_SCRIPT, 'utf8')
  return target
}

// ── The owned block in the project's settings ────────────────────────────────

interface SettingsFile {
  hooks?: { SessionStart?: unknown[] } & Record<string, unknown>
  [key: string]: unknown
}

interface HookEntry {
  matcher?: string
  hooks?: Array<{ type?: string; command?: string; timeout?: number }>
}

export interface HookCommandOptions {
  /** Electron's own binary, run in node mode. */
  execPath: string
  hookScriptPath: string
  projectId: string
}

/**
 * The command line the runtime executes.
 *
 * `ELECTRON_RUN_AS_NODE=1` with the application's own binary, so the hook needs
 * neither a `node` on `PATH` nor whatever a login shell happened to export.
 * Without it, the script would launch a second copy of the application.
 */
export function hookCommand(options: HookCommandOptions): string {
  return [
    'ELECTRON_RUN_AS_NODE=1',
    quote(options.execPath),
    quote(options.hookScriptPath),
    quote(contextFilePath(options.projectId)),
  ].join(' ')
}

/** Single-quoted for a POSIX shell, which is what runs this. */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function settingsPath(projectDir: string): string {
  return path.join(projectDir, '.claude', 'settings.local.json')
}

/** Ours, and identifiable — so unlinking can remove exactly it and nothing else. */
function isOurs(entry: unknown, hookScriptPath: string): boolean {
  const hooks = (entry as HookEntry | null)?.hooks
  if (!Array.isArray(hooks)) return false
  return hooks.some((h) => typeof h?.command === 'string' && h.command.includes(hookScriptPath))
}

async function readSettings(projectDir: string): Promise<SettingsFile | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(settingsPath(projectDir), 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as SettingsFile) : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    // Malformed is not missing: overwriting settings we cannot parse would
    // destroy whatever the operator put there.
    throw new Error(`Could not read ${settingsPath(projectDir)}: ${String(error)}`)
  }
}

/**
 * Register the hook in a project's settings.
 *
 * Merge, never replace: an existing `SessionStart` array keeps every entry it
 * had, and `.claude/settings.json` — the shared, checked-in one — is never
 * read or written. Idempotent, so re-linking does not stack up copies.
 */
export async function installProjectHook(
  projectDir: string,
  options: HookCommandOptions
): Promise<void> {
  const existing = await readSettings(projectDir)
  const settings: SettingsFile = existing ?? {}
  const hooks = (settings.hooks ?? {}) as NonNullable<SettingsFile['hooks']>
  const sessionStart = Array.isArray(hooks.SessionStart) ? [...hooks.SessionStart] : []

  const ours = {
    matcher: '*',
    hooks: [
      {
        type: 'command',
        command: hookCommand(options),
        // Seconds. Reading one small file; a hook that hung here would hold up
        // every session start in the project.
        timeout: 10,
      },
    ],
  }

  const index = sessionStart.findIndex((entry) => isOurs(entry, options.hookScriptPath))
  if (index === -1) sessionStart.push(ours)
  else sessionStart[index] = ours

  settings.hooks = { ...hooks, SessionStart: sessionStart }

  await fs.mkdir(path.join(projectDir, '.claude'), { recursive: true })
  await fs.writeFile(settingsPath(projectDir), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

/**
 * Remove it again, leaving the file as it was.
 *
 * If ours was the only thing in it, the file goes; if we created the `.claude`
 * directory for it, that goes too. SC-010 is "the project directory is
 * unchanged after detachment", and a leftover empty file fails that.
 */
export async function removeProjectHook(projectDir: string, hookScriptPath: string): Promise<void> {
  const settings = await readSettings(projectDir).catch(() => null)
  if (settings === null) return

  const hooks = settings.hooks
  const sessionStart = Array.isArray(hooks?.SessionStart) ? hooks.SessionStart : []
  const remaining = sessionStart.filter((entry) => !isOurs(entry, hookScriptPath))
  if (remaining.length === sessionStart.length && sessionStart.length > 0) return

  const nextHooks: Record<string, unknown> = { ...hooks }
  if (remaining.length > 0) nextHooks.SessionStart = remaining
  else delete nextHooks.SessionStart

  const next: SettingsFile = { ...settings }
  if (Object.keys(nextHooks).length > 0) next.hooks = nextHooks as SettingsFile['hooks']
  else delete next.hooks

  if (Object.keys(next).length === 0) {
    await fs.rm(settingsPath(projectDir), { force: true })
    // Only if it is now empty — an operator's own .claude contents stay.
    await fs.rmdir(path.join(projectDir, '.claude')).catch(() => {})
    return
  }
  await fs.writeFile(settingsPath(projectDir), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}
