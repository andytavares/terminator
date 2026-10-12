import type { ConflictSession, ResolutionStrategy } from '../schemas/merge-flow.schema'
import { invoke } from '@terminator/extension-sdk/renderer'

export const mergeFlowAPI = {
  listConflicts: (repoRoot: string): Promise<ConflictSession | { error: string }> =>
    invoke('git:conflicts-list', { repoRoot }),

  resolveConflict: (
    repoRoot: string,
    blockId: string,
    resolvedText: string,
    strategy: ResolutionStrategy,
    currentResolvedText?: string,
    originalConflictText?: string
  ): Promise<{ success: true } | { error: string }> =>
    invoke('git:resolve-conflict', {
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
    invoke('git:undo-resolve', { repoRoot, blockId, resolvedText, originalConflictText }),

  mergeCommit: (
    repoRoot: string,
    resolvedFilePaths: string[],
    commitMessage: string
  ): Promise<{ commitHash: string; pushError?: string } | { error: string }> =>
    invoke('git:merge-commit', { repoRoot, resolvedFilePaths, commitMessage }),

  restoreSession: (repoRoot: string): Promise<{ session: ConflictSession | null }> =>
    invoke('git:session-restore', { repoRoot }),

  persistSession: (
    repoRoot: string,
    session: ConflictSession
  ): Promise<{ success: true } | { error: string }> =>
    invoke('git:session-persist', { repoRoot, session }),

  clearSession: (repoRoot: string): Promise<{ success: true }> =>
    invoke('git:session-clear', { repoRoot }),

  resetSession: (
    repoRoot: string,
    files: Array<{ filePath: string }>
  ): Promise<{ success: true } | { error: string }> =>
    invoke('git:session-reset', { repoRoot, files }),

  preparePrWorktree: (
    repoRoot: string,
    worktreePath: string,
    headRefName: string,
    baseRefName: string
  ): Promise<{ hasConflicts: boolean } | { error: string }> =>
    invoke('git:prepare-pr-worktree', {
      repoRoot,
      worktreePath,
      headRefName,
      baseRefName,
    }),
}
