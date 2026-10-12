// Bridge module so extension components don't access window.electronAPI.github directly.
// All calls go through extensionBridge.invoke which routes via registered IPC handlers.

import type { IssueComment } from '../schemas/pr-review.schema'
import { invokeBridge, type BridgeResult } from './bridge'

const bridge = () => window.electronAPI.extensionBridge

export interface RawFileMetrics {
  churn90d: number
  blastRadius: number
  topImporters: string[]
  importerCount: number
  testFilePresent: boolean
  patchCoverage?: number | null
}

export interface OpenPrsPage {
  prs: unknown[]
  hasMore: boolean
  nextCursor?: string
  totalCount?: number
}

export interface PrCompareResult {
  rewritten: boolean
  commits: number
  files: Array<{ path: string; patch: string }>
}

export const githubAPI = {
  currentUser: (repoRoot: string) => bridge().invoke('github:current-user', { repoRoot }),

  listOpenPrs: (repoRoot: string, options?: { cursor?: string; search?: string }) =>
    invokeBridge<BridgeResult<OpenPrsPage>>('github:list-open-prs', { repoRoot, ...options }),

  prReviewDetail: (repoRoot: string, prNumber: number) =>
    invokeBridge<BridgeResult<{ pr: unknown }>>('github:pr-review-detail', { repoRoot, prNumber }),

  prMarkReady: (repoRoot: string, prNumber: number) =>
    bridge().invoke('github:pr-mark-ready', { repoRoot, prNumber }),

  prUpdateBranch: (repoRoot: string, prNumber: number) =>
    bridge().invoke('github:pr-update-branch', { repoRoot, prNumber }),

  prFileDiff: (
    repoRoot: string,
    prNumber: number,
    path: string,
    known?: { baseRef?: string; headSHA?: string }
  ) =>
    invokeBridge<BridgeResult<{ diff: unknown }>>('github:pr-file-diff', {
      repoRoot,
      prNumber,
      path,
      ...known,
    }),

  prFileContent: (repoRoot: string, prNumber: number, path: string, ref: string) =>
    bridge().invoke('github:pr-file-content', { repoRoot, prNumber, path, ref }),

  filesMetrics: (repoRoot: string, paths: string[]) =>
    invokeBridge<BridgeResult<{ metrics: Record<string, RawFileMetrics> }>>(
      'github:files-metrics',
      { repoRoot, paths }
    ),

  prInlineComments: (repoRoot: string, prNumber: number) =>
    invokeBridge<BridgeResult<{ comments: unknown[]; resolvedCommentIds?: number[] }>>(
      'github:pr-inline-comments',
      { repoRoot, prNumber }
    ),

  prIssueComments: (repoRoot: string, prNumber: number) =>
    invokeBridge<BridgeResult<{ comments: IssueComment[] }>>('github:pr-issue-comments', {
      repoRoot,
      prNumber,
    }),

  prIssueCommentAdd: (payload: { repoRoot: string; prNumber: number; body: string }) =>
    invokeBridge<BridgeResult<{ comment: unknown }>>('github:pr-issue-comment-add', payload),

  prCommentReply: (payload: unknown) =>
    invokeBridge<BridgeResult<{ comment: unknown }>>('github:pr-comment-reply', payload),

  prReviewSubmit: (payload: unknown) =>
    invokeBridge<BridgeResult<{ reviewId: number }>>('github:pr-review-submit', payload),

  sessionGet: (key: string) => invokeBridge<{ session: unknown }>('github:session-get', { key }),

  sessionSet: (key: string, session: unknown) =>
    bridge().invoke('github:session-set', { key, session }),

  sessionsForRepo: (repoRoot: string) =>
    invokeBridge<{ sessions: unknown[] }>('github:sessions-for-repo', { repoRoot }),

  saveActiveReview: (repoRoot: string, pr: unknown) =>
    bridge().invoke('github:save-active-review', { repoRoot, pr }),

  activeReviewsForRepo: (repoRoot: string) =>
    invokeBridge<BridgeResult<{ prs: unknown[] }>>('github:active-reviews-for-repo', { repoRoot }),

  removeActiveReview: (repoRoot: string, prNumber: number) =>
    bridge().invoke('github:remove-active-review', { repoRoot, prNumber }),

  pruneActiveReviews: (repoRoot: string, prNumbers: number[]) =>
    invokeBridge<BridgeResult<{ openNumbers: number[] }>>('github:prune-active-reviews', {
      repoRoot,
      prNumbers,
    }),

  dashboardSearch: () => bridge().invoke('github:dashboard-search', {}),

  fileViewedSet: (
    repoRoot: string,
    prNumber: number,
    path: string,
    viewed: boolean,
    nodeId?: string
  ) =>
    bridge().invoke('github:file-viewed-set', {
      repoRoot,
      prNumber,
      path,
      viewed,
      ...(nodeId ? { nodeId } : {}),
    }),

  filesViewedSet: (
    repoRoot: string,
    prNumber: number,
    nodeId: string | undefined,
    paths: string[],
    viewed: boolean
  ) =>
    bridge().invoke('github:files-viewed-set', {
      repoRoot,
      prNumber,
      paths,
      viewed,
      ...(nodeId ? { nodeId } : {}),
    }),

  prCompare: (repoRoot: string, fromSha: string, toSha: string) =>
    invokeBridge<BridgeResult<PrCompareResult>>('github:pr-compare', { repoRoot, fromSha, toSha }),

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

  accessibleRepos: (refresh?: boolean) =>
    bridge().invoke('github:accessible-repos', refresh === undefined ? {} : { refresh }),

  setReviewRepos: (repos: string[]) => bridge().invoke('github:review-repos-set', { repos }),
}
