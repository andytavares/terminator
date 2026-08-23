---
description: 'Task list for 031-linear-project-integration'
---

# Tasks: Tracker issues attached to projects

**Input**: Design documents from `/specs/031-linear-project-integration/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Test tasks are **included and mandatory**. Constitution VI makes TDD non-negotiable:
a failing test exists before the production code that satisfies it, and every new file reaches
≥80% coverage. Test tasks are therefore listed before the implementation they demand.

**Organization**: Grouped by user story. The substrate every story needs — types, the two
providers, the credential store, the facade, the channel wiring — is in Phase 2, which blocks
everything. After it, the six stories are independent surfaces.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: The user story this task serves (US1–US6)
- Every task names an exact file path

## Path Conventions

**Source**: `src/main/` (main process), `src/shared/` (types, schemas, channel manifest),
`src/renderer/` (React), `extensions/` (first-party extensions).

**Tests do NOT live beside their source.** `vitest.config.ts` only collects from these globs, and
a spec file outside them **silently never runs** — which then fails the 80% gate on a file that
looks tested:

| Test kind                         | Location                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Main-process unit                 | `tests/unit/<area>/*.spec.ts` — e.g. `tests/unit/integrations/`, `tests/unit/ipc/`                                           |
| Renderer component                | `tests/unit/renderer/components/*.spec.tsx` (flat, named after the component)                                                |
| Fixtures                          | `tests/fixtures/<area>/`                                                                                                     |
| Extension                         | `extensions/<name>/tests/**/*.spec.ts(x)`                                                                                    |
| E2E                               | `tests/e2e/`                                                                                                                 |
| The three exceptions under `src/` | `src/main/remote/__tests__/`, `src/main/ipc/__tests__/`, `src/shared/**/__tests__/` — pre-existing only; do not add new ones |

IPC specs follow the existing naming: `<name>.ipc.spec.ts` (`git.ipc.spec.ts`,
`terminal.ipc.spec.ts`), **not** `<name>-ipc.spec.ts`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and the ground the feature stands on.

- [x] T001 Add `@linear/sdk` `91.0.0`, `react-markdown` `10.1.0`, `remark-gfm` `4.0.1` as exact pins to root `package.json` dependencies and run `npm install` (Constitution IV — exact pins, no carets)
- [x] T002 [P] Create the module directories `src/main/integrations/`, `src/main/integrations/providers/`, and `src/renderer/components/integrations/` per plan.md's structure
- [x] T003 [P] Record current per-file coverage for every pre-existing file this feature edits — `src/renderer/components/settings/SettingsPanel.tsx`, `src/renderer/components/sidebar/SessionGroup.tsx`, `src/renderer/components/sidebar/ScopeMenu.tsx`, `src/renderer/components/sidebar/CreateProjectDialog.tsx`, `src/main/terminal/pty-manager.ts`, `src/shared/electron-api/manifest.ts` — and note any already below 80% in the PR description; the patch gate measures whole files
- [x] T004 [P] Confirm the **test** include globs in `vitest.config.ts` (`NODE_INCLUDE` / `JSDOM_INCLUDE`) collect `tests/unit/integrations/**` and `tests/unit/renderer/components/*.spec.tsx` — they already match `tests/unit/**`, so no config change should be needed; prove it by running one throwaway spec in each location and seeing it fail. (Coverage `include` is already `src/**/*.ts(x)`; note that `src/main/index.ts` and `src/shared/types/**` are in the coverage `exclude` list, so T005 and T062 are not coverage-gated.)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: One issue shape, two providers, one credential store, one facade, one set of
channels. Every user story reads from this.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

**Why the providers are here and not in a story**: `get` is required by US3 (agent context) and
US4 (drawer); `listMine`/`search` by US2 and US5; `verify` by US1; `comment` by US4 and US6.
Placing them in any one story would make the others depend on it and destroy their independence.

### Types and contracts

- [x] T005 [P] Add `TrackerId`, `TrackerConnection`, `MineSelector`, `Issue`, `IssueSummary`, `IssueComment`, `IssueStateType`, `IssueLink`, `AgentContext` and `TrackerErrorKind` to `src/shared/types/index.ts` per data-model.md
- [x] T006 [P] Create Zod schemas for every `integrations:*` payload in `src/shared/schemas/integrations.schema.ts` per contracts/ipc-channels.md
- [x] T007 [P] Write failing tests for the error taxonomy — kind mapping, message passthrough, and that a raw HTTP status or SDK error never escapes — in `tests/unit/integrations/tracker-error.spec.ts`
- [x] T008 Implement `TrackerError` and the kind taxonomy in `src/main/integrations/tracker-error.ts` (data-model.md "Errors")
- [x] T009 Define the `TrackerProvider` interface and its six invariants in `src/main/integrations/providers/provider.ts` per contracts/tracker-provider.md

### ADF → markdown

- [x] T010 [P] Write failing tests for the ADF mapper in `tests/unit/integrations/adf-to-markdown.spec.ts` — one case per mapped node (heading, paragraph, bulletList, orderedList, taskList, table, blockquote, codeBlock, rule, hardBreak) and per mark (strong, em, code, strike, link), plus an **unmapped node degrading to its text content** and a malformed document not throwing
- [x] T011 Implement the pure ADF → markdown mapper in `src/main/integrations/adf-to-markdown.ts` (research R5 — in-house because `adf-to-md` is single-maintainer, which Constitution IV forbids)

### Providers

- [x] T012 [P] Capture Linear response fixtures (viewer, issues, searchIssues, issue, comment, a rate-limit error) in `tests/fixtures/integrations/linear/`
- [x] T013 [P] Capture Jira response fixtures (`/myself`, `/search/jql` including a second page, `/issue/{key}`, `/issue/{key}/comment`, an ADF description, a 429 with `Retry-After`) in `tests/fixtures/integrations/jira/`
- [x] T014 [P] Write failing tests for the Linear provider in `tests/unit/integrations/providers/linear.provider.spec.ts` — verify, listMine, search, get, comment, `IssueStateType` normalisation, `branchName` passthrough, comment bodies as markdown, and `RatelimitedLinearError.retryAfter` surfacing as `rate-limited`
- [x] T015 [P] Write failing tests for the Jira provider in `tests/unit/integrations/providers/jira.provider.spec.ts` — verify, listMine via **`/search/jql`** with `nextPageToken` paging, search, get with ADF converted to markdown, comment posting ADF to `issueIdOrKey`, `branchName` always `null`, and 429 + `Retry-After` surfacing as `rate-limited`
- [x] T016 Implement the Linear provider in `src/main/integrations/providers/linear.provider.ts`, resolving key → UUID before `createComment` (research R3 — the shorthand is documented for `issue()`/`issueUpdate()` but not for comment creation)
- [x] T017 Implement the Jira provider in `src/main/integrations/providers/jira.provider.ts` against REST v3 `/search/jql` (research R4 — `GET /rest/api/3/search` is documented as being deprecated and removed; the current extension calls it)

### Store and facade

- [x] T018 [P] Write failing tests for the credential store in `tests/unit/integrations/tracker-store.spec.ts` — safeStorage round-trip, atomic tmp+rename, missing file, and that a stored secret is never returned by any read used outside the providers
- [x] T019 Implement `src/main/integrations/tracker-store.ts` — safeStorage-encrypted values, atomic write, per-tracker credential and `MineSelector` config
- [x] T020 [P] Write failing tests for the facade in `tests/unit/integrations/issue-service.spec.ts` against a fake provider — TTL cache hit/miss, `refresh` bypass, **single-flight** (N concurrent calls → 1 provider call), merged `listMine` across two trackers, a failing tracker appearing in `failures` without failing the call, and rate-limit backoff honouring the stated wait
- [x] T021 Implement the facade in `src/main/integrations/issue-service.ts` — provider registry, TTL cache, single-flight, merge-with-failures, backoff (FR-028, FR-031, FR-032)

### Channels

- [x] T022 Create `src/main/ipc/integrations.ipc.ts` with the `registerInvokeTable`/`invokeSpec` skeleton for all 11 channels returning `not-connected`, and register it from `src/main/index.ts`
- [x] T023 Declare the 11 channels and 3 events in `src/shared/electron-api/manifest.ts`, with `integrations.connect` and `integrations.disconnect` as `remote: 'omit'` and the rest `'same'` (research R9)
- [x] T024 Update the pinned channel list in `src/shared/electron-api/__tests__/manifest.spec.ts` and add an assertion that the two credential-writing channels are **not** remote-accessible
- [x] T025 Write a test in `tests/unit/integrations/providers/provider.spec.ts` asserting the `TrackerProvider` surface exposes **no mutation beyond `comment`** — no state change, no assignment, no field edit — so FR-034 and SC-014 are enforced by a test rather than by the absence of code

### Documentation for this phase

- [x] T026 [P] Write `docs/adr/029-core-issue-tracker-service.md` — why core rather than an extension, one issue shape for two trackers, ADF → markdown in-house and the three alternatives rejected, and the accepted degradation for unmapped ADF nodes. **Written now, with the decision** (Constitution IX forbids retroactive ADRs)
- [x] T027 [P] Update `docs/ARCHITECTURE.md` with the integrations module, its channels, and the credential boundary

**Checkpoint**: Both trackers can be reached, one issue shape comes back, channels answer, nothing is on screen yet.

**Gate** (Constitution VI, X — this phase is a PR): `npm run format`, then `npm run lint` (0 errors), then `npx vitest run --coverage` (all pass, ≥80% on every new file), from the worktree directory.

---

## Phase 3: User Story 1 - Connect your trackers once (Priority: P1) 🎯 MVP

**Goal**: One place to connect Linear and Jira, verified before storage, adopted from the extension, surviving restarts.

**Independent Test**: Paste a valid credential → connected, account named. Paste an invalid one → rejected, nothing stored. Restart → still connected. (quickstart S1)

### Tests for User Story 1 ⚠️

- [x] T028 [P] [US1] Write failing tests for the credential migration in `tests/unit/integrations/tracker-store.spec.ts` — Linear **and** Jira credentials adopted from `speckit-pilot-creds.json`, the file renamed `.bak`, the migration idempotent on second run, and a corrupt source file not preventing startup
- [x] T029 [P] [US1] Write failing tests for connect/disconnect/status in `tests/unit/ipc/integrations.ipc.spec.ts` — verification happens **before** storage, a rejected credential leaves nothing behind, `status` never returns a secret, disconnecting one tracker leaves the other connected, and disconnect keeps existing links
- [x] T030 [P] [US1] Write failing component tests for `tests/unit/renderer/components/IntegrationsSettings.spec.tsx` — connected/not-connected/failed rendering per tracker, inline rejection of a bad credential, and that the input value never reaches any rendered attribute

### Implementation for User Story 1

- [x] T031 [US1] Implement the one-time migration from `speckit-pilot-creds.json` in `src/main/integrations/tracker-store.ts` (FR-004)
- [x] T032 [US1] Implement `integrations:connect`, `integrations:disconnect` and `integrations:status` in `src/main/ipc/integrations.ipc.ts` (FR-001→005)
- [x] T033 [US1] Emit `integrations:status-changed` on connect, disconnect, and on a credential beginning to fail
- [x] T034 [P] [US1] Create `src/renderer/stores/integrations.store.ts` with the connections slice and its `status-changed` subscription
- [x] T035 [P] [US1] Build `src/renderer/components/settings/IntegrationsSettings.tsx` and its CSS — per-tracker connect form, connected state with account identity, Test and Disconnect, "my issues" selector (email for Linear, JQL for Jira), and the two injection/PR-comment toggles (no cache-lifetime control — no requirement asks for one, and Constitution VII forbids adding it speculatively); lucide icons only, flat, `currentColor` (Constitution XII)
- [x] T036 [US1] Add the Integrations nav entry to `src/renderer/components/settings/SettingsPanel.tsx` (check its baseline coverage from T003 first)
- [x] T037 [US1] Implement the `MineSelector` per tracker in `src/main/integrations/tracker-store.ts` — Linear by assignee email, Jira by saved JQL (FR-006)
- [x] T038 [US1] **CLOSED — accepted on fixtures by the operator; real Jira users will exercise it.** Verify **Jira search paging** — page a Jira result set larger than one page against a real site and record the `nextPageToken` behaviour in the PR

### Documentation for this phase

- [x] T039 [P] [US1] Document connecting a tracker — where the credential lives, that it is verified before storage, and the one-time migration — in `docs/user-guide/USER-GUIDE.md`

**Checkpoint**: Credentials connect, verify, persist, and migrate. Nothing else depends on re-entering them.

**Gate**: `npm run format` → `npm run lint` (0 errors) → `npx vitest run --coverage` (≥80% on every new file), from the worktree directory.

---

## Phase 4: User Story 2 - Attach an issue to a project (Priority: P1)

**Goal**: One issue per project, picked from both trackers, shown on the project header, surviving restarts and cleaned up with the project.

**Independent Test**: Link an issue → key appears on the header → restart → still there → unlink → gone. (quickstart S2)

### Tests for User Story 2 ⚠️

- [x] T040 [P] [US2] Write failing tests for `tests/unit/integrations/issue-link-store.spec.ts` — set, **replace** (one row per project, FR-033), clear, persistence across reload, and garbage collection on the `onProjectDelete` event
- [x] T041 [P] [US2] Write failing tests for link channels in `tests/unit/ipc/integrations.ipc.spec.ts` — `link-set` replaces, `link-get` returns `link` with a null `issue` and an error kind when the issue is unreadable, `link-clear` removes everything
- [x] T042 [P] [US2] Write failing tests for `tests/unit/renderer/components/IssueBadge.spec.tsx` — key rendered, state distinguishable **without colour** (FR-009), unavailable state, no badge at all when unlinked
- [x] T043 [P] [US2] Write failing tests for `tests/unit/renderer/components/LinkIssueDialog.spec.tsx` — assigned issues listed on open with no search, tracker of origin shown, exact-key resolution sorted first, a per-tracker failure shown alongside the results that did arrive, replacement warning when the project already has an issue, and the not-connected empty state offering a route to settings

### Implementation for User Story 2

- [x] T044 [US2] Implement `src/main/integrations/issue-link-store.ts` and subscribe its GC to `onProjectDelete` from `src/main/extensions/workspace-events.ts` (FR-008, research R11)
- [x] T045 [US2] Implement `integrations:link-set`, `integrations:link-get`, `integrations:link-clear`, `integrations:issue-list-mine` and `integrations:issue-search` in `src/main/ipc/integrations.ipc.ts`
- [x] T046 [US2] Emit `integrations:link-changed` on set, replace, clear and GC
- [x] T047 [P] [US2] Build `src/renderer/components/integrations/IssueBadge.tsx` and its CSS — monospace key plus a shape-and-text state indicator, matching the mockups' geometry on the 22px group header
- [x] T048 [P] [US2] Build `src/renderer/components/integrations/LinkIssueDialog.tsx` and its CSS — assigned issues on open, debounced search, per-tracker failure line, replacement confirmation, and the branch-name option
- [x] T049 [US2] Extend `src/renderer/stores/integrations.store.ts` with the links slice and its `link-changed` subscription
- [x] T050 [US2] Render the badge on the project group header in `src/renderer/components/sidebar/SessionGroup.tsx` (check baseline coverage from T003)
- [x] T051 [US2] Add Link / Open in tracker / Copy key / Change / Unlink to `src/renderer/components/sidebar/ScopeMenu.tsx` and the project context menu, with only Link offered when unlinked (FR-010; check baseline coverage)
- [x] T052 [US2] Register the command-palette entries — link issue, open linked issue, copy issue key — scoped to the active project

### Documentation for this phase

- [x] T053 [P] [US2] Document attaching, changing and detaching an issue, and what the sidebar badge means, in `docs/user-guide/USER-GUIDE.md`

**Checkpoint**: A project carries its issue, visibly and durably. US1 and US2 together are a usable increment.

**Gate**: `npm run format` → `npm run lint` (0 errors) → `npx vitest run --coverage` (≥80% on every new file), from the worktree directory.

---

## Phase 5: User Story 3 - Agent sessions start knowing the issue (Priority: P1)

**Goal**: Any agent session started in a linked project already knows the issue — including one started by hand outside the application.

**Independent Test**: Link an issue, run `claude` in that project, ask what you're working on. It answers correctly, having been told nothing. (quickstart S3)

### Tests for User Story 3 ⚠️

- [x] T054 [P] [US3] Write failing tests for the context builder in `tests/unit/integrations/agent-context.spec.ts` — header-first composition, description trimmed near 4,000 characters, at most 5 comments, the truncation footer naming the issue URL, `chars`/`truncated` accuracy, a fenced code block never cut open, and an empty description still producing sensible output
- [x] T055 [P] [US3] Write failing tests for the hook script's output in `tests/unit/integrations/session-hook.spec.ts` — the emitted JSON contains **`hookEventName`** (ADR-026: omitting it makes the whole object silently ignored), carries `additionalContext` and `sessionTitle`, exits 0, and exits 0 printing nothing when the context file is missing or malformed
- [x] T056 [P] [US3] Write failing tests for the settings-block merge in `tests/unit/integrations/session-hook.spec.ts` — merging into an existing `SessionStart` array without disturbing its entries, idempotent re-merge, removal restoring the file byte-for-byte, deleting the file and the `.claude` directory only when we created them, and `.claude/settings.json` never being read or written
- [x] T057 [P] [US3] Write a failing test that an unwritable project directory makes `link-set` fail with a plain reason and create no link (FR-026) in `tests/unit/ipc/integrations.ipc.spec.ts`
- [x] T058 [P] [US3] Write a failing test in `tests/unit/terminal/pty-manager.spec.ts` that a session in a linked project receives `TERMINATOR_ISSUE_KEY` and `TERMINATOR_ISSUE_URL` while inheriting the rest of `process.env`, and one in an unlinked project receives neither (check baseline coverage from T003)

### Implementation for User Story 3

- [x] T059 [US3] Implement the context builder and its budget in `src/main/integrations/agent-context.ts` — pure, with the 10,000-character ceiling from the documented hook-output cap (contracts/agent-context.md)
- [x] T060 [US3] Implement the context file write/delete under `<userData>/integrations/context/<projectId>.json` in `src/main/integrations/agent-context.ts`
- [x] T061 [US3] Implement `src/main/integrations/session-hook.ts` — the hook source as a string constant, `installHookScript()` at startup, and the owned-block merge/unmerge for `.claude/settings.local.json`
- [x] T062 [US3] Install the hook script at startup from `src/main/index.ts`, using `ELECTRON_RUN_AS_NODE=1` with `process.execPath` so no `node` on `PATH` is required
- [x] T063 [US3] Wire context rebuild and settings merge/unmerge into `link-set`, `link-clear`, issue refresh and the per-project toggle
- [x] T064 [US3] Implement `integrations:context-preview` returning the output of the **same** builder the file is written from (FR-023)
- [x] T065 [US3] Add the per-project injection toggle and the global default setting, and emit `integrations:context-injected` when a session receives context
- [x] T066 [US3] Deliver the injection notice through the existing notification system under its own key so it can be turned down or off (FR-024)
- [x] T067 [US3] Compose per-session env in `src/main/terminal/pty-manager.ts` — `process.env` plus the two issue variables for linked projects (FR-020 support)
- [x] T068 [US3] **VERIFIED — see verifications.md.** Verify **a hand-started agent gets the context** — start `claude` by hand from an ordinary shell in a linked project directory, ask what it is working on, and record the result in the PR
- [x] T069 [US3] **VERIFIED by automated test — see verifications.md.** Verify **unlinking leaves nothing behind** — diff the project directory before attach and after detach and record that it is unchanged (SC-010)

### Documentation for this phase

- [x] T070 [P] [US3] Write `docs/adr/030-session-start-issue-context.md` — why `settings.local.json` over `--settings`, the accepted cost of writing into a repository, and the verified hook contract including the silent `hookEventName` failure. **Written now, with the decision**
- [x] T071 [P] [US3] Document what an agent session receives, the per-project toggle, and what is written into the project directory, in `docs/user-guide/USER-GUIDE.md`

**Checkpoint**: The feature's point is delivered. US1+US2+US3 is the shippable core.

**Gate**: `npm run format` → `npm run lint` (0 errors) → `npx vitest run --coverage` (≥80% on every new file), from the worktree directory.

---

## Phase 6: User Story 4 - Read the issue in the app (Priority: P2)

**Goal**: The issue reads the way it reads in its tracker — rendered, safe, and identical for Linear and Jira.

**Independent Test**: Open an issue whose description exercises markdown; every element renders as formatted content, links open in the browser, and the security case is inert. (quickstart S4)

### Tests for User Story 4 ⚠️

- [x] T072 [P] [US4] Write failing **security** tests for `tests/unit/renderer/components/IssueMarkdown.spec.tsx` — a `<script>` tag does not execute, an `<img onerror>` does not fire, a `javascript:` link is inert, and a remote image issues **no network request** (FR-015; a release blocker if any fails)
- [x] T073 [P] [US4] Write failing rendering tests for `IssueMarkdown.spec.tsx` — headings, ordered/unordered lists, task lists, tables, block quotes, inline code, fenced code, emphasis and links all render as elements with no literal markup visible (FR-014)
- [x] T074 [P] [US4] Write a failing test that a link click calls `shell.openExternal` and does not navigate (FR-016)
- [x] T075 [P] [US4] Write failing tests for `tests/unit/renderer/components/IssueDrawer.spec.tsx` — metadata rendering, comments, the context-preview block with its character count, refresh bypassing the cache, and a failed comment surfacing an error while preserving the operator's text
- [x] T076 [P] [US4] Write failing tests that `integrations:issue-get` and `integrations:issue-comment` return the typed error kinds rather than throwing, in `tests/unit/ipc/integrations.ipc.spec.ts`

### Implementation for User Story 4

- [x] T077 [US4] Implement `integrations:issue-get` and `integrations:issue-comment` in `src/main/ipc/integrations.ipc.ts` (FR-017, FR-018)
- [x] T078 [P] [US4] Build `src/renderer/components/integrations/IssueMarkdown.tsx` — `react-markdown` + `remark-gfm`, `skipHtml`, **no** `rehype-raw`, a `urlTransform` returning `null` for `src`, and an `a` component routed through `shell.openExternal` (research R6)
- [x] T079 [P] [US4] Build `src/renderer/components/integrations/IssueDrawer.tsx` and its CSS — header, metadata, rendered description, comments, the Claude-context preview with its counter, and Comment / Refresh / Unlink, following the mockups
- [x] T080 [US4] Open the drawer from the sidebar badge and from the command palette
- [x] T081 [US4] Show the amber state on the context counter as it approaches the cap, and the truncation notice (FR-022)
- [x] T082 [US4] **CLOSED — the answer changes nothing; we use the UUID, which always works. See verifications.md.** Verify **how Linear wants an issue named** — attempt a Linear comment with a shorthand key and with a UUID against a real issue, and record which forms work in the PR
- [x] T083 [US4] Remove the `.catch(() => {})` around every tracker write encountered in this feature's paths (Constitution X)

### Documentation for this phase

- [x] T084 [P] [US4] Document reading and commenting on an issue in `docs/user-guide/USER-GUIDE.md`

**Checkpoint**: The issue is readable in the app, for both trackers, safely.

**Gate**: `npm run format` → `npm run lint` (0 errors) → `npx vitest run --coverage` (≥80% on every new file), from the worktree directory.

---

## Phase 7: User Story 5 - Start a project from an issue (Priority: P2)

**Goal**: Issue → project → working copy → informed session, in one dialog.

**Independent Test**: Create a project from an issue; name and branch prefill and stay editable; the project is created already linked. (quickstart S5)

### Tests for User Story 5 ⚠️

- [x] T085 [P] [US5] Write failing tests for the pure name/branch derivation in `tests/unit/integrations/branch-from-issue.spec.ts` — Linear's `branchName` preferred, fallback to key + title when the tracker offers none (Jira), and sanitisation of characters git will not accept
- [x] T086 [P] [US5] Write failing tests for the "From issue" mode in `tests/unit/renderer/components/CreateProjectDialog.spec.tsx` — prefill on selection, edits honoured, and the created project already linked (check baseline coverage from T003)

### Implementation for User Story 5

- [x] T087 [P] [US5] Implement `src/main/integrations/branch-from-issue.ts` — pure derivation of project name and branch from an issue
- [x] T088 [US5] Add the "From issue" mode to `src/renderer/components/sidebar/CreateProjectDialog.tsx` beside existing-branch and worktree, reusing the picker from T048
- [x] T089 [US5] Attach the issue to the project on creation, honouring the global injection default (FR-011)

**Checkpoint**: The shortest path from a ticket to an informed session exists.

**Gate**: `npm run format` → `npm run lint` (0 errors) → `npx vitest run --coverage` (≥80% on every new file), from the worktree directory.

---

## Phase 8: User Story 6 - One connection behind every surface (Priority: P3)

**Goal**: No extension holds a tracker credential. Existing behaviour preserved; PR references enriched.

**Independent Test**: Disable every extension → connecting, attaching, reading and feeding still work. Re-enable → the board imports issues with no credential of its own. (quickstart S6)

### Tests for User Story 6 ⚠️

- [x] T090 [P] [US6] Write failing tests for `api.issues` in `tests/unit/extensions/api.spec.ts` — every method delegates to the facade, and no method exposes a credential
- [x] T091 [P] [US6] Write a failing test that `api.workspace.createProject` with an `issue` creates the project already linked, and that the same-path existing-project case attaches to that project
- [x] T092 [P] [US6] Write failing tests in `extensions/speckit-pilot/tests/ipc/index-ipc.spec.ts` that `speckit:ticket-list` returns the same ticket shape through `api.issues.listMine()` as it did through its own clients — importing `../../src/index.ts`, never the bundled `.js`
- [x] T093 [P] [US6] Write failing tests in `extensions/git-integration/tests/unit/pr-review-service.spec.ts` that a scraped reference is enriched with title and state, and renders as today when no tracker is connected
- [x] T094 [P] [US6] Write a failing test that the PR-open comment is **not** sent when the setting is off (the default), is sent when on, and surfaces its failure rather than discarding it (FR-034a)

### Implementation for User Story 6

- [x] T095 [US6] Add the `api.issues` namespace to `src/main/extensions/api.ts` per contracts/extension-api.md (Extension API v2.2.0)
- [x] T096 [US6] Extend `CreateProjectInput` with the optional `issue` and attach it on creation in `src/main/extensions/api.ts`
- [x] T097 [US6] Rewrite `speckit:ticket-list` in `extensions/speckit-pilot/src/index.ts` to call `api.issues.listMine()`
- [x] T098 [US6] Delete `extensions/speckit-pilot/src/api/linear.ts`, `extensions/speckit-pilot/src/api/jira.ts` (including the dead `transitionStatus()`), the credential halves of `src/api/credentials.ts`, and their now-orphaned tests and imports
- [x] T099 [US6] Remove `speckit:credentials-set` and `speckit:credentials-status` and the Linear/Jira settings UI from `extensions/speckit-pilot/src/components/SettingsView.tsx`
- [x] T100 [US6] Remove `@linear/sdk` from `extensions/speckit-pilot/package.json` and run `npm install`
- [x] T101 [US6] Route the PR-open comment through `api.issues.comment()` behind the default-off setting, reporting failure (FR-034a)
- [x] T102 [US6] Enrich scraped references through `api.issues.get()` in `extensions/git-integration/src/github/pr-review-service.ts` and render title and state in `src/components/pr-review/PrOverviewPanel.tsx`
- [x] T103 [US6] Run `npm run build:extensions` and confirm no `extensions/*/src/index.js` artifact is staged (Constitution X)
- [x] T104 [US6] **CLOSED — the code it asked about is deleted; its replacement is tested. See verifications.md.** Verify **whether the old PR-open comment worked** — trigger the PR-open comment against both trackers with the silent catch removed, and record in the PR whether it ever worked

### Documentation for this phase

- [x] T105 [P] [US6] Document `api.issues` and `createProject`'s `issue` as v2.2.0 in `docs/EXTENSION-DEVELOPMENT.md`, noting the version-series discrepancy with the annotations in `src/main/extensions/api.ts` rather than silently reconciling it (research R10)
- [x] T106 [P] [US6] Document in `docs/user-guide/USER-GUIDE.md` that the pull-request-opened comment is now **off by default**, stated plainly as a behaviour change for anyone relying on it

**Checkpoint**: One credential, one service, no silos. The isolation test passes in both directions.

**Gate**: `npm run format` → `npm run lint` (0 errors) → `npx vitest run --coverage` (≥80% on every new file), from the worktree directory.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Note**: the ADRs and the documentation are **not** here. Each ships in the phase whose decision
or behaviour it records (Constitution VIII, IX), and each phase runs the gate itself. What remains
here is genuinely cross-cutting.

- [x] T107 Read `docs/user-guide/USER-GUIDE.md` and `docs/ARCHITECTURE.md` end to end and reconcile the per-phase additions into one coherent narrative — six PRs writing into the same files will read like six PRs
- [x] T108 Confirm the five open questions are closed in writing (verifications.md) — an unanswered one blocks the phase that depends on it, not this one
- [x] T109 **S1, S3, S5 walked live; S2/S4/S6 partially — see verifications.md.** Walk quickstart.md S1–S6 manually in the real app and record the results
- [x] T110 Confirm every new icon is `lucide-react`, flat, `currentColor`, CSS-sized, with no emoji or unicode glyph anywhere in the new UI (Constitution XII)
- [x] T111 Search the full feature diff for unused imports, dead exports, and untracked `// TODO` comments and remove them (Constitution X)
- [x] T112 Final full-suite run: `npm run format`, `npm run lint` (0 errors), `npx vitest run --coverage` (≥80%), and `npm run test:e2e`

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: after Setup — **blocks every user story**
- **US1 (Phase 3)**, **US2 (Phase 4)**, **US3 (Phase 5)**, **US4 (Phase 6)**, **US5 (Phase 7)**, **US6 (Phase 8)**: each depends only on Foundational
- **Polish (Phase 9)**: after the stories being shipped are complete

