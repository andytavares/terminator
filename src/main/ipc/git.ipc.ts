import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  isGitRepo,
  getGitRoot,
  getCurrentBranch,
  listBranches,
  checkoutBranch,
  suggestWorktreePath,
  createWorktree,
  removeWorktree,
  listWorktrees,
  getStatus,
  getDiff,
  stageFiles,
  unstageFiles,
  commitChanges,
} from '../git/git-service.js'

const PathSchema = z.object({ path: z.string().min(1) })

export function registerGitHandlers(): void {
  ipcMain.handle('git:is-repo', async (_event, payload) => {
    const parsed = PathSchema.safeParse(payload)
    if (!parsed.success) return { isRepo: false }
    try {
      const isRepo = await isGitRepo(parsed.data.path)
      if (!isRepo) return { isRepo: false }
      const root = await getGitRoot(parsed.data.path)
      return { isRepo: true, root }
    } catch {
      return { isRepo: false }
    }
  })

  ipcMain.handle('git:current-branch', async (_event, payload) => {
    const parsed = PathSchema.safeParse(payload)
    if (!parsed.success) return { error: 'INVALID_PATH' }
    try {
      const branch = await getCurrentBranch(parsed.data.path)
      return { branch }
    } catch (e) {
      return { error: String(e) }
    }
  })

  ipcMain.handle('git:list-branches', async (_event, payload) => {
    const parsed = PathSchema.safeParse(payload)
    if (!parsed.success) return { branches: [] }
    try {
      const branches = await listBranches(parsed.data.path)
      return { branches }
    } catch {
      return { branches: [] }
    }
  })

  ipcMain.handle('git:checkout', async (_event, payload) => {
    const schema = z.object({ path: z.string().min(1), branch: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      await checkoutBranch(parsed.data.path, parsed.data.branch)
      return { success: true }
    } catch (e) {
      return { error: String(e) }
    }
  })

  ipcMain.handle('git:suggest-worktree-path', async (_event, payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      branch: z.string().min(1),
      baseDir: z.string().optional(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { path: '' }
    return { path: suggestWorktreePath(parsed.data.repoRoot, parsed.data.branch, parsed.data.baseDir) }
  })

  ipcMain.handle('git:create-worktree', async (_event, payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      worktreePath: z.string().min(1),
      branch: z.string().min(1),
      isNewBranch: z.boolean(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      await createWorktree(
        parsed.data.repoRoot,
        parsed.data.worktreePath,
        parsed.data.branch,
        parsed.data.isNewBranch
      )
      return { success: true }
    } catch (e) {
      return { error: String(e) }
    }
  })

  ipcMain.handle('git:remove-worktree', async (_event, payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), worktreePath: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      await removeWorktree(parsed.data.repoRoot, parsed.data.worktreePath)
      return { success: true }
    } catch (e) {
      return { error: String(e) }
    }
  })

  ipcMain.handle('git:list-worktrees', async (_event, payload) => {
    const parsed = PathSchema.safeParse(payload)
    if (!parsed.success) return { worktrees: [] }
    try {
      const worktrees = await listWorktrees(parsed.data.path)
      return { worktrees }
    } catch {
      return { worktrees: [] }
    }
  })

  // v1.1.0 git integration handlers

  ipcMain.handle('git:status', async (_event, payload) => {
    const schema = z.object({ path: z.string().min(1), maxFiles: z.number().int().positive().optional() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const status = await getStatus(parsed.data.path, parsed.data.maxFiles ?? 500)
      return status
    } catch (e) {
      return { error: String(e) }
    }
  })

  ipcMain.handle('git:diff-file', async (_event, payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      path: z.string().min(1),
      staged: z.boolean(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const diff = await getDiff(parsed.data.repoRoot, parsed.data.path, parsed.data.staged)
      return { diff }
    } catch (e) {
      return { error: String(e) }
    }
  })

  ipcMain.handle('git:stage', async (_event, payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), paths: z.array(z.string()).min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      await stageFiles(parsed.data.repoRoot, parsed.data.paths)
      return { success: true }
    } catch (e) {
      return { error: String(e) }
    }
  })

  ipcMain.handle('git:unstage', async (_event, payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), paths: z.array(z.string()).min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      await unstageFiles(parsed.data.repoRoot, parsed.data.paths)
      return { success: true }
    } catch (e) {
      return { error: String(e) }
    }
  })

  ipcMain.handle('git:commit', async (_event, payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      message: z.string(),
      signOff: z.boolean().optional(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    if (!parsed.data.message.trim()) return { error: 'EMPTY_MESSAGE' }
    try {
      const commitHash = await commitChanges(
        parsed.data.repoRoot,
        parsed.data.message,
        parsed.data.signOff ?? false
      )
      return { commitHash }
    } catch (e) {
      const msg = String(e)
      if (msg.includes('nothing to commit')) return { error: 'NOTHING_TO_COMMIT' }
      return { error: msg }
    }
  })

  ipcMain.handle('git:pr-status', async (_event, payload) => {
    const schema = z.object({ repoRoot: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    // Delegated to gh-service via shell:exec in extension; main process returns stub
    return { pr: null }
  })

  ipcMain.handle('git:pr-create', async (_event, payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      title: z.string().min(1),
      body: z.string(),
      base: z.string().min(1),
      isDraft: z.boolean().optional(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    // Delegated to extension via api.shell.exec
    return { error: 'NOT_IMPLEMENTED' }
  })
}
