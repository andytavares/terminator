import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ExtensionAPI } from '../types/api'

/** Writes `value` as indented JSON so that a reader sees the old file or the new one, never half
 * of it: a temporary file beside the target, then a rename. The temporary name is unique, so
 * concurrent writers do not share it. */
export async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
  await rename(temporary, target)
}

/** A path an extension kept in the shared userData folder, and where it belongs now. */
export interface UserDataMove {
  /** Relative to userData, the folder `paths.globalStorage` is `extensions/<id>` inside. */
  from: string
  /** Relative to `paths.globalStorage`. */
  to: string
}

export type UserDataMoveOutcome = 'moved' | 'nothing-to-move' | 'kept-both'

/** Moves what an extension wrote to the shared userData folder into its own `paths.globalStorage`,
 * a path only while its new location does not exist (both exist: neither moves, the log names the
 * old copy). A synchronous rename, for the top of `activate` before anything opens either path. */
export function moveFromUserData(
  api: Pick<ExtensionAPI, 'paths'> & { log: Pick<ExtensionAPI['log'], 'warn'> },
  moves: readonly UserDataMove[]
): UserDataMoveOutcome[] {
  const { globalStorage } = api.paths
  const userData = dirname(dirname(globalStorage))
  return moves.map(({ from, to }) => {
    const legacy = join(userData, from)
    const outcome = movePath(legacy, join(globalStorage, to))
    if (outcome === 'kept-both') {
      api.log.warn(`Left ${legacy} where it was: ${join(globalStorage, to)} already exists.`)
    }
    return outcome
  })
}

function movePath(legacy: string, target: string): UserDataMoveOutcome {
  if (!existsSync(legacy)) return 'nothing-to-move'
  if (existsSync(target)) return 'kept-both'
  mkdirSync(dirname(target), { recursive: true })
  renameSync(legacy, target)
  return 'moved'
}

/** `value` single-quoted for a POSIX shell, so it reads as one word whatever it holds. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** A parent Claude session's variables make a child `claude` join its bridge and hang. */
export function envWithoutParentClaude(env: NodeJS.ProcessEnv): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || name === 'CLAUDECODE' || name.startsWith('CLAUDE_CODE_')) continue
    kept[name] = value
  }
  return kept
}
