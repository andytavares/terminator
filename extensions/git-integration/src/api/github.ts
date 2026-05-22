// Bridge module so extension components don't access window.electronAPI.github directly.
// All calls go through extensionBridge.invoke which routes via registered IPC handlers.

const bridge = () => window.electronAPI.extensionBridge

export const githubAPI = {
  listOpenPrs: (
    repoRoot: string,
    options?: { cursor?: string; search?: string; includeClosedPrs?: boolean }
  ) => bridge().invoke('github:list-open-prs', { repoRoot, ...options }),

  prReviewDetail: (repoRoot: string, prNumber: number) =>
    bridge().invoke('github:pr-review-detail', { repoRoot, prNumber }),

  prFileDiff: (repoRoot: string, prNumber: number, path: string) =>
    bridge().invoke('github:pr-file-diff', { repoRoot, prNumber, path }),

  fileMetrics: (repoRoot: string, path: string) =>
    bridge().invoke('github:file-metrics', { repoRoot, path }),

  prInlineComments: (repoRoot: string, prNumber: number) =>
    bridge().invoke('github:pr-inline-comments', { repoRoot, prNumber }),

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
}
