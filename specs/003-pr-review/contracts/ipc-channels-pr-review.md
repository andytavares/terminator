# Contract: IPC Channels — PR Review Feature

**Version**: 1.0.0
**Date**: 2026-05-07
**Branch**: `003-pr-review`

Defines the new `github:*` IPC channel namespace added for the PR review feature. All existing channels are unchanged. Error convention: `{ error: string }` for runtime failures; `{ error: 'VALIDATION_ERROR', message: string }` for schema failures; `{ error: 'RATE_LIMITED', resetAt: number }` for GitHub rate-limit responses.

All payloads validated with Zod schemas at both ends (`src/shared/schemas/pr-review.schema.ts`).

---

## `github:list-open-prs`

Lists all open PRs for the current repository via `gh pr list`.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{ repoRoot: string }
```

**Response**:
```typescript
{ prs: ReviewQueuePR[] } | { error: string } | { error: 'RATE_LIMITED', resetAt: number }
```

**gh command**: `gh pr list --state open --limit 500 --json number,title,author,createdAt,headRefName,baseRefName,isDraft,statusCheckRollup,files`

---

## `github:pr-review-detail`

Fetches full PR metadata and the ordered chapter/file list.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{ repoRoot: string; prNumber: number }
```

**Response**:
```typescript
{ pr: PrReviewDetail } | { error: string } | { error: 'RATE_LIMITED', resetAt: number }
```

**gh commands**:
- `gh pr view <prNumber> --json number,title,body,author,createdAt,headRefName,baseRefName,headRefOid,statusCheckRollup`
- `gh pr view <prNumber> --json files` (for file list with additions/deletions)

**Notes**: Main process handler builds chapters and computes heuristic ordering before returning. Risk scores are computed lazily per-file via separate `github:file-metrics` calls.

---

## `github:pr-file-diff`

Returns the parsed unified diff for a single PR file.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{ repoRoot: string; prNumber: number; path: string }
```

**Response**:
```typescript
{ diff: FileDiff } | { error: string }
```

**gh command**: `gh api repos/{owner}/{repo}/pulls/{prNumber} --jq '.head.sha'` then `git diff <baseSHA>..<headSHA> -- <path>`

**Notes**: Reuses the existing `FileDiff` / `DiffHunk` / `DiffLine` types from `src/shared/schemas/git.schema.ts`.

---

## `github:file-metrics`

Returns churn, blast radius, and test-file-presence for a single changed file. Used to populate the risk score.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{ repoRoot: string; path: string }
```

**Response**:
```typescript
{
  churn90d: number
  blastRadius: number
  topImporters: string[]    // up to 5 relative paths
  importerCount: number
  testFilePresent: boolean
} | { error: string }
```

**Shell commands** (all via `git` — allowed command):
- Churn: `git log --oneline --since="90 days ago" -- <path>` (line count)
- Blast radius: `git grep -l "from.*<basename>" --` (approximate; counts unique files)
- Test presence: `git ls-files -- <spec-path-pattern>`

---

## `github:pr-inline-comments`

Returns all inline review comments for a PR, including threads.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{ repoRoot: string; prNumber: number }
```

**Response**:
```typescript
{ comments: InlineComment[] } | { error: string } | { error: 'RATE_LIMITED', resetAt: number }
```

**gh command**: `gh api repos/{owner}/{repo}/pulls/{prNumber}/comments --paginate --jq '[.[] | {id,user,body,created_at,updated_at,path,line,start_line,side,diff_hunk,in_reply_to_id,pull_request_review_id}]'`

---

## `github:pr-comment-add`

Creates a new inline comment on a specific line or line range.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{
  repoRoot: string
  prNumber: number
  commitId: string        // PR head SHA
  path: string
  line: number            // end line
  startLine?: number      // for multi-line; omit for single-line
  side: 'LEFT' | 'RIGHT'
  body: string
}
```

**Response**:
```typescript
{ comment: InlineComment } | { error: string }
```

**gh command**: `gh api repos/{owner}/{repo}/pulls/{prNumber}/comments --method POST --field ...`

---

## `github:pr-comment-reply`

Replies to an existing inline comment (creates a thread reply).

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{
  repoRoot: string
  prNumber: number
  inReplyToId: number     // GitHub comment ID of the root comment
  body: string
}
```

**Response**:
```typescript
{ comment: InlineComment } | { error: string }
```

**gh command**: `gh api repos/{owner}/{repo}/pulls/{prNumber}/comments --method POST --field in_reply_to_id=<id> --field body=<body>`

---

## `github:pr-review-submit`

Submits a formal GitHub review (approve / request changes / comment only).

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{
  repoRoot: string
  prNumber: number
  commitId: string        // PR head SHA
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  body: string
}
```

**Response**:
```typescript
{ reviewId: number } | { error: string }
```

**gh command**: `gh api repos/{owner}/{repo}/pulls/{prNumber}/reviews --method POST --field commit_id=<sha> --field event=<APPROVE|REQUEST_CHANGES|COMMENT> --field body=<body>`

---

## `github:session-get`

Reads a persisted review session from electron-store on the main process. The renderer cannot access electron-store directly.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{ key: string }  // "${repoRoot}:::${prNumber}:::${headSHA}"
```

**Response**:
```typescript
{ session: ReviewSession } | { session: null }
```

---

## `github:session-set`

Writes a review session to electron-store on the main process. Called automatically on every `markFileViewed` action and whenever scroll position changes.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{ key: string; session: ReviewSession }
```

**Response**:
```typescript
{ ok: true } | { error: string }
```

---

## `electron.d.ts` Additions

Add the following `github` namespace to `src/renderer/electron.d.ts`:

```typescript
interface ElectronAPI {
  // ... existing namespaces unchanged ...

  github: {
    listOpenPrs(repoRoot: string): Promise<{ prs: unknown[] } | { error: string }>
    prReviewDetail(repoRoot: string, prNumber: number): Promise<{ pr: unknown } | { error: string }>
    prFileDiff(repoRoot: string, prNumber: number, path: string): Promise<{ diff: unknown } | { error: string }>
    fileMetrics(repoRoot: string, path: string): Promise<{ churn90d: number; blastRadius: number; topImporters: string[]; importerCount: number; testFilePresent: boolean } | { error: string }>
    prInlineComments(repoRoot: string, prNumber: number): Promise<{ comments: unknown[] } | { error: string }>
    prCommentAdd(payload: unknown): Promise<{ comment: unknown } | { error: string }>
    prCommentReply(payload: unknown): Promise<{ comment: unknown } | { error: string }>
    prReviewSubmit(payload: unknown): Promise<{ reviewId: number } | { error: string }>
    sessionGet(key: string): Promise<{ session: unknown } | { session: null }>
    sessionSet(key: string, session: unknown): Promise<{ ok: true } | { error: string }>
  }
}
```
