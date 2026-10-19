import { z } from 'zod'
import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { registerInvokeTable } from './invoke-table.js'
import {
  isGitRepo,
  getGitRoot,
  getCurrentBranch,
  listBranches,
  fetchRemotes,
  checkoutBranch,
  createBranch,
  suggestWorktreePath,
  createWorktree,
  removeWorktree,
  listWorktrees,
  getChangeStats,
} from '../git/git-service.js'
import { excludeBranches } from '../git/branch-exclude.js'
import { branchExcludePatternsFor } from '../git/branch-exclude-settings.js'

const PathSchema = z.object({ path: z.string().min(1) })

const PathAndBranchSchema = z.object({ path: z.string().min(1), branch: z.string().min(1) })

const repositoryChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'git:is-repo',
    schema: PathSchema,
    invalid: { isRepo: false },
    run: async ({ path }) => {
      const isRepo = await isGitRepo(path)
      if (!isRepo) return { isRepo: false }
      return { isRepo: true, root: await getGitRoot(path) }
    },
    onError: (e) => ({ error: String(e) }),
  }),
  defineChannel({
    channel: 'git:change-stats',
    schema: PathSchema,
    invalid: { error: 'VALIDATION_ERROR' },
    run: async ({ path }) => await getChangeStats(path),
    onError: (e) => ({ error: String(e) }),
  }),
]

const branchChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'git:current-branch',
    schema: PathSchema,
    invalid: { error: 'INVALID_PATH' },
    run: async ({ path }) => ({ branch: await getCurrentBranch(path) }),
    onError: (e) => ({ error: String(e) }),
  }),
  defineChannel({
    channel: 'git:list-branches',
    schema: PathSchema,
    invalid: { branches: [] },
    run: async ({ path }) => ({
      branches: excludeBranches(await listBranches(path), branchExcludePatternsFor(path)),
    }),
    onError: () => ({ branches: [] }),
  }),
  defineChannel({
    channel: 'git:fetch',
    schema: PathSchema,
    invalid: { error: 'VALIDATION_ERROR' },
    run: async ({ path }) => {
      await fetchRemotes(path)
      return { success: true }
    },
    onError: (e) => ({ error: String(e) }),
  }),
  defineChannel({
    channel: 'git:checkout',
    schema: PathAndBranchSchema,
    invalid: { error: 'VALIDATION_ERROR' },
    run: async ({ path, branch }) => {
      await checkoutBranch(path, branch)
      return { success: true }
    },
    onError: (e) => ({ error: String(e) }),
  }),
  defineChannel({
    channel: 'git:create-branch',
    schema: PathAndBranchSchema,
    invalid: { error: 'VALIDATION_ERROR' },
    run: async ({ path, branch }) => {
      await createBranch(path, branch)
      return { success: true }
    },
    onError: (e) => ({ error: String(e) }),
  }),
]

const worktreeChannels: ChannelSpec[] = [
  defineChannel({
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
  defineChannel({
    channel: 'git:create-worktree',
    schema: z.object({
      repoRoot: z.string().min(1),
      worktreePath: z.string().min(1),
      branch: z.string().min(1),
      isNewBranch: z.boolean(),
    }),
    invalid: { error: 'VALIDATION_ERROR' },
    run: async (request) => {
      await createWorktree(request)
      return { success: true }
    },
    onError: (e) => ({ error: String(e) }),
  }),
  defineChannel({
    channel: 'git:remove-worktree',
    schema: z.object({ repoRoot: z.string().min(1), worktreePath: z.string().min(1) }),
    invalid: { error: 'VALIDATION_ERROR' },
    run: async ({ repoRoot, worktreePath }) => {
      await removeWorktree(repoRoot, worktreePath)
      return { success: true }
    },
    onError: (e) => ({ error: String(e) }),
  }),
  defineChannel({
    channel: 'git:list-worktrees',
    schema: PathSchema,
    invalid: { worktrees: [] },
    run: async ({ path }) => ({ worktrees: await listWorktrees(path) }),
    onError: () => ({ worktrees: [] }),
  }),
]

export function registerGitHandlers(): void {
  registerInvokeTable([...repositoryChannels, ...branchChannels, ...worktreeChannels])
}
// git:status, git:diff-file, git:stage, git:unstage, git:commit, git:pr-status, git:pr-create
// are registered by the git-integration extension via api.ipc.registerHandler()
