import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  isGitRepo,
  getGitRoot,
  getCurrentBranch,
  listBranches,
  checkoutBranch,
  createBranch,
  suggestWorktreePath,
  createWorktree,
  removeWorktree,
  listWorktrees,
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

  ipcMain.handle('git:create-branch', async (_event, payload) => {
    const schema = z.object({ path: z.string().min(1), branch: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      await createBranch(parsed.data.path, parsed.data.branch)
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
    return {
      path: suggestWorktreePath(parsed.data.repoRoot, parsed.data.branch, parsed.data.baseDir),
    }
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
}
// git:status, git:diff-file, git:stage, git:unstage, git:commit, git:pr-status, git:pr-create
// are registered by the git-integration extension via api.ipc.registerHandler()
