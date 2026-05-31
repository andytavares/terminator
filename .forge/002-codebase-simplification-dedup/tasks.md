# Tasks — 002-codebase-simplification-dedup

<!-- find-reuse: all behaviors are deduplication targets — the implementations already exist inline at the sites listed. No external library or existing helper covers any of these patterns. -->

---

## T-001 — Extract shared git environment constant

**Description:** Three sites in the git service module each inline the same process environment object to suppress interactive git prompts. Extract it to a single exported constant in its own module so there is one authoritative definition and all callers import it. The `getStatus` function must keep its own `execFile` call (its output format is incompatible with the existing helper's stdout trimming) but must still use the shared constant for the environment.

**Acceptance criteria:**

- The string `GIT_TERMINAL_PROMPT` appears as a value assignment in exactly one source file.
- All git-service call sites that previously inlined the environment object compile and pass existing tests without modification.
- A build targeting the main process (`npm run build`) succeeds with no type errors.

**Depends on:** (none)
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-002 — Deduplicate reserved keyboard shortcuts into shared module

**Description:** The set of accelerator strings that extensions are forbidden from registering is declared identically in two separate main-process modules, with no shared source. Move the canonical declaration to a new shared module inside the main process and import it in both places. The shared module must contain only plain data (no Node.js-only APIs) so it remains safe to import from the Electron preload context.

**Acceptance criteria:**

- Searching the source for the `RESERVED_SHORTCUTS` variable declaration finds exactly one definition.
- `window.electronAPI.keyboard.isReserved('CmdOrCtrl+T')` returns `true` at runtime (no behavior change).
- A unit test on the shared module covers: every member of the set returns `true` from a `.has()` call; a non-member returns `false`.
- `npm run build` and `npm run build:extensions` both succeed.

**Depends on:** (none)
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-003 — Add `resolveActiveCwd` selector to workspace store

**Description:** The logic that resolves the current working directory for a new terminal session — preferring a project's worktree path, then the workspace folder, then a fallback — is copy-pasted at five separate call sites across the keyboard shortcut hook and the root app component. Add this computation as a single method on the workspace store so all callers share one authoritative implementation. Callers no longer need to destructure the raw project and workspace collections to perform the computation themselves.

**Acceptance criteria:**

- The pattern `worktreePath ?? activeWorkspace?.folderPath` does not appear in `useKeyboardShortcuts` or `App`.
- When the active project has a `worktreePath`, `resolveActiveCwd()` returns that path.
- When the active project has no `worktreePath`, it returns the workspace `folderPath`.
- When neither exists, it returns `'~'`.
- All three branches are covered by unit tests.
- Lint passes with zero errors.

**Depends on:** (none)
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-004 — Extract bell notification handler in terminal session hook

**Description:** The callback that fires a bell notification when a terminal session rings is copy-pasted between the new-session path and the split-session path in the terminal session hook. The split-session copy also silently omits the active-session guard that prevents redundant notifications when the user is already looking at that terminal — a latent bug. Extract a factory function that produces the callback with the full guard, and replace both sites with a call to it.

**Acceptance criteria:**

- The notification dispatch logic (the string that identifies a bell notification body) appears exactly once in the terminal session hook file.
- When a session rings and it is the currently active session in the active project, no notification is created — for both new sessions and split sessions.
- When a session rings and it is in a non-active project, a notification is created — for both new sessions and split sessions.
- The above behaviors are covered by unit tests.

**Depends on:** (none)
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-005 — Remove dead `open-settings` DOM event listener

**Description:** The root app component registers a DOM custom-event listener for `open-settings` that has no dispatch site anywhere in the codebase. The settings panel is opened exclusively via an Electron IPC event through the extension events bridge. The dead listener adds noise and could mislead future engineers into believing the DOM event path is intentional. Remove it entirely.

**Acceptance criteria:**

- No `window.addEventListener` call for `'open-settings'` exists in the renderer source.
- The Settings panel opens correctly when triggered via the application menu.
- `npm run lint` passes with zero errors.

**Depends on:** (none)
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-006 — Simplify metrics store polling state machine

**Description:** The metrics store uses two independent boolean flags to track a single polling lifecycle, causing `stopPolling` to call `startPolling` internally when global metrics are active — an inversion that makes the control flow hard to follow and easy to break. Refactor so `stopPolling` owns its own system-only poll loop branch directly, without delegating back to `startPolling`. Also guard `enableGlobalMetrics` against starting a second interval if one is already running. The public interface (`startPolling`, `stopPolling`, `enableGlobalMetrics`, `disableGlobalMetrics`) must remain unchanged so callers are unaffected.

**Acceptance criteria:**

- `stopPolling` does not call `startPolling` in any code path.
- When `globalMetricsEnabled` is `true` and `stopPolling` is called, system metric polling continues and per-process metrics are cleared.
- When `globalMetricsEnabled` is `false` and `stopPolling` is called, the interval is cleared and system metrics reset to `null`.
- Calling `enableGlobalMetrics` twice does not create two concurrent polling intervals.
- All four behaviors are covered by unit tests.

**Depends on:** (none)
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-007 — Fix `terminalInstances` map type in session store

**Description:** The session store's map of terminal instances is typed as `Map<string, unknown>`, which forces every consumer to apply an explicit type cast to retrieve an instance. Change the type to the correct concrete type so the type system enforces correctness automatically and call-site casts can be removed. The import must be a type-only import to avoid pulling the xterm DOM module into unit test environments where it is unavailable.

**Acceptance criteria:**

- `getTerminalInstance` (or direct map access) at the three known call sites returns a correctly-typed value with no explicit type cast.
- All existing tests for the session store and its consumers continue to pass.
- `npm run build` succeeds with no type errors.

**Depends on:** (none)
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-008 — Clean up TerminalSession canvas helpers and null cast

**Description:** Two methods in the terminal session class independently perform identical canvas font measurement (creating a canvas, setting a font string, calling `measureText`) to determine character width. Extract this into a single helper function. Separately, a type cast that forces a `null` value to satisfy a non-nullable type — hiding correct null-handling behavior from the type system — should be replaced with an explicit nullable type and a safe call-site adaptation. Both changes are in the same class file and have no independent acceptance criterion so they are a single task.

**Acceptance criteria:**

- The canvas `measureText('M')` call appears exactly once in the terminal session file.
- The forced `null as unknown as` cast no longer exists in the file.
- `npm run lint` passes with zero errors.
- Terminal canvas preview rendering is unchanged (no visual regression).

**Depends on:** (none)
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no
