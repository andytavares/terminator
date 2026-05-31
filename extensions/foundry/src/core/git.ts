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

export async function getDefaultBranch(workspaceRoot: string): Promise<string> {
  // Try to find the default branch from the remote
  try {
    const { stdout } = await execAsync(
      'git',
      ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
      { cwd: workspaceRoot }
    )
    return stdout.trim().replace(/^origin\//, '') || 'main'
  } catch {
    // No remote HEAD — fall back to common names
    for (const name of ['main', 'master']) {
      try {
        await execAsync('git', ['rev-parse', '--verify', name], { cwd: workspaceRoot })
        return name
      } catch {
        // try next
      }
    }
    return 'main'
  }
}

export async function getRemoteUrl(workspaceRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: workspaceRoot,
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

export async function commitWorktreeChanges(
  worktreePath: string,
  message: string
): Promise<{ ok: true; commitHash: string } | { error: string }> {
  try {
    await execAsync('git', ['add', '-A'], { cwd: worktreePath })
    const { stdout } = await execAsync('git', ['commit', '-m', message], { cwd: worktreePath })
    const match = stdout.match(/\[[\w/]+ ([0-9a-f]+)\]/)
    return { ok: true, commitHash: match ? match[1] : 'unknown' }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function pushBranch(
  workspaceRoot: string,
  branch: string
): Promise<{ ok: true } | { error: string }> {
  try {
    await execAsync('git', ['push', '-u', 'origin', branch], { cwd: workspaceRoot })
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

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

async function _resolveUniqueWorktreePath(base: string): Promise<string> {
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

    // Abort early if the repo has no commits — HEAD is invalid and worktrees require a commit
    try {
      await execAsync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot })
    } catch {
      return { error: 'Repository has no commits — make an initial commit before using worktrees' }
    }

    const basePath = path.join(worktreesDir, slug)

    // Find a slug/branch pair where neither the path nor the branch already exists
    let worktreePath = basePath
    let resolvedSlug = slug
    let branch = `foundry/${slug}`
    for (let i = 2; i <= 99; i++) {
      const pathFree = await fs
        .access(worktreePath)
        .then(() => false)
        .catch(() => true)
      const branchResult = await execAsync('git', ['branch', '--list', branch], {
        cwd: workspaceRoot,
      }).catch(() => ({ stdout: '' }))
      const branchFree = !branchResult.stdout.trim()
      if (pathFree && branchFree) break
      worktreePath = `${basePath}-${i}`
      resolvedSlug = `${slug}-${i}`
      branch = `foundry/${resolvedSlug}`
    }

    await execAsync('git', ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], {
      cwd: workspaceRoot,
    })

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

export async function listBranches(
  workspaceRoot: string
): Promise<{ branches: Array<{ name: string; current: boolean }> } | { error: string }> {
  try {
    const { stdout } = await execAsync('git', ['branch', '--list'], { cwd: workspaceRoot })
    const lines = stdout.split('\n').filter((l) => l.trim())
    const branches = lines.map((l) => ({
      name: l.replace(/^\*\s*/, '').trim(),
      current: l.startsWith('*'),
    }))
    // Current branch first, then alphabetical
    branches.sort((a, b) => {
      if (a.current) return -1
      if (b.current) return 1
      return a.name.localeCompare(b.name)
    })
    return { branches }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function createWorktreeFromBranch(
  workspaceRoot: string,
  featureBranch: string,
  baseBranch: string
): Promise<{ worktreePath: string; featureBranch: string } | { error: string }> {
  try {
    const worktreesDir = path.join(workspaceRoot, '.worktrees')
    await fs.mkdir(worktreesDir, { recursive: true })
    await ensureGitignoreEntry(workspaceRoot, '.worktrees/')

    try {
      await execAsync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot })
    } catch {
      return { error: 'Repository has no commits — make an initial commit before using worktrees' }
    }

    // Fail fast if branch already exists — no silent suffix
    const branchCheck = await execAsync('git', ['branch', '--list', featureBranch], {
      cwd: workspaceRoot,
    }).catch(() => ({ stdout: '' }))
    if (branchCheck.stdout.trim()) {
      return { error: `Branch "${featureBranch}" already exists — choose a different name` }
    }

    const slug = featureBranch.replace(/\//g, '-')
    const worktreePath = path.join(worktreesDir, slug)

    await execAsync('git', ['worktree', 'add', '-b', featureBranch, worktreePath, baseBranch], {
      cwd: workspaceRoot,
    })

    return { worktreePath, featureBranch }
  } catch (err) {
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
    let diffOut = ''
    let headFailed = false
    try {
      const { stdout } = await execAsync('git', ['diff', 'HEAD', '--', relative], {
        cwd: workspaceRoot,
      })
      diffOut = stdout
    } catch {
      // HEAD may not exist (no commits yet) — fall through to --no-index
      headFailed = true
    }

    // For new/untracked files, git diff HEAD returns nothing; same when there's no HEAD yet.
    // Fall back to --no-index to show the file as all-additions.
    if (!diffOut.trim()) {
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath)
      try {
        const { stdout } = await execAsync(
          'git',
          ['diff', '--no-index', '--', '/dev/null', absPath],
          { cwd: workspaceRoot }
        )
        diffOut = stdout
      } catch (noIndexErr) {
        // git diff --no-index exits 1 when files differ — stdout still has the diff
        const out = (noIndexErr as { stdout?: string }).stdout ?? ''
        if (out.trim()) {
          diffOut = out
        } else if (headFailed) {
          // Both commands failed with no output — genuine error (not a git repo, etc.)
          return { error: String(noIndexErr) }
        }
      }
    }

    if (!diffOut.trim()) return { unifiedDiff: '', linesAdded: 0, linesRemoved: 0 }
    let added = 0
    let removed = 0
    for (const line of diffOut.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++
      if (line.startsWith('-') && !line.startsWith('---')) removed++
    }
    return { unifiedDiff: diffOut, linesAdded: added, linesRemoved: removed }
  } catch (err) {
    return { error: String(err) }
  }
}
