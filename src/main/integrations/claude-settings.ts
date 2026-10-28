import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

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

/** True when the entry runs a command containing `marker`. */
export function runsCommandContaining(entry: unknown, marker: string | string[]): boolean {
  const markers = Array.isArray(marker) ? marker : [marker]
  const hooks = (entry as HookEntry | null)?.hooks
  if (!Array.isArray(hooks)) return false
  return hooks.some(
    (h) => typeof h?.command === 'string' && markers.some((m) => h.command?.includes(m))
  )
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

/** Writes the whole file, then renames it into place: another process writing the same file
 * (a second Terminator, Claude Code) leaves one whole copy, never a short one over a long one. */
export async function writeClaudeSettings(
  file: string,
  settings: ClaudeSettingsFile
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const draft = `${file}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(draft, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  await fs.rename(draft, file)
}

/** Every `event` entry `marker` identifies goes, then one comes back with `command`. The
 * timeout is in seconds; a hook that hung would hold up every session it covers. */
export async function putHook(
  file: string,
  event: string,
  ours: { marker: string | string[]; command: string }
): Promise<void> {
  const settings = (await readClaudeSettings(file)) ?? {}
  const hooks = settings.hooks ?? {}
  const current = hooks[event]
  const theirs = (Array.isArray(current) ? current : []).filter(
    (entry) => !runsCommandContaining(entry, ours.marker)
  )
  const entry = { matcher: '*', hooks: [{ type: 'command', command: ours.command, timeout: 10 }] }
  settings.hooks = { ...hooks, [event]: [...theirs, entry] }
  await writeClaudeSettings(file, settings)
}

/** Every SessionStart entry `marker` identifies goes, then one comes back with `command`. */
export function putSessionStartHook(
  file: string,
  marker: string | string[],
  command: string
): Promise<void> {
  return putHook(file, 'SessionStart', { marker, command })
}
