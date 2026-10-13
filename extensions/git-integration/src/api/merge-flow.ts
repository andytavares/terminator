import type { ConflictSession, ResolutionStrategy } from '../schemas/merge-flow.schema'
import { invoke } from '@terminator/extension-sdk/renderer'

/** A conflict block of a checkout, and the text it was resolved to. */
interface BlockText {
  repoRoot: string
  blockId: string
  resolvedText: string
}

export const mergeFlowAPI = {
  listConflicts: (repoRoot: string): Promise<ConflictSession | { error: string }> =>
    invoke('git:conflicts-list', { repoRoot }),

  resolveConflict: (
    resolution: BlockText & {
      strategy: ResolutionStrategy
      currentResolvedText?: string
      originalConflictText?: string
    }
  ): Promise<{ success: true } | { error: string }> => invoke('git:resolve-conflict', resolution),

  undoResolve: (
    undo: BlockText & { originalConflictText: string }
  ): Promise<{ success: true } | { error: string }> => invoke('git:undo-resolve', undo),

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

  preparePrWorktree: (worktree: {
    repoRoot: string
    worktreePath: string
    headRefName: string
    baseRefName: string
  }): Promise<{ hasConflicts: boolean } | { error: string }> =>
    invoke('git:prepare-pr-worktree', worktree),
}
