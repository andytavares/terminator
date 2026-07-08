import { z } from 'zod'
import { registerInvokeTable, invokeSpec } from './invoke-table.js'
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
const PathAndBranchSchema = z.object({ path: z.string().min(1), branch: z.string().min(1) })

export function registerGitHandlers(): void {
  registerInvokeTable([
    invokeSpec({
      channel: 'git:is-repo',
      schema: PathSchema,
      invalid: { isRepo: false },
      run: async ({ path }) => {
        const isRepo = await isGitRepo(path)
        if (!isRepo) return { isRepo: false }
        return { isRepo: true, root: await getGitRoot(path) }
      },
      onError: () => ({ isRepo: false }),
    }),
    invokeSpec({
      channel: 'git:current-branch',
      schema: PathSchema,
      invalid: { error: 'INVALID_PATH' },
      run: async ({ path }) => ({ branch: await getCurrentBranch(path) }),
      onError: (e) => ({ error: String(e) }),
    }),
    invokeSpec({
      channel: 'git:list-branches',
      schema: PathSchema,
      invalid: { branches: [] },
      run: async ({ path }) => ({ branches: await listBranches(path) }),
      onError: () => ({ branches: [] }),
    }),
    invokeSpec({
      channel: 'git:checkout',
      schema: PathAndBranchSchema,
      invalid: { error: 'VALIDATION_ERROR' },
      run: async ({ path, branch }) => {
        await checkoutBranch(path, branch)
        return { success: true }
      },
      onError: (e) => ({ error: String(e) }),
    }),
    invokeSpec({
      channel: 'git:create-branch',
      schema: PathAndBranchSchema,
      invalid: { error: 'VALIDATION_ERROR' },
      run: async ({ path, branch }) => {
        await createBranch(path, branch)
        return { success: true }
      },
      onError: (e) => ({ error: String(e) }),
    }),
    invokeSpec({
      channel: 'git:suggest-worktree-path',
      schema: z.object({
        repoRoot: z.string().min(1),
        branch: z.string().min(1),
        baseDir: z.string().optional(),
      }),
      invalid: { path: '' },
      run: ({ repoRoot, branch, baseDir }) => ({
        path: suggestWorktreePath(repoRoot, branch, baseDir),
      }),
    }),
    invokeSpec({
      channel: 'git:create-worktree',
      schema: z.object({
        repoRoot: z.string().min(1),
        worktreePath: z.string().min(1),
        branch: z.string().min(1),
        isNewBranch: z.boolean(),
      }),
      invalid: { error: 'VALIDATION_ERROR' },
      run: async ({ repoRoot, worktreePath, branch, isNewBranch }) => {
        await createWorktree(repoRoot, worktreePath, branch, isNewBranch)
        return { success: true }
      },
      onError: (e) => ({ error: String(e) }),
    }),
    invokeSpec({
      channel: 'git:remove-worktree',
      schema: z.object({ repoRoot: z.string().min(1), worktreePath: z.string().min(1) }),
      invalid: { error: 'VALIDATION_ERROR' },
      run: async ({ repoRoot, worktreePath }) => {
        await removeWorktree(repoRoot, worktreePath)
        return { success: true }
      },
      onError: (e) => ({ error: String(e) }),
    }),
    invokeSpec({
      channel: 'git:list-worktrees',
      schema: PathSchema,
      invalid: { worktrees: [] },
      run: async ({ path }) => ({ worktrees: await listWorktrees(path) }),
      onError: () => ({ worktrees: [] }),
    }),
  ])
}
// git:status, git:diff-file, git:stage, git:unstage, git:commit, git:pr-status, git:pr-create
// are registered by the git-integration extension via api.ipc.registerHandler()
