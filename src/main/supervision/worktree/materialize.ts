import { copyFileSync, existsSync, mkdirSync, symlinkSync, statSync } from 'fs'
import { dirname, join } from 'path'

// Making a freshly created worktree usable: share the heavy ignored
// directories from the primary checkout (FR-031) and copy the declared files
// (FR-032).
//
// Sharing is symlinked rather than copied — it is the one published fix for the
// category's top complaint, and copying `node_modules` per worktree is what
// makes these tools unusable on a real repository.
//
// Every skip is recorded rather than swallowed. If linking produces a broken
// environment the setup command fails and the session surfaces as `failed` with
// its output attached (FR-034), which is the honest failure mode.

export interface MaterializeResult {
  readonly linked: string[]
  readonly copied: string[]
  /** Declared but absent in the primary checkout, or otherwise not applied. */
  readonly skipped: Array<{ path: string; reason: string }>
}

export interface MaterializeOptions {
  primaryPath: string
  worktreePath: string
  symlink: readonly string[]
  copy: readonly string[]
}

export function materializeWorktree(options: MaterializeOptions): MaterializeResult {
  const { primaryPath, worktreePath, symlink, copy } = options
  const linked: string[] = []
  const copied: string[] = []
  const skipped: Array<{ path: string; reason: string }> = []

  for (const relative of symlink) {
    const source = join(primaryPath, relative)
    const target = join(worktreePath, relative)

    if (!existsSync(source)) {
      // Declared but not present — usually means the primary checkout has not
      // been installed yet. Not fatal, but the operator should know why the
      // worktree is thinner than expected.
      skipped.push({ path: relative, reason: 'not present in the primary checkout' })
      continue
    }
    if (existsSync(target)) {
      skipped.push({ path: relative, reason: 'already exists in the worktree' })
      continue
    }

    try {
      mkdirSync(dirname(target), { recursive: true })
      symlinkSync(source, target, statSync(source).isDirectory() ? 'dir' : 'file')
      linked.push(relative)
    } catch (error) {
      skipped.push({
        path: relative,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const relative of copy) {
    const source = join(primaryPath, relative)
    const target = join(worktreePath, relative)

    if (!existsSync(source)) {
      skipped.push({ path: relative, reason: 'not present in the primary checkout' })
      continue
    }

    try {
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source, target)
      copied.push(relative)
    } catch (error) {
      skipped.push({
        path: relative,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { linked, copied, skipped }
}
