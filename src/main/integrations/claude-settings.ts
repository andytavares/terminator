import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// The one editor for a SessionStart hook this application owns in a Claude
// settings file. Merge, never replace: every other key and every other entry
// survives, and installing again replaces our own entry instead of stacking it.

export interface ClaudeSettingsFile {
  hooks?: { SessionStart?: unknown[] } & Record<string, unknown>
  [key: string]: unknown
}

interface HookEntry {
  hooks?: Array<{ command?: string }>
}

/** Single-quoted for a POSIX shell, which is what runs a hook command. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** True when the entry runs a command containing `marker`. */
export function runsCommandContaining(entry: unknown, marker: string): boolean {
  const hooks = (entry as HookEntry | null)?.hooks
  if (!Array.isArray(hooks)) return false
  return hooks.some((h) => typeof h?.command === 'string' && h.command.includes(marker))
}

/** Null when the file does not exist; throws when it exists and cannot be parsed. */
export async function readClaudeSettings(file: string): Promise<ClaudeSettingsFile | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as ClaudeSettingsFile) : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    // Malformed is not missing: overwriting settings we cannot parse would
    // destroy whatever the operator put there.
    throw new Error(`Could not read ${file}: ${String(error)}`, { cause: error })
  }
}

export async function writeClaudeSettings(
  file: string,
  settings: ClaudeSettingsFile
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

/**
 * Every SessionStart entry `marker` identifies goes, then one comes back with
 * `command`. The timeout is in seconds; a hook that hung would hold up every
 * session start it covers.
 */
export async function putSessionStartHook(
  file: string,
  marker: string,
  command: string
): Promise<void> {
  const settings = (await readClaudeSettings(file)) ?? {}
  const hooks = settings.hooks ?? {}
  const sessionStart = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : []
  const theirs = sessionStart.filter((entry) => !runsCommandContaining(entry, marker))
  const ours = { matcher: '*', hooks: [{ type: 'command', command, timeout: 10 }] }
  settings.hooks = { ...hooks, SessionStart: [...theirs, ours] }
  await writeClaudeSettings(file, settings)
}
