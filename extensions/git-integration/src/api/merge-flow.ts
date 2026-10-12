import type { ConflictSession, ResolutionStrategy } from '../schemas/merge-flow.schema'
import { invokeBridge } from './bridge'

export const mergeFlowAPI = {
  listConflicts: (repoRoot: string): Promise<ConflictSession | { error: string }> =>
    invokeBridge('git:conflicts-list', { repoRoot }),

  resolveConflict: (
    repoRoot: string,
    blockId: string,
    resolvedText: string,
    strategy: ResolutionStrategy,
    currentResolvedText?: string,
    originalConflictText?: string
  ): Promise<{ success: true } | { error: string }> =>
    invokeBridge('git:resolve-conflict', {
      repoRoot,
      blockId,
      resolvedText,
      strategy,
      currentResolvedText,
      originalConflictText,
    }),

  undoResolve: (
    repoRoot: string,
    blockId: string,
    resolvedText: string,
    originalConflictText: string
  ): Promise<{ success: true } | { error: string }> =>
    invokeBridge('git:undo-resolve', { repoRoot, blockId, resolvedText, originalConflictText }),

  mergeCommit: (
    repoRoot: string,
    resolvedFilePaths: string[],
    commitMessage: string
  ): Promise<{ commitHash: string; pushError?: string } | { error: string }> =>
    invokeBridge('git:merge-commit', { repoRoot, resolvedFilePaths, commitMessage }),

  restoreSession: (repoRoot: string): Promise<{ session: ConflictSession | null }> =>
    invokeBridge('git:session-restore', { repoRoot }),

  persistSession: (
    repoRoot: string,
    session: ConflictSession
  ): Promise<{ success: true } | { error: string }> =>
    invokeBridge('git:session-persist', { repoRoot, session }),

  clearSession: (repoRoot: string): Promise<{ success: true }> =>
    invokeBridge('git:session-clear', { repoRoot }),

  resetSession: (
    repoRoot: string,
    files: Array<{ filePath: string }>
  ): Promise<{ success: true } | { error: string }> =>
    invokeBridge('git:session-reset', { repoRoot, files }),

  preparePrWorktree: (
    repoRoot: string,
    worktreePath: string,
    headRefName: string,
    baseRefName: string
  ): Promise<{ hasConflicts: boolean } | { error: string }> =>
    invokeBridge('git:prepare-pr-worktree', {
      repoRoot,
      worktreePath,
      headRefName,
      baseRefName,
    }),
}
