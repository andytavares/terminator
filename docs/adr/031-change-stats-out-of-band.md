# ADR 031: Change statistics travel out of band

**Status**: Accepted

**Date**: 2026-08-27

**Feature**: `032-branch-first-sidebar`

## Context

The branch-first sidebar shows uncommitted change volume (`+48 −12`) on each branch row, so a user can see at a glance where the work is. The number comes from `git diff --numstat HEAD`, which means a process spawn per branch.

Two things make placement non-obvious:

1. **The sidebar re-renders constantly.** It re-renders on every session state change, every keystroke in the search box, and every activity stamp. A git call on that path would be six spawns per render at six repos.
2. **The sidebar's core is deliberately pure.** `buildGroups(sessions, projects, workspaces, view, now, staleAfterMs)` is a pure function with a performance spec and exhaustive boundary tests. ADR 027 established that purity as the thing that makes the flat sidebar reversible and testable. Principle XI forbids I/O bleeding into domain logic.

The obvious placement fails both: `added` and `removed` as fields on the `Project` record, populated when the record loads. It would make `buildGroups` a function of when git last answered, so the same arguments would produce different results depending on I/O timing. The team would have to relax both its performance spec and its determinism tests to accommodate that.

## Decision

Change statistics live in a separate renderer store, `change-stats.store.ts`, keyed by branch id. The app never writes them to the workspace store, never attaches them to the `Project` record, and never passes them into `buildGroups`.

The store is:

- **Lazy** — it requests a branch's statistics the first time the branch's row renders. A collapsed group costs nothing.
- **Cached with a 15-second TTL** — a read inside the window returns the cached entry without touching git.
- **Clock-free** — `now` is a parameter, matching the convention `view-model.ts` and `isStale` already follow, so tests can check the TTL at its exact boundaries.
- **Never awaited by render** — `ensure()` returns `void`. A component cannot accidentally block paint on it.
- **Collapsing** — concurrent requests for one branch become one spawn, so three rows of the same branch in one render pass do not produce three `git diff` calls.
- **Failure-tolerant** — an error caches like a success, both render as nothing, and the row has no error affordance. Change volume is decorative. A git failure must not produce a broken-looking row.

Invalidation happens on activity in the branch, on a completed git operation, and on window focus.

## Consequences

**Good**

- `buildGroups` is untouched. Its spec and performance spec run unmodified. The quickstart makes this an explicit gate: if either needed editing, the team did not follow this design.
- First paint never waits on git. A repo whose directory has been moved renders its rows immediately, without statistics, and recovers on its own when the directory returns.
- The 15-second TTL bounds git load to one spawn per branch per window, regardless of render frequency.

**Bad**

- A second source of truth about a branch. A reader now has to know that the record holds some branch information and a store beside it holds the rest.
- Statistics can be up to 15 seconds stale. That is acceptable for a decorative number. It would not be acceptable for anything a user acts on.
- The statistics do not count untracked files, because `git diff` does not see them. A branch with nothing but new files shows no statistics at all. That reads as "no changes" when it means "no tracked changes". The contract documents this. Revisit only if it misleads in practice.

## Alternatives considered

**Fields on the `Project` record.** Rejected: it makes the pure view model depend on I/O timing, which is the specific thing Principle XI and ADR 027 exist to prevent. The feature plan's Complexity Tracking records this deviation, and this is the cheaper side of it.

**Derive from the existing `getStatus()`.** It already runs for the git panel. Rejected: it returns a file list capped at 500 entries, not line counts. To derive `+n/−m` from it, the app would need a second call per file.

**A filesystem watcher per worktree.** Rejected under Principle VII as premature. Six worktrees of recursive watchers is real cost for a number that is decorative. The condition for revisiting is concrete: if the 15-second staleness proves visibly wrong in normal use.

**Eager fetch for all branches on mount.** Rejected: it reintroduces exactly the startup cost the lazy path exists to avoid, for rows the user may never look at.
