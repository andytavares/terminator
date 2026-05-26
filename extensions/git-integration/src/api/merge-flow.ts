import type { ConflictSession, ResolutionStrategy } from '../schemas/merge-flow.schema'

const bridge = () => window.electronAPI.extensionBridge

export const mergeFlowAPI = {
  listConflicts: (repoRoot: string): Promise<ConflictSession | { error: string }> =>
    bridge().invoke('git:conflicts-list', { repoRoot }),

  getConflictBlocks: (
    repoRoot: string,
    filePath: string
  ): Promise<{ blocks: unknown[] } | { error: string }> =>
    bridge().invoke('git:conflict-blocks', { repoRoot, filePath }),

  resolveConflict: (
    repoRoot: string,
    blockId: string,
    resolvedText: string,
    strategy: ResolutionStrategy,
    currentResolvedText?: string,
    originalConflictText?: string
  ): Promise<{ success: true } | { error: string }> =>
    bridge().invoke('git:resolve-conflict', {
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
    bridge().invoke('git:undo-resolve', { repoRoot, blockId, resolvedText, originalConflictText }),

  mergeCommit: (
    repoRoot: string,
    resolvedFilePaths: string[],
    commitMessage: string
  ): Promise<{ commitHash: string; pushError?: string } | { error: string }> =>
    bridge().invoke('git:merge-commit', { repoRoot, resolvedFilePaths, commitMessage }),

  restoreSession: (repoRoot: string): Promise<{ session: ConflictSession | null }> =>
    bridge().invoke('git:session-restore', { repoRoot }),

  persistSession: (
    repoRoot: string,
    session: ConflictSession
  ): Promise<{ success: true } | { error: string }> =>
    bridge().invoke('git:session-persist', { repoRoot, session }),

  clearSession: (repoRoot: string): Promise<{ success: true }> =>
    bridge().invoke('git:session-clear', { repoRoot }),

  resetSession: (
    repoRoot: string,
    files: Array<{ filePath: string }>
  ): Promise<{ success: true } | { error: string }> =>
    bridge().invoke('git:session-reset', { repoRoot, files }),

  prepareMergeForPr: (
    repoRoot: string,
    headRefName: string,
    baseRefName: string
  ): Promise<{ hasConflicts: boolean } | { error: string }> =>
    bridge().invoke('git:prepare-merge-for-pr', { repoRoot, headRefName, baseRefName }),

  preparePrWorktree: (
    repoRoot: string,
    worktreePath: string,
    headRefName: string,
    baseRefName: string
  ): Promise<{ hasConflicts: boolean } | { error: string }> =>
    bridge().invoke('git:prepare-pr-worktree', {
      repoRoot,
      worktreePath,
      headRefName,
      baseRefName,
    }),
}
