import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// This spec file's directories, which tests/setup.ts removes after the file's own hooks.
// Each spec file has its own copy of this module, so it never removes another's.
const made: string[] = []

/** A new directory `<os temp dir>/<prefix>XXXXXX`, removed after the spec file ends. */
export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}

/** Removes every directory makeTempDir made. The retries cover a child process
 * (git maintenance, a supervised agent) still writing as the file ends:
 * rmSync retries on ENOTEMPTY and EBUSY (https://nodejs.org/api/fs.html#fsrmsyncpath-options). */
export function removeTempDirs(): void {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
