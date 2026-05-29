import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'

const execAsync = promisify(execFile)

export async function getStatus(
  workspaceRoot: string
): Promise<{ isDirty: boolean; modifiedFiles: string[] } | { error: string }> {
  try {
    const { stdout } = await execAsync('git', ['status', '--porcelain'], { cwd: workspaceRoot })
    const lines = stdout.split('\n').filter((l) => l.trim())
    const files = lines.map((l) => l.slice(3).trim()).filter(Boolean)
    return { isDirty: files.length > 0, modifiedFiles: files }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function createCheckpoint(
  workspaceRoot: string,
  runId: string
): Promise<{ commitHash: string } | { error: string }> {
  try {
    await execAsync('git', ['add', '-A'], { cwd: workspaceRoot })
    const { stdout } = await execAsync(
      'git',
      ['commit', '--allow-empty', '-m', `foundry: checkpoint before run ${runId}`],
      { cwd: workspaceRoot }
    )
    const match = stdout.match(/\[[\w/]+ ([0-9a-f]+)\]/)
    return { commitHash: match ? match[1] : 'unknown' }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function stashChanges(
  workspaceRoot: string
): Promise<{ ok: true } | { error: string }> {
  try {
    await execAsync('git', ['stash'], { cwd: workspaceRoot })
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function revertFiles(
  workspaceRoot: string,
  filePaths: string[]
): Promise<{ ok: true; reverted: string[] } | { error: string }> {
  if (filePaths.length === 0) return { ok: true, reverted: [] }
  try {
    await execAsync('git', ['checkout', '--', ...filePaths], { cwd: workspaceRoot })
    return { ok: true, reverted: filePaths }
  } catch (err) {
    return { error: String(err) }
  }
}

// ─── Worktree management ──────────────────────────────────────────────────────

export async function mergeWorktreeBranch(
  workspaceRoot: string,
  branch: string
): Promise<{ ok: true } | { error: string }> {
  try {
    await execAsync('git', ['merge', '--ff-only', branch], { cwd: workspaceRoot })
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

async function symlinkIfAbsent(src: string, dest: string): Promise<void> {
  try {
    await fs.access(dest)
  } catch {
    try {
      await fs.symlink(src, dest)
    } catch {
      /* src may not exist */
    }
  }
}

async function ensureGitignoreEntry(workspaceRoot: string, entry: string): Promise<void> {
  const gitignorePath = path.join(workspaceRoot, '.gitignore')
  try {
    const existing = await fs.readFile(gitignorePath, 'utf-8').catch(() => '')
    const lines = existing.split('\n')
    if (!lines.some((l) => l.trim() === entry)) {
      const suffix = existing.endsWith('\n') || existing === '' ? '' : '\n'
      await fs.appendFile(gitignorePath, `${suffix}${entry}\n`, 'utf-8')
    }
  } catch {
    // non-fatal if .gitignore is unwritable
  }
}

async function resolveUniqueWorktreePath(base: string): Promise<string> {
  try {
    await fs.access(base)
    // Exists — find the next available suffix
    for (let i = 2; i <= 99; i++) {
      const candidate = `${base}-${i}`
      try {
        await fs.access(candidate)
      } catch {
        return candidate
      }
    }
    return `${base}-${Date.now()}`
  } catch {
    return base
  }
}

export async function createWorktree(
  workspaceRoot: string,
  runId: string,
  label?: string
): Promise<{ worktreePath: string; branch: string; label: string } | { error: string }> {
  try {
    const slug = label?.trim() || `run-${runId.slice(0, 8)}`
    const worktreesDir = path.join(workspaceRoot, '.worktrees')
    await fs.mkdir(worktreesDir, { recursive: true })

    // Ensure .worktrees/ is gitignored so it doesn't pollute `git status`
    await ensureGitignoreEntry(workspaceRoot, '.worktrees/')

    const basePath = path.join(worktreesDir, slug)
    const worktreePath = await resolveUniqueWorktreePath(basePath)
    const resolvedSlug = path.basename(worktreePath)
    const branch = `foundry/${resolvedSlug}`

    await execAsync('git', ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], {
      cwd: workspaceRoot,
    })

    // Symlink node_modules so npm scripts (lint, test, format) work without reinstalling
    await symlinkIfAbsent(
      path.join(workspaceRoot, 'node_modules'),
      path.join(worktreePath, 'node_modules')
    )
    // Symlink extension-level node_modules (npm workspace packages)
    try {
      const extEntries = await fs.readdir(path.join(workspaceRoot, 'extensions'), {
        withFileTypes: true,
      })
      for (const entry of extEntries) {
        if (!entry.isDirectory()) continue
        await symlinkIfAbsent(
          path.join(workspaceRoot, 'extensions', entry.name, 'node_modules'),
          path.join(worktreePath, 'extensions', entry.name, 'node_modules')
        )
      }
    } catch {
      /* extensions dir may not exist in all projects */
    }

    return { worktreePath, branch, label: resolvedSlug }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function removeWorktree(
  workspaceRoot: string,
  worktreePath: string,
  branch: string
): Promise<{ ok: true } | { error: string }> {
  try {
    await execAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: workspaceRoot })
    await execAsync('git', ['branch', '-D', branch], { cwd: workspaceRoot })
    return { ok: true }
  } catch (err) {
    // Best-effort cleanup — don't fail the run over this
    try {
      await fs.rm(worktreePath, { recursive: true, force: true })
    } catch {
      /* ignored */
    }
    return { error: String(err) }
  }
}

export async function getDiffForFile(
  workspaceRoot: string,
  filePath: string
): Promise<{ unifiedDiff: string; linesAdded: number; linesRemoved: number } | { error: string }> {
  try {
    // Make path relative to the git root so `git diff HEAD` resolves it correctly
    const relative =
      path.isAbsolute(filePath) && filePath.startsWith(workspaceRoot)
        ? filePath.slice(workspaceRoot.length).replace(/^[\\/]/, '')
        : filePath
    const { stdout } = await execAsync('git', ['diff', 'HEAD', '--', relative], {
      cwd: workspaceRoot,
    })
    if (!stdout.trim()) return { unifiedDiff: '', linesAdded: 0, linesRemoved: 0 }
    let added = 0
    let removed = 0
    for (const line of stdout.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++
      if (line.startsWith('-') && !line.startsWith('---')) removed++
    }
    return { unifiedDiff: stdout, linesAdded: added, linesRemoved: removed }
  } catch (err) {
    return { error: String(err) }
  }
}
