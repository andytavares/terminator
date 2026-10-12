import * as path from 'node:path'
import { load } from 'js-yaml'

// What reading one hand-authored YAML file shares, whether it is a recipe,
// role, rule (recipe/parse.ts) or sensor (sensors/schema.ts). Nothing here
// throws: a malformed file is reported by path and excluded.

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string }

export function fail(file: string, message: string): { ok: false; reason: string } {
  return { ok: false, reason: `${file}: ${message}` }
}

/** js-yaml's safe schema: it constructs no arbitrary types. */
export function loadYaml(text: string, file: string): ParseResult<unknown> {
  try {
    return { ok: true, value: load(text) }
  } catch (error) {
    return fail(file, `could not be read as YAML — ${(error as Error).message}`)
  }
}

/** A mapping, at a schema version this build knows; the problem otherwise. */
export function checkVersion(
  value: unknown,
  file: string,
  knownVersion: number
): { ok: false; reason: string } | null {
  // Arrays are objects, and a YAML list is a common hand-authoring slip. Say
  // what is wrong with the file rather than letting zod report a type mismatch
  // several levels down.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(file, 'is not a mapping')
  }
  const declared = (value as { schemaVersion?: unknown }).schemaVersion
  if (typeof declared === 'number' && declared > knownVersion) {
    return fail(
      file,
      `declares schema version ${declared}; this build knows version ${knownVersion}`
    )
  }
  return null
}

export function idMatchesFile(id: string, file: string): boolean {
  return id === path.basename(file).replace(/\.ya?ml$/, '')
}
