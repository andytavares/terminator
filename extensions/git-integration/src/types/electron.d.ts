// Type augmentation for extension-owned IPC channels.
// Declaration merging adds git extension methods and the github namespace
// to the core ElectronAPI without modifying core source files.

declare global {
  interface Window {
    electronAPI: Window['electronAPI'] & {
      git: Window['electronAPI']['git'] & {
        status(
          path: string,
          maxFiles?: number
        ): Promise<
          | { branch: string; files: unknown[]; hasConflicts: boolean; truncated: boolean }
          | { error: string }
        >
        diffFile(
          repoRoot: string,
          path: string,
          staged: boolean,
          isUntracked?: boolean
        ): Promise<{ diff: unknown } | { error: string }>
        stage(repoRoot: string, paths: string[]): Promise<{ success: true } | { error: string }>
        unstage(repoRoot: string, paths: string[]): Promise<{ success: true } | { error: string }>
        commit(
          repoRoot: string,
          message: string,
          signOff?: boolean,
          noVerify?: boolean
        ): Promise<
          { commitHash: string } | { error: string; hookOutput?: string; isHookFailure?: boolean }
        >
        commitOutputPoll(repoRoot: string): Promise<{ lines: string[] }>
        prStatus(repoRoot: string): Promise<{ pr: unknown | null } | { error: string }>
        prCreate(payload: unknown): Promise<{ pr: unknown } | { error: string }>
      }
      git: Window['electronAPI']['git'] & {
        push(repoRoot: string): Promise<{ success: true } | { error: string }>
      }
    }
  }
}

export {}
