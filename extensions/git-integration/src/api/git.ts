// Bridge module — extension components call extension-owned git IPC channels
// through extensionBridge, never via window.electronAPI.git directly.

import { invoke } from '@terminator/extension-sdk/renderer'
import type { LocalInventoryRow } from '../git/local-inventory'
import type { RemoveItem, RemoveResult } from '../git/remove-local'

export type CommitResult =
  | { commitHash: string }
  | { error: string; hookOutput?: string; isHookFailure?: boolean }

const bridge = () => window.electronAPI.extensionBridge

export const gitAPI = {
  status: (path: string) => bridge().invoke('git:status', { path }),

  /** The directories to watch for changes to `repoRoot`'s status. */
  watchRoots: (repoRoot: string) =>
    invoke<{ roots: string[] } | { error: string }>('git:watch-roots', { repoRoot }),

  diffFile: (payload: { repoRoot: string; path: string; staged: boolean; isUntracked?: boolean }) =>
    bridge().invoke('git:diff-file', payload),

  stage: (repoRoot: string, paths: string[]) => bridge().invoke('git:stage', { repoRoot, paths }),

  unstage: (repoRoot: string, paths: string[]) =>
    bridge().invoke('git:unstage', { repoRoot, paths }),

  commit: (payload: { repoRoot: string; message: string; noVerify?: boolean }) =>
    invoke<CommitResult>('git:commit', payload),

  commitOutputPoll: (repoRoot: string) => bridge().invoke('git:commit-output-poll', { repoRoot }),

  prStatus: (repoRoot: string) => bridge().invoke('git:pr-status', { repoRoot }),

  push: (repoRoot: string) => bridge().invoke('git:push', { repoRoot }),

  /** The Worktrees tab's rows: every local branch and worktree of `repoRoot`. */
  localInventory: (repoRoot: string) =>
    invoke<{ rows: LocalInventoryRow[] }>('git:local-inventory', { repoRoot }),

  /** Removes the worktrees and branches the Worktrees tab has checked. */
  removeLocal: (repoRoot: string, items: RemoveItem[]) =>
    invoke<{ results: RemoveResult[] }>('git:remove-local', { repoRoot, items }),
}
