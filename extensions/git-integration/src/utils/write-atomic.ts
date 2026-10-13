import { randomUUID } from 'crypto'
import { chmod, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'

/**
 * Replaces `path` with `content` in one step: written to a temporary file in
 * the same directory, then renamed over it, which replaces the target
 * atomically on one file system (https://nodejs.org/api/fs.html#fspromisesrenameoldpath-newpath,
 * rename(2)). A reader sees the old file or the new one, never a truncated
 * one. The file keeps its mode.
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const { mode } = await stat(path)
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, content, 'utf-8')
    await chmod(temporary, mode)
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}