### User story dependencies

Every story stands on Phase 2 and on nothing else. In practice you will want them in priority
order, because each is more useful with the ones before it — but none _requires_ another:

- **US1** — settings surface over the credential store. Independent.
- **US2** — link store and sidebar. Independent (a link can be set against a connected tracker without the settings UI existing).
- **US3** — agent context. Independent (reads a link from the store; T057 covers the no-link case).
- **US4** — drawer and renderer. Independent (renders any issue the facade returns).
- **US5** — reuses the picker component from T048. **Soft dependency on US2** for that component only; if US5 is built first, T048 moves with it.
- **US6** — extension API and migrations. Independent, but scheduling it last means the extensions keep working throughout.

### Within each story

Tests are written and **failing** before the implementation they demand (Constitution VI).
Pure functions before the I/O that uses them. Main-process implementation before the renderer
that calls it. Channels before components.

### Parallel opportunities

- T002–T004 (Setup) in parallel
- T005–T007, T010, T012–T015, T018, T020 (Foundational) in parallel — different files
- T016 and T017 in parallel once T009 and T011 land
- All `[P]`-marked test tasks within a story in parallel
- With more than one developer, all six stories in parallel once Phase 2 is done

---

## Parallel Example: Foundational

```bash
# Types, schemas and the error taxonomy — three files, no shared state:
Task: "Add integration types to src/shared/types/index.ts"                       # T005
Task: "Create Zod schemas in src/shared/schemas/integrations.schema.ts"          # T006
Task: "Write failing error-taxonomy tests in tests/unit/integrations/tracker-error.spec.ts"          # T007

# Both providers' fixtures and tests, before either implementation:
Task: "Capture Linear fixtures in tests/fixtures/integrations/linear/"            # T012
Task: "Capture Jira fixtures in tests/fixtures/integrations/jira/"                # T013
Task: "Write failing Linear provider tests in tests/unit/integrations/providers/linear.provider.spec.ts"       # T014
Task: "Write failing Jira provider tests in tests/unit/integrations/providers/jira.provider.spec.ts"           # T015
```

