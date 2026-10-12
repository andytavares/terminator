import { randomUUID } from 'node:crypto'
import { rename, writeFile } from 'node:fs/promises'

/**
 * Writes `value` as indented JSON so that a reader sees the old file or the
 * new one, never half of it: a temporary file beside the target, then a
 * rename. The temporary name is unique, so concurrent writers do not share it.
 */
export async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
  await rename(temporary, target)
}
