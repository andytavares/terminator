# Phase 1 Data Model: Branch-First Sidebar

**Feature**: `032-branch-first-sidebar` | **Date**: 2026-08-27

Read this alongside [research.md](./research.md) R4, which decides that the rename is user-visible only. Throughout this document, **Branch** is the product noun and `Project` is the unchanged code identifier for the same thing.

## Entities

### Repo _(product noun)_ / `Workspace` _(code identifier — unchanged)_

A git repository on disk.

| Field        | Type     | Change              | Notes                                                 |
| ------------ | -------- | ------------------- | ----------------------------------------------------- |
| `id`         | string   | —                   |                                                       |
| `name`       | string   | —                   | Shown on the group header                             |
| `folderPath` | string   | **newly displayed** | Rendered on the group header (FR-008); already stored |
| `color`      | string   | —                   | The band hue; unchanged                               |
| `tags`       | string[] | —                   |                                                       |

No schema change. `folderPath` is already persisted and simply gains a display site.

---

### Branch _(product noun)_ / `Project` _(code identifier — unchanged)_

One checkout of one branch, optionally backed by a worktree directory.

| Field          | Type                | Change               | Notes                                                                                      |
| -------------- | ------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `id`           | string              | —                    |                                                                                            |
| `workspaceId`  | string              | —                    | Owning repo                                                                                |
| `name`         | string              | **semantics change** | Now read as a _label_: displayed only when it differs from `gitBranch`. See Display rules. |
| `gitBranch`    | string \| undefined | **newly primary**    | Becomes the row's default display name (FR-005)                                            |
| `isWorktree`   | boolean             | **newly displayed**  | Selects the row glyph (FR-007)                                                             |
| `worktreePath` | string \| undefined | **newly displayed**  | Revealed on hover (FR-007)                                                                 |

No schema change. Every field already exists; three of them stop being invisible.

**Display rules** (pure, testable, no I/O):

```
displayName(branch):
  when gitBranch is absent        → name                       // detached or unknown
  when name equals gitBranch      → gitBranch                   // the common case today
  otherwise                       → name, with gitBranch shown as secondary
```

This is what makes the migration a no-op for existing data: every branch created by the current app is named after its branch, so it hits case two and renders identically. Only branches created from a ticket — which today read `TAV-14 Make all text in the application red` — hit case three and gain their branch name as a second line of information.

---

### Session

A terminal, optionally running an agent. **Unchanged.** Listed here because its rendering changes.

| Field                                 | Type                                                  | Change              | Notes                                                                  |
| ------------------------------------- | ----------------------------------------------------- | ------------------- | ---------------------------------------------------------------------- |
| `agentState`                          | `'working' \| 'idle' \| 'awaiting-input' \| 'exited'` | **newly displayed** | Already computed and already filtered on; now visible at rest (FR-002) |
| `lastActivityAt`                      | number                                                | —                   | Already displayed                                                      |
| `tabTitle`, `note`, `parentSessionId` | —                                                     | —                   | Unchanged                                                              |

---

### SessionStatus _(new, derived — not stored)_

A pure mapping from a session to its resting presentation. Lives in `src/renderer/sidebar/session-status.ts`.

```
StatusPresentation = {
  icon:  'play' | 'circle' | 'pause' | 'circle-x'
  label: 'Running' | 'Idle' | 'Waiting on you' | 'Exited'
  emphasises: boolean        // true only for awaiting-input; drives the row edge bar
}
```

| Input            | icon       | label          | emphasises |
| ---------------- | ---------- | -------------- | ---------- |
| `working`        | `play`     | Running        | false      |
| `idle`           | `circle`   | Idle           | false      |
| `awaiting-input` | `pause`    | Waiting on you | **true**   |
| `exited`         | `circle-x` | Exited         | false      |

**Precedence at render**, highest first — this preserves today's behaviour:

1. Session is busy (PTY actively producing) → existing spinner
2. Session has unread bell count → existing bell badge
3. Otherwise → the `StatusPresentation` above

**Invariants**

- The mapping is total: every `AgentState` value has exactly one presentation. A new state added to the union is a compile error until mapped.
- It is pure — no clock, no store, no I/O.
- It never encodes selection. Selection is the row's surface, decided by the component (FR-001).

---

### ChangeStats _(new, derived — not stored on any entity)_

Uncommitted change volume for one branch's working tree. Held only in the `change-stats` store; never written to the workspace store, never passed into `buildGroups`.

```
ChangeStats = { added: number, removed: number, files: number }

ChangeStatsEntry = {
  stats:     ChangeStats | null
  fetchedAt: number                                // epoch ms, injected — never Date.now() inside the store
  state:     'idle' | 'loading' | 'ready' | 'error'
}
```

Keyed by branch (`Project`) id.

**Rules**

- Requested lazily, the first time a branch row renders.
- A read inside the 15-second TTL returns the cached entry without touching git.
- `state: 'error'` and `stats: null` both render as _absent_ — the row shows no statistics and no error affordance. Change volume is decorative; a git failure must never produce a broken-looking row (spec Edge Cases).
- Invalidated by: activity stamped on any session in that branch, a completed git operation in that branch, and window focus.
- Counts staged and unstaged tracked changes (`git diff --numstat HEAD`). Untracked files are not counted — a documented limitation consistent with the rest of the app's git surface.

---

## What deliberately does not change

| Thing                                          | Why                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Workspace store schema                         | FR-021 — an older build must still read the data                                                                         |
| `project:*` IPC channel names                  | FR-020 — installed extensions call them                                                                                  |
| `api.project.*` Extension API                  | FR-020 — a change here forces every extension to change                                                                  |
| `buildGroups` signature and behaviour          | Constitution XI — the pure core stays a function of its arguments; `view-model-performance.spec.ts` must pass unmodified |
| `Group`, `SessionView`, `SessionFilters` types | Nothing in this feature needs them; grouping and filtering are untouched (FR-020)                                        |
| The count computed by `buildGroups`            | The count-vs-rows defect (audit NAV-6) is a standalone repair and is explicitly out of this feature's scope              |

## Relationships

```
Repo (Workspace) 1 ──── * Branch (Project) 1 ──── * Session
                              │                        │
                              │                        └── SessionStatus  (derived, pure)
                              └── ChangeStats           (derived, async, cached, optional)
                              └── linked issue          (existing, unchanged)
```

Both derived types hang off their owner rather than being fields on it. That is the whole reason the pure view model survives this feature unchanged.