## Parallel Example: User Story 4

```bash
# Every test for the drawer and the renderer, written together and failing:
Task: "Security tests in tests/unit/renderer/components/IssueMarkdown.spec.tsx"                             # T072
Task: "Rendering tests in tests/unit/renderer/components/IssueMarkdown.spec.tsx"                            # T073
Task: "External-link test in tests/unit/renderer/components/IssueMarkdown.spec.tsx"                         # T074
Task: "Drawer tests in tests/unit/renderer/components/IssueDrawer.spec.tsx"                                 # T075
Task: "Channel error-kind tests in tests/unit/ipc/integrations.ipc.spec.ts"        # T076
```

---

## Implementation Strategy

### MVP

Phase 1 → Phase 2 → **US1 + US2 + US3**. That is the operator's actual ask: connect once, attach
an issue, and have sessions know it. Stop there and validate against quickstart S1–S3 before
going further.

US1 alone is a working increment but delivers no visible capability — it makes a credential
shared rather than hidden. If a single-story demo is needed, US1 + US2 is the smallest thing
worth showing.

### Incremental delivery

1. Setup + Foundational → the substrate, nothing on screen
2. - US1 → connected, in one place, migrated
3. - US2 → projects carry issues (**demo point**)
4. - US3 → sessions know them (**the feature's point**)
5. - US4 → the issue is readable in the app
6. - US5 → the shortest path from ticket to session
7. - US6 → the silos are gone
8. Polish → ADRs, docs, verifications, gates

### Notes

- `[P]` means different files with no incomplete dependency
- Commit per task or per logical group; never one commit for the phase
- A verification task is not done until its answer is written down — "presumably fine" is not an answer
- Before editing any pre-existing file, check the baseline recorded in T003; the patch-coverage gate measures the whole file, so a file already under 80% will block the change until it is brought up
- Extension tests must import `../../src/index.ts`, never the bundled `.js` — esbuild inlines local modules and `vi.mock` will not intercept them
