# Contract: Change Statistics IPC

**Feature**: `032-branch-first-sidebar`

One new main-process capability and one new IPC channel. Follows the existing `git-service → git.ipc → preload → renderer store` path used by every other git feature in core.

## Main process — `src/main/git/git-service.ts`

```ts
/**
 * Uncommitted change volume for one working tree, staged and unstaged.
 * `cwd` is the branch's own directory: its worktree path when it has one,
 * the repo root otherwise.
 */
export async function getChangeStats(cwd: string): Promise<ChangeStats>
```

**Behaviour**

- Runs `git diff --numstat HEAD` in `cwd`, using the module's existing `execFile` wrapper, `GIT_TIMEOUT` (10s) and `GIT_ENV`.
- Sums the added and removed columns; counts rows for `files`.
- Binary files report `-` in both columns; they count toward `files` and contribute `0` to `added`/`removed`.
- Untracked files are not counted. Documented limitation, consistent with `git diff` elsewhere in the app.
- A repository with no commits (`HEAD` unborn) resolves to `{ added: 0, removed: 0, files: 0 }` rather than throwing.

**Errors** — the function rejects; it never returns a partial result. Callers treat any rejection as "statistics unavailable".

| Condition                     | Result  |
| ----------------------------- | ------- |
| `cwd` is not a git repository | rejects |
| git is missing from `PATH`    | rejects |
| the 10s timeout elapses       | rejects |

## Schema — `src/shared/schemas/git.schema.ts`

```ts
export const changeStatsSchema = z.object({
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
})

export type ChangeStats = z.infer<typeof changeStatsSchema>
```

## IPC — `src/main/ipc/git.ipc.ts`

| Channel            | Direction                | Request           | Response                           |
| ------------------ | ------------------------ | ----------------- | ---------------------------------- |
| `git:change-stats` | renderer → main (invoke) | `{ cwd: string }` | `ChangeStats \| { error: string }` |

Matches the error convention already used by `git:checkout` and `git:list-branches`: resolve with an `{ error }` object rather than rejecting across the boundary.

## Preload — `src/preload/index.ts`

```ts
electronAPI.git.changeStats(cwd: string): Promise<ChangeStats | { error: string }>
```

## Renderer store — `src/renderer/stores/change-stats.store.ts`

```ts
interface ChangeStatsStore {
  /** Cached entry for a branch, or undefined if never requested. */
  statsFor(branchId: string): ChangeStatsEntry | undefined

  /**
   * Requests stats for a branch if the cached entry is absent or older than
   * the TTL. Safe to call on every render — a call inside the TTL is a no-op.
   * `now` is injected so the TTL is testable at its boundaries.
   */
  ensure(branchId: string, cwd: string, now: number): void

  /** Drops the cached entry so the next `ensure` refetches. */
  invalidate(branchId: string): void
}

const TTL_MS = 15_000
```

**Rules**

- `ensure` never returns a promise to the caller and is never awaited by render (FR-009, research R2).
- The store holds no clock. `now` is a parameter, matching the convention `view-model.ts` and `isStale` already follow.
- Concurrent `ensure` calls for the same branch collapse to one in-flight request.
- An `{ error }` response sets `state: 'error'`, `stats: null`, and stamps `fetchedAt` so the TTL also throttles retries after failure.

**Invalidation callers**

| Event                                                             | Action                           |
| ----------------------------------------------------------------- | -------------------------------- |
| A session in the branch stamps activity                           | `invalidate(branchId)`           |
| A git operation in the branch completes (checkout, stage, commit) | `invalidate(branchId)`           |
| The window regains focus                                          | `invalidate` every cached branch |

## Test obligations

Constitution VI requires each new file at ≥ 80% coverage before merge.

| File                                | Must cover                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git-service.ts` (`getChangeStats`) | numstat parsing including binary `-` rows; unborn `HEAD`; timeout and non-repo rejection                                                                                        |
| `change-stats.store.ts`             | cache hit inside TTL; refetch at the boundary (`now === fetchedAt + TTL` and one ms past); in-flight collapsing; error state throttling retries; `invalidate` forcing a refetch |
| `git.ipc.ts`                        | success passthrough and `{ error }` shaping — extend the existing `git-ipc.spec.ts`                                                                                             |
