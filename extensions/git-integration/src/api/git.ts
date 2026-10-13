// Bridge module — extension components call extension-owned git IPC channels
// through extensionBridge, never via window.electronAPI.git directly.

import { invoke } from '@terminator/extension-sdk/renderer'

export type CommitResult =
  | { commitHash: string }
  | { error: string; hookOutput?: string; isHookFailure?: boolean }

const bridge = () => window.electronAPI.extensionBridge

export const gitAPI = {
  status: (path: string, maxFiles?: number) => bridge().invoke('git:status', { path, maxFiles }),

  diffFile: (payload: { repoRoot: string; path: string; staged: boolean; isUntracked?: boolean }) =>
    bridge().invoke('git:diff-file', payload),

  stage: (repoRoot: string, paths: string[]) => bridge().invoke('git:stage', { repoRoot, paths }),

  unstage: (repoRoot: string, paths: string[]) =>
    bridge().invoke('git:unstage', { repoRoot, paths }),

  commit: (payload: { repoRoot: string; message: string; signOff?: boolean; noVerify?: boolean }) =>
    invoke<CommitResult>('git:commit', payload),

  commitOutputPoll: (repoRoot: string) => bridge().invoke('git:commit-output-poll', { repoRoot }),

  prStatus: (repoRoot: string) => bridge().invoke('git:pr-status', { repoRoot }),

  push: (repoRoot: string) => bridge().invoke('git:push', { repoRoot }),
}
