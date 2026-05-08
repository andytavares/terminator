// Type augmentation for extension-owned IPC channels.
// Declaration merging adds git extension methods and the github namespace
// to the core ElectronAPI without modifying core source files.

declare global {
  interface Window {
    electronAPI: Window['electronAPI'] & {
      git: Window['electronAPI']['git'] & {
        status(path: string, maxFiles?: number): Promise<{ branch: string; files: unknown[]; hasConflicts: boolean; truncated: boolean } | { error: string }>
        diffFile(repoRoot: string, path: string, staged: boolean): Promise<{ diff: unknown } | { error: string }>
        stage(repoRoot: string, paths: string[]): Promise<{ success: true } | { error: string }>
        unstage(repoRoot: string, paths: string[]): Promise<{ success: true } | { error: string }>
        commit(repoRoot: string, message: string, signOff?: boolean): Promise<{ commitHash: string } | { error: string }>
        prStatus(repoRoot: string): Promise<{ pr: unknown | null } | { error: string }>
        prCreate(payload: unknown): Promise<{ pr: unknown } | { error: string }>
      }
      github: {
        listOpenPrs(repoRoot: string): Promise<{ prs: unknown[] } | { error: string }>
        prReviewDetail(repoRoot: string, prNumber: number): Promise<{ pr: unknown } | { error: string }>
        prFileDiff(repoRoot: string, prNumber: number, path: string): Promise<{ diff: unknown } | { error: string }>
        fileMetrics(repoRoot: string, path: string): Promise<{
          churn90d: number
          blastRadius: number
          topImporters: string[]
          importerCount: number
          testFilePresent: boolean
          patchCoverage: number | null
        } | { error: string }>
        prInlineComments(repoRoot: string, prNumber: number): Promise<{ comments: unknown[] } | { error: string }>
        prCommentAdd(payload: unknown): Promise<{ comment: unknown } | { error: string }>
        prCommentReply(payload: unknown): Promise<{ comment: unknown } | { error: string }>
        prReviewSubmit(payload: unknown): Promise<{ reviewId: number } | { error: string }>
        sessionGet(key: string): Promise<{ session: unknown } | { session: null }>
        sessionSet(key: string, session: unknown): Promise<{ ok: true } | { error: string }>
      }
    }
  }
}

export {}
