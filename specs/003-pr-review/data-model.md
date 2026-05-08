# Data Model: Unified Pull Request Review

**Branch**: `003-pr-review` | **Date**: 2026-05-07

All types are defined as Zod schemas in `src/shared/schemas/pr-review.schema.ts` and inferred TypeScript types exported alongside.

---

## Core Types

### `ReviewQueuePR`

Lightweight PR summary used in the review queue list. Fetched via `gh pr list`.

```typescript
{
  number: number              // PR number
  title: string
  author: string              // GitHub login
  authorAvatarUrl: string
  openedAt: string            // ISO 8601
  headRefName: string
  baseRefName: string
  isDraft: boolean
  ciStatus: 'passing' | 'failing' | 'pending' | 'none'
  fileCount: number
  additions: number
  deletions: number
  estimatedMinutes: number    // derived: ceil((additions + deletions) / 60)
  riskLevel: 'low' | 'medium' | 'high'  // derived from signal scores
  signalDots: SignalDots      // six coloured dots
  sessionStatus: 'not-started' | 'in-progress' | 'paused'
  resumeChapter?: number      // 1-indexed; set when sessionStatus === 'paused'
  resumeChapterTotal?: number
}
```

### `SignalDots`

Six boolean-ish health signals shown as coloured dots in the queue row.

```typescript
{
  tests:    'pass' | 'warn' | 'fail' | 'unknown'
  coverage: 'pass' | 'warn' | 'fail' | 'unknown'
  ci:       'pass' | 'warn' | 'fail' | 'unknown'
  lint:     'pass' | 'warn' | 'fail' | 'unknown'
  churn:    'pass' | 'warn' | 'fail' | 'unknown'  // low/medium/high churn
  blast:    'pass' | 'warn' | 'fail' | 'unknown'  // low/medium/high blast radius
}
```

### `PrReviewDetail`

Full PR detail fetched when the reviewer opens a PR. Includes file list, ordered and grouped.

```typescript
{
  number: number
  title: string
  body: string                // raw markdown — rendered via RichContent
  author: string
  authorAvatarUrl: string
  openedAt: string
  headRefName: string
  baseRefName: string
  headSHA: string             // used as part of the session persistence key
  ciStatus: 'passing' | 'failing' | 'pending' | 'none'
  chapters: Chapter[]
}
```

### `Chapter`

A named group of related changed files in dependency order.

```typescript
{
  id: string                  // slugified name, e.g. 'src-auth'
  name: string                // display name, e.g. 'src/auth'
  files: PrChangedFile[]      // in display order
  estimatedMinutes: number    // sum of per-file estimates
  status: 'not-started' | 'in-progress' | 'complete'  // derived from file viewed states
}
```

### `PrChangedFile`

A single changed file within a PR, with all health metadata.

```typescript
{
  path: string
  oldPath?: string            // set for renames
  changeType: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  isBinary: boolean
  tier: 0 | 1 | 2 | 3        // heuristic ordering tier (0=types, 1=source, 2=tests, 3=mechanical)
  whyHere: string             // e.g. "Interface file — defines types used by the files below"
  riskScore: RiskScore
  estimatedMinutes: number    // ceil((additions + deletions) / 60), min 1
}
```

### `RiskScore`

The computed risk rating and per-metric breakdown for a single file.

```typescript
{
  level: 'low' | 'medium' | 'high'
  composite: number           // 0–100 (or null if fewer than 2 metrics available)
  metrics: {
    changeSize: number | null
    churn90d: number | null   // raw commit count in last 90 days
    blastRadius: number | null // count of files importing this one
    testFilePresent: boolean | null
    complexityDelta: number | null  // cyclomatic delta via keyword counting; null if diff unavailable
    patchCoverage: number | null    // null unless lcov/cobertura available from CI
  }
  dominantDriver: string      // human-readable "why" e.g. "High churn (47 commits/90d)"
  topImporters: string[]      // up to 5 relative paths
  importerCount: number       // total including those not in topImporters
}
```

### `FileMetrics`

Intermediate type carrying raw metric values before normalisation — input to `computeRiskScore`.

```typescript
{
  path: string
  additions: number
  deletions: number
  churn90d: number | null
  blastRadius: number | null
  testFilePresent: boolean
  complexityDelta: number | null  // sum of per-hunk cyclomatic deltas from keyword counting
  patchCoverage: number | null
  topImporters: string[]
  importerCount: number
}
```

---

## Comment Types

### `InlineComment`

A single comment anchored to a line or range within a file diff.

```typescript
{
  id: number                  // GitHub comment ID
  author: string
  authorAvatarUrl: string
  body: string                // raw markdown
  createdAt: string           // ISO 8601
  updatedAt: string
  path: string                // file path
  line: number                // end line (GitHub convention)
  startLine: number | null    // null = single-line comment
  side: 'LEFT' | 'RIGHT'
  diffHunk: string            // context from GitHub for outdated detection
  outdated: boolean
  threadId: string            // all comments with the same threadId form a thread
  isReply: boolean            // true if this is a reply to another comment
  parentId: number | null     // GitHub's in_reply_to_id
}
```

### `Thread`

A group of inline comments (root + replies) displayed together.

```typescript
{
  id: string                  // == root comment threadId
  path: string
  line: number
  startLine: number | null
  side: 'LEFT' | 'RIGHT'
  outdated: boolean
  comments: InlineComment[]   // chronological order, root first
  collapsed: boolean          // true when thread has > 3 replies and not yet expanded
}
```

---

## Session State

### `ReviewSession`

Persisted to `electron-store` at key `"${repoRoot}:::${prNumber}:::${headSHA}"`.

```typescript
{
  repoRoot: string
  prNumber: number
  headSHA: string
  currentChapterId: string | null
  currentFilePath: string | null
  viewedFiles: Set<string>             // paths of files marked viewed
  fileOrderOverrides: Record<string, string[]>  // chapterId → ordered file paths (manual drag-drop)
  scrollPosition: number | null        // px offset from top of diff pane; null = top
  pausedAt: string | null              // ISO 8601; null if not paused
  lastAccessedAt: string               // ISO 8601
}
```

---

## State Transitions

### File Viewed State

```
unviewed → viewed       (user clicks "Mark viewed → Next file")
viewed   → unviewed     (user clicks the checkmark to unmark)
```

### Chapter Status (derived, not stored)

```
not-started   (0 files in chapter are viewed)
in-progress   (1..N-1 files viewed, N = chapter.files.length)
complete      (all N files viewed)
```

### Review Session (derived, not stored)

```
not-started → in-progress   (first file marked viewed)
in-progress → paused        ("Pause review" clicked; pausedAt set)
paused      → in-progress   (PR re-opened from queue; pausedAt cleared)
```

---

## Zod Schema Location

`src/shared/schemas/pr-review.schema.ts` — all types above as Zod schemas with `.parse` / `.safeParse`. Renderer and main process both import from this path (no duplication).
