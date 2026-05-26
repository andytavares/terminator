# Data Model: MergeFlow — Merge Conflict Resolver

**Branch**: `006-mergeflow-conflict-resolver`  
**Date**: 2026-05-25

All types are defined in `extensions/git-integration/src/schemas/merge-flow.schema.ts` using Zod, with TypeScript types inferred from schemas.

---

## Core Entities

### ConflictSession

Represents the full state of one merge resolution session for a given git repository.

```typescript
{
  repoRoot: string           // Absolute path to the git repo
  sessionId: string          // UUID, used as the electron-store key for persistence
  startedAt: number          // Unix timestamp (ms)
  mergeContext: 'merge' | 'rebase'  // Detected on session start; drives label inversion
  files: ConflictFile[]      // All conflicted files, ordered by conflict count desc
  undoStack: ResolutionDecision[]   // Most recent decision last; pop to undo
}
```

**Validation rules**:

- `repoRoot` must be non-empty
- `files` must have at least one entry (sessions with 0 conflicted files are a no-op)
- `undoStack` length ≤ total conflict count across all files

**State transitions**: `active` → `complete` (all ConflictBlocks resolved) → `committed`

---

### ConflictFile

One file with one or more conflict hunks.

```typescript
{
  path: string               // Relative path from repo root
  fileType: string           // Extension without dot (e.g., 'ts', 'py', 'json')
  isBinary: boolean          // Binary files are excluded from resolution UI
  conflictCount: number      // Total ConflictBlocks in this file
  resolvedCount: number      // Incremented on each confirmed decision
  authorOurs: GitAuthor      // Author of HEAD commit touching this file
  authorTheirs: GitAuthor    // Author of MERGE_HEAD commit touching this file
  blocks: ConflictBlock[]    // Ordered list of conflict hunks in file
}
```

**GitAuthor sub-type**:

```typescript
{
  name: string // Display name (e.g., "Marcus Liu")
  branch: string // Branch name (e.g., "main")
  commitHash: string // Short hash (7 chars)
  timestamp: number // Unix timestamp (ms) of the commit
}
```

**Complexity indicator** (derived, not stored):

- Red: conflictCount ≥ 4
- Yellow: conflictCount 2–3
- Green: conflictCount = 1

---

### ConflictBlock

A single conflict hunk — one `<<<<<<< / ======= / >>>>>>>` region.

```typescript
{
  blockId: string            // `${filePath}#${index}` — stable within session
  filePath: string           // Reference back to parent ConflictFile.path
  index: number              // 0-based position within the file
  baseText: string           // git :1:<file> content for this hunk (common ancestor)
  oursText: string           // git :2:<file> content (HEAD / our branch)
  theirsText: string         // git :3:<file> content (MERGE_HEAD / their branch)
  contextBefore: string[]    // Up to 4 lines before the conflict block
  contextAfter: string[]     // Up to 4 lines after the conflict block
  resolution: ConflictResolution | null   // null = unresolved
}
```

**Notes**:

- `baseText` may be empty for add-add conflicts (both sides added content at the same location)
- In rebase context (`mergeContext === 'rebase'`): display `oursText` as "Their change" and `theirsText` as "Your change" (labels inverted per research decision 5)

---

### ConflictResolution

The chosen outcome for a single ConflictBlock.

```typescript
{
  strategy: 'ours' | 'theirs' | 'both-ours-first' | 'both-theirs-first' | 'manual' | 'ai'
  resolvedText: string // Final content to write to disk for this block
  confirmedAt: number // Unix timestamp (ms)
  aiSuggestionUsed: boolean // true if strategy is 'ai' or if AI suggestion was edited then applied
}
```

---

### ResolutionDecision

An entry in the undo stack — mirrors a confirmed ConflictResolution, with back-reference.

```typescript
{
  blockId: string // Which ConflictBlock this decision applies to
  resolution: ConflictResolution
}
```

**Undo behaviour**: Pop the last entry from `undoStack`, set `ConflictBlock.resolution = null` for the matching `blockId`, decrement `ConflictFile.resolvedCount`.

---

### AISuggestion

Output from the AI suggestion handler for a single ConflictBlock. Transient — not persisted to disk.

```typescript
{
  blockId: string
  suggestedText: string // Proposed resolved content
  confidence: number // 0–100
  riskLabel: 'Low risk' | 'Review carefully' | 'High uncertainty'
  reasoning: string // Plain-language explanation (1–3 sentences)
}
```

**Risk label thresholds** (driven by confidence):

- 80–100 → "Low risk"
- 50–79 → "Review carefully"
- 0–49 → "High uncertainty"

---

## Derived / UI State

These are computed from the above entities and held in the Zustand store but not persisted:

| Field              | Derived from                        | Usage                                    |
| ------------------ | ----------------------------------- | ---------------------------------------- |
| `totalConflicts`   | sum of `ConflictFile.conflictCount` | Hub progress bar denominator             |
| `totalResolved`    | sum of `ConflictFile.resolvedCount` | Hub progress bar numerator               |
| `estimatedMinutes` | `Math.ceil(totalConflicts * 0.75)`  | Hub time estimate display                |
| `activeFile`       | index into `files[]`                | Which file is open in the resolver       |
| `activeBlockIndex` | index into `activeFile.blocks[]`    | Which conflict is shown                  |
| `canUndo`          | `undoStack.length > 0`              | Undo button enabled state                |
| `isComplete`       | `totalResolved === totalConflicts`  | Triggers navigation to completion screen |

---

## Persistence Schema

Stored in `electron-store` under key `mergeflow:session:<repoRoot>` as JSON-serialised `ConflictSession`.

The session record is deleted after `git commit` succeeds (completion flow). On app start, if a session record exists for the current repo root and the git index still shows conflicts, the session is restored and the hub is shown with existing progress.

---

## Zod Schema Location

`extensions/git-integration/src/schemas/merge-flow.schema.ts`

All schemas exported as both Zod validators and TypeScript types:

- `ConflictSessionSchema` / `ConflictSession`
- `ConflictFileSchema` / `ConflictFile`
- `ConflictBlockSchema` / `ConflictBlock`
- `ConflictResolutionSchema` / `ConflictResolution`
- `ResolutionDecisionSchema` / `ResolutionDecision`
- `AISuggestionSchema` / `AISuggestion`
- `GitAuthorSchema` / `GitAuthor`
