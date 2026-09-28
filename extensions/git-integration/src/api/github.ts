// Bridge module so extension components don't access window.electronAPI.github directly.
// All calls go through extensionBridge.invoke which routes via registered IPC handlers.

const bridge = () => window.electronAPI.extensionBridge

export const githubAPI = {
  currentUser: (repoRoot: string) => bridge().invoke('github:current-user', { repoRoot }),

  listOpenPrs: (
    repoRoot: string,
    options?: { cursor?: string; search?: string; includeClosedPrs?: boolean }
  ) => bridge().invoke('github:list-open-prs', { repoRoot, ...options }),

  prReviewDetail: (repoRoot: string, prNumber: number) =>
    bridge().invoke('github:pr-review-detail', { repoRoot, prNumber }),

  prMarkReady: (repoRoot: string, prNumber: number) =>
    bridge().invoke('github:pr-mark-ready', { repoRoot, prNumber }),

  prUpdateBranch: (repoRoot: string, prNumber: number) =>
    bridge().invoke('github:pr-update-branch', { repoRoot, prNumber }),

  prFileDiff: (repoRoot: string, prNumber: number, path: string) =>
    bridge().invoke('github:pr-file-diff', { repoRoot, prNumber, path }),

  fileMetrics: (repoRoot: string, path: string) =>
    bridge().invoke('github:file-metrics', { repoRoot, path }),

  prInlineComments: (repoRoot: string, prNumber: number) =>
    bridge().invoke('github:pr-inline-comments', { repoRoot, prNumber }),

  prIssueComments: (repoRoot: string, prNumber: number) =>
    bridge().invoke('github:pr-issue-comments', { repoRoot, prNumber }),

  prIssueCommentAdd: (payload: { repoRoot: string; prNumber: number; body: string }) =>
    bridge().invoke('github:pr-issue-comment-add', payload),

  prCommentAdd: (payload: unknown) => bridge().invoke('github:pr-comment-add', payload),

  prCommentReply: (payload: unknown) => bridge().invoke('github:pr-comment-reply', payload),

  prReviewSubmit: (payload: unknown) => bridge().invoke('github:pr-review-submit', payload),

  sessionGet: (key: string) => bridge().invoke('github:session-get', { key }),

  sessionSet: (key: string, session: unknown) =>
    bridge().invoke('github:session-set', { key, session }),

  sessionsForRepo: (repoRoot: string) => bridge().invoke('github:sessions-for-repo', { repoRoot }),

  saveActiveReview: (repoRoot: string, pr: unknown) =>
    bridge().invoke('github:save-active-review', { repoRoot, pr }),

  activeReviewsForRepo: (repoRoot: string) =>
    bridge().invoke('github:active-reviews-for-repo', { repoRoot }),

  removeActiveReview: (repoRoot: string, prNumber: number) =>
    bridge().invoke('github:remove-active-review', { repoRoot, prNumber }),

  pruneActiveReviews: (repoRoot: string, prNumbers: number[]) =>
    bridge().invoke('github:prune-active-reviews', { repoRoot, prNumbers }),

  fileCoChange: (repoRoot: string, files: string[]) =>
    bridge().invoke('github:file-cochange', { repoRoot, files }),

  dashboardSearch: () => bridge().invoke('github:dashboard-search', {}),

  fileViewedSet: (repoRoot: string, prNumber: number, path: string, viewed: boolean) =>
    bridge().invoke('github:file-viewed-set', { repoRoot, prNumber, path, viewed }),

  prCompare: (repoRoot: string, fromSha: string, toSha: string) =>
    bridge().invoke('github:pr-compare', { repoRoot, fromSha, toSha }),

  testsForBlock: (input: {
    repoRoot: string
    headSHA: string
    path: string
    code: string
    hunkHeader?: string
  }) => bridge().invoke('github:tests-for-block', input),

  cloneRepo: (repo: string, folder: string) =>
    bridge().invoke('github:clone-repo', { repo, folder }),

  reviewSettings: () => bridge().invoke('github:review-settings', {}),
}
