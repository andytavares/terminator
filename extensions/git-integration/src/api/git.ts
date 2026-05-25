// Bridge module — extension components call extension-owned git IPC channels
// through extensionBridge, never via window.electronAPI.git directly.

const bridge = () => window.electronAPI.extensionBridge

export const gitAPI = {
  status: (path: string, maxFiles?: number) => bridge().invoke('git:status', { path, maxFiles }),

  diffFile: (repoRoot: string, path: string, staged: boolean, isUntracked?: boolean) =>
    bridge().invoke('git:diff-file', { repoRoot, path, staged, isUntracked }),

  stage: (repoRoot: string, paths: string[]) => bridge().invoke('git:stage', { repoRoot, paths }),

  unstage: (repoRoot: string, paths: string[]) =>
    bridge().invoke('git:unstage', { repoRoot, paths }),

  commit: (repoRoot: string, message: string, signOff?: boolean, noVerify?: boolean) =>
    bridge().invoke('git:commit', { repoRoot, message, signOff, noVerify }),

  commitOutputPoll: (repoRoot: string) => bridge().invoke('git:commit-output-poll', { repoRoot }),

  prStatus: (repoRoot: string) => bridge().invoke('git:pr-status', { repoRoot }),

  prCreate: (payload: unknown) => bridge().invoke('git:pr-create', payload),

  push: (repoRoot: string) => bridge().invoke('git:push', { repoRoot }),
}
