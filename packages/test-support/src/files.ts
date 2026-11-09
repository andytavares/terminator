import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The text of `path`, relative to the module at `base` (its `import.meta.url`). */
export function readBeside(base: string, path: string): string {
  return readFileSync(fileURLToPath(new URL(path, base)), 'utf8')
}
