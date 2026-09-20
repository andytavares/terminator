# 057 — Quick Actions

## Problem

Terminator has two ways to act without the mouse: the command palette (`⌘P`, `src/renderer/components/CommandPalette.tsx`) and roughly twenty hard-coded shortcuts (`src/renderer/hooks/useKeyboardShortcuts.ts`, plus menu accelerators in `src/main/index.ts`). The user has never opened the palette and cannot remember which shortcut does what. Recall is the failure, not a missing feature.

The palette is also incomplete and partly broken, which the ask did not mention:

- **Unreachable from extension views.** Extension UI is an overlaid `WebContentsView`. `src/main/preload-webview.ts` forwards only Escape, and `extension-view-host.ts` has no `before-input-event` hook, so `⌘P` does nothing while focus is in Notes, Task Vault, Foundry or Git.
- **Manifest commands never reach it.** `notepad:quick-create` ("New Note") and `task-vault:capture-to-inbox` are declared in their `manifest.json`. `src/renderer/extensions/loader.ts:82` reads manifest `commands` only to bind a shortcut, and only when the extension has a sidebar panel. `listExtensionCommands()` (`src/main/extensions/api.ts:657`) returns only `api.commands.register` calls, and only Foundry makes any.
- **`api.keyboard.register` is dead.** It stores handlers in `globalRegistry.keyboardHandlers` (`api.ts:1017`) and nothing reads them. No extension calls it.
- **Git contributes no commands**, and extension command handlers take no arguments. The Extension API does not expose the focused branch or worktree, so a "Push" command cannot know what to push.
- **Coverage gaps.** Home (`⌘\``), Close tab (`⌘W`), Clear (`⌘K`), cycle recent (`⌘]`/`⌘[`), next waiting (`⌘⇧A`), edit note (`⌘I`), cycle tabs (`⌘←/→`), and every extension tab (Notes, Task Vault, Vault Calendar, Foundry, Code Reviews, Git) are missing from the palette.
- **Search matches the label only** (`fuzzyMatch(query, item.label)`), not the category or description.
- **Doc drift.** `docs/adr/027-flat-session-list-view-model.md:62` and a comment in `CommandPalette.tsx` say `⌘K` opens the palette. It is `⌘P`; `⌘K` clears the terminal. `App.tsx` passes `onOpenHome` to `useKeyboardShortcuts`, whose `Options` does not declare it (hidden because `npm run typecheck` checks nothing).

## Decisions (from interview, 2026-09-19)

| #   | Decision                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Replace the palette with a **leader + which-key panel**: `⌘P` opens a panel of grouped actions, each with a one-letter mnemonic. A letter acts immediately (`g` opens the Git group, then `p` pushes).   |
| D2  | `⌘P` stays the leader. `⌘K` stays Clear terminal.                                                                                                                                                        |
| D3  | `/`, or pressing `⌘P` again inside the panel, switches to fuzzy search over label, category and description.                                                                                             |
| D4  | Ranking: **frecency plus pins.** Pinned actions sit first, then the top frecency actions in a "Recent" row. Usage is stored locally in core settings.                                                    |
| D5  | **Context first, everything reachable.** The active surface's group and actions on the focused session rank first. An action that cannot run is shown dimmed with its reason, never hidden.              |
| D6  | **Custom actions ship in v1**: shell commands and agent prompts, defined in Settings, global or per-workspace.                                                                                           |
| D7  | Each custom action has a target: the focused terminal, a new tab on the focused branch, or the focused Claude session (prompts only). Variables: `{cwd} {branch} {worktree} {repo} {issue} {selection}`. |
| D8  | v1 extension coverage: Git, Notepad, Task Vault, Foundry.                                                                                                                                                |
| D9  | Recall aids: a rail button, a "Next time: ⌘D" toast, and a mention on the empty state and Home.                                                                                                          |

## Goals

1. One key (`⌘P`) opens a panel that lists every common action on screen, with its mnemonic and any direct shortcut, from any focus: terminal, text field, core screen, or extension view.
2. Complete coverage of core actions and of the v1 extensions' actions.
3. The actions you use most sit on the first screen without any setup.
4. You can add your own shell and prompt actions.
5. Direct shortcuts are taught, not memorised.

## Non-goals (deferred, with reasons)

- **Remote Control actions.** Not selected for v1. Its extension can adopt the same API later without core changes.
- **The remote web/phone client** (`src/renderer-remote/`). Its input is touch, so it needs its own design. It keeps its current UI.
- **Rebinding mnemonics or shortcuts.** A fixed map ships first, checked for conflicts by a test. Rebinding needs conflict detection against menu accelerators and `RESERVED_SHORTCUTS`, which is a separate feature.
- **Repo-file custom actions** (`.terminator/actions.json`). They would execute repo-supplied commands and need a trust model. v1 defines actions in Settings only.
- **Multi-step parameterised built-ins** (e.g. "new worktree from branch…" with a picker). v1 actions either run or navigate to the surface that asks.

## Design

### Action model (core, renderer)

A single `QuickAction` replaces the palette's `CommandRegistration`/`PaletteItem` split:

```ts
interface QuickAction {
  id: string // 'core.new-tab', 'ext:<extId>.command.<id>', 'custom:<uuid>', 'session:<id>'
  label: string
  group: string // group id: 'terminal' | 'sessions' | 'workspace' | 'goto' | 'custom' | ext group
  key?: string // one-char mnemonic within its group
  shortcut?: string // direct shortcut display, e.g. '⌘D'
  description?: string
  disabledReason?: string // set → shown dimmed, Enter shows the reason, never runs
  run(ctx: ActionContext): void | Promise<void>
}
interface ActionContext {
  projectId: string | null
  sessionId: string | null
  repoRoot: string | null
  agentState: AgentState | null
}
```

The registry lives in `src/renderer/extensions/registry.ts` (it replaces `commands`/`registerCommand`; `updateCommand` keeps its callers). Ranking is a pure module, `src/renderer/quick-actions/rank.ts`: pins → context group → frecency → alphabetical.

### Top-level groups (core-owned letters)

| Key   | Group / action           | Contents                                                                                                                                                     |
| ----- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `t`   | Terminal…                | `t` new tab ⌘T · `d` split right ⌘D · `D` split down ⌘⇧D · `w` close ⌘W · `k` clear ⌘K · `n` new scratch ⌘⇧T · `i` edit note ⌘I · `[`/`]` prev/next tab ⌘←/→ |
| `s`   | Sessions…                | open sessions (existing palette source), searchable; `a` next waiting ⌘⇧A; `r` resume (055)                                                                  |
| `w`   | Workspace…               | `1`–`9` switch ⌘1–9, `=`/`-` cycle, `l` link issue, `v` view issue, `o` open issue                                                                           |
| `h`   | Home ⌘\`                 | direct                                                                                                                                                       |
| `o`   | Overview ⌘⇧E             | direct                                                                                                                                                       |
| `a`   | Next waiting session ⌘⇧A | direct                                                                                                                                                       |
| `x`   | Custom…                  | user actions                                                                                                                                                 |
| `,`   | Settings ⌘,              | direct                                                                                                                                                       |
| `b`   | Toggle sidebar ⌘B        | direct                                                                                                                                                       |
| `/`   | Search                   | switches to fuzzy mode                                                                                                                                       |
| other | extension groups         | allocated below                                                                                                                                              |

**Go to** entries (Notes, Task Vault, Vault Calendar, Foundry, Code Reviews, Git) are generated from the registered global, workspace, project and sidebar surfaces, so core never names an extension (Constitution II). They appear in the owning extension's group as `Open <label>`.

### Extension contract (Extension API minor bump, documented in `docs/EXTENSION-DEVELOPMENT.md`)

- A manifest can declare `contributes.quickActions.group: { key, label }`. Core letters are reserved. Between extensions, load order wins, and the loser gets the first free letter of its label, logged via `api.log`.
- `CommandContribution` (`src/main/extensions/api.ts:95`) gains `key?: string`.
- Handlers receive `ActionContext` (core-owned data, passed outbound): `handler(ctx) => void`. Existing zero-arg handlers keep working.
- New `api.commands.setEnabled(id, enabled, reason?)` feeds `disabledReason`.
- Manifest `contributes.commands` are registered as actions whose handler is the extension's `commands.register` for the same id. An id that is declared but never registered shows dimmed: "Extension did not register this command".
- `executeExtensionCommand(key)` (`api.ts:675`) takes `ctx`. The IPC is `extension:execute-command` via `src/shared/electron-api/manifest.ts`.

### Reaching the panel from extension views

`extension-view-host.ts` attaches `webContents.on('before-input-event')` to each extension view. On `⌘P` it calls `preventDefault()` and sends `quick-actions:open` to the main window, which focuses it and opens the panel. The panel's Esc closes the panel. It must not also count toward the double-Escape exit, so the panel claims Escape through the existing `modal` signal used by `useModalEffect`.

### v1 extension actions

| Group            | Actions                                                                                                                                                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git (`g`)        | `c` commit (opens the Git tab with the message box focused), `p` push, `l` pull, `r` create PR, `o` open Git tab, `v` open Code Reviews. Push and pull run in `ctx.repoRoot` and report the result as a toast. Each is disabled with a reason when `ctx.repoRoot` is null or not a git repo. |
| Notes (`n`)      | `n` new note (the same path as the ⌘⇧N menu item), `o` open Notes                                                                                                                                                                                                                            |
| Task Vault (`v`) | `c` capture to inbox (the same `openCaptureOverlay` as the global hotkey), `o` open Task Vault, `k` open calendar                                                                                                                                                                            |
| Foundry (`f`)    | `n` new work order, `o` open Foundry, `w` jump to the run that needs you (its existing go-to-run commands move into this group)                                                                                                                                                              |

### Custom actions

- Stored in `GlobalSettings.quickActions.custom[]` and in `WorkspaceSettings.overrides.quickActions.custom[]`. Workspace actions are listed after global ones and are not merged by id.
- Shape: `{ id, label, key?, kind: 'shell' | 'prompt', target: 'focused' | 'new-tab' | 'agent', body, scope }`.
- Edited in a new **Quick Actions** section of `src/renderer/components/settings/` (global and workspace tabs), using `@terminator/extension-ui` form components where the core already uses them.
- Variables are expanded at run time. A variable that has no value (e.g. `{issue}` with no linked issue) disables the action with the reason "No linked issue". The body never runs with an empty string substituted.
- **Refusals.** A shell action targeting the focused terminal is refused when that terminal is an agent session ("Focused terminal is running Claude, use a new tab"). A prompt action is refused when the focused session is not an agent, or its `agentState` is `working` ("Claude is mid-turn").
- **Length.** Prompts are written as bracketed paste followed by Enter. A shell body longer than 1024 bytes after expansion is refused with the reason, because PTY `MAX_CANON` silently mangles longer typed lines (see the memory note `project_pty_max_canon_truncates_launches`).

### Frecency, pins and hints

- `GlobalSettings.quickActions: { pins: string[], usage: Record<actionId, { count, lastUsedAt }>, directUse: Record<actionId, number>, custom: [] }`.
- Usage entries for ids that no longer exist (an uninstalled extension, a deleted custom action) are ignored when ranking and pruned on save.
- Pin and unpin from the panel with `⌘.` on the highlighted row.
- **Hint toast.** When an action that has a direct shortcut runs from the panel, and `directUse[id] < 3`, show "Next time: ⌘D". Direct-shortcut paths increment `directUse`: `useKeyboardShortcuts.ts`, the menu-accelerator IPC handlers in `App.tsx` (`menu:open-home`, `menu:close-tab`, `menu:toggle-sidebar`, `menu:open-settings`), and extension shortcuts.

### Recall surfaces

- A flat lucide `command` icon button in `src/renderer/components/sidebar/AppBand.tsx`, with the tooltip and accessible name "Quick actions (⌘P)".
- `EmptyState.tsx` and the Home screen (`src/renderer/components/home/`) show "⌘P Quick actions".

### `api.keyboard.register`

See Open decisions.

## Files involved

- `src/renderer/components/CommandPalette.tsx` + `.css` → replaced by `src/renderer/components/QuickActions.tsx` + `.css`
- `src/renderer/extensions/registry.ts`, `src/renderer/extensions/loader.ts`
- `src/renderer/App.tsx` (`builtinCommands`, `paletteCommands`, menu IPC handlers, panel mount)
- `src/renderer/hooks/useKeyboardShortcuts.ts` (direct-use counting, `onOpenHome` in `Options`)
- `src/renderer/quick-actions/{rank,custom-actions,variables}.ts` (new)
- `src/renderer/components/sidebar/AppBand.tsx`, `src/renderer/components/EmptyState.tsx`, `src/renderer/components/home/*`
- `src/renderer/components/settings/{SettingsPanel,GlobalSettings,WorkspaceSettings}.tsx` + new `QuickActionsSettings.tsx`
- `src/shared/types/index.ts` (`GlobalSettings.quickActions`), `src/shared/schemas/extension.schema.ts` (`quickActions.group`, `commands[].key`)
- `src/main/extensions/api.ts` (`CommandContribution.key`, ctx handler, `setEnabled`, manifest commands), `src/main/extensions/extension-view-host.ts` (`before-input-event`), `src/main/preload.ts`, `src/shared/electron-api/manifest.ts`
- `extensions/git-integration/{manifest.json,src/index.ts}`, `extensions/notepad/{manifest.json,src/index.ts}`, `extensions/task-vault/{manifest.json,src/index.ts}`, `extensions/foundry/{manifest.json,src/index.ts}`
- Docs: `README.md`, `docs/ARCHITECTURE.md`, `docs/EXTENSION-DEVELOPMENT.md`, `docs/user-guide/`, new `docs/adr/057-quick-actions-are-a-leader-panel.md`, a fix to ADR 027's `⌘K` line

## Acceptance criteria

Each criterion can be false. The check that proves it follows the arrow.

1. `⌘P` opens the panel from a focused terminal, a text field, Home, Overview, and each extension view (Notes, Task Vault, Foundry, Git). → e2e `tests/e2e/quick-actions.spec.ts`: for each surface, focus it, press `⌘P`, and assert `getByRole('dialog', { name: 'Quick actions' })` is visible. The extension-view cases send the key via `webContents.sendInputEvent`.
2. At the top level, `t` then `d` splits the focused pane, and the panel closes. → e2e: pane count goes from 1 to 2.
3. `/` switches to search, and typing "push" lists "Git: Push" (matched through its category). → unit `QuickActions.spec.tsx`.
4. Every shortcut bound in `useKeyboardShortcuts.ts` and every menu accelerator in `src/main/index.ts` has a matching action showing that shortcut. → unit test that enumerates both sources and fails on any accelerator with no action.
5. No two actions in one group share a mnemonic, and no extension group takes a core letter. → unit test over the built registry, with two fixture extensions requesting the same letter.
6. "New Note" and "Capture to Inbox" appear and run. → e2e: run each; assert the Notepad quick-create dialog and the Task Vault capture overlay are visible (read via `electronApp.evaluate` over `getAllWebContents`).
7. Git Push runs in the focused worktree and toasts the result. With no repo focused, it is dimmed with a reason and Enter does not run it. → extension unit test of the handler with a `ctx`; e2e on a temp repo with a bare remote, where `git rev-parse origin/<branch>` equals `HEAD` afterwards.
8. After running an action 3 times, it appears in the Recent row. After a pin, it sits first. Both survive an app restart. → e2e with reload; unit `rank.spec.ts` for ordering.
9. With a Foundry view active, the Foundry group ranks first. → unit `rank.spec.ts`.
10. A custom shell action `echo {branch}` targeting a new tab opens a tab in the focused worktree, and its output contains the branch name. → e2e reads the terminal buffer.
11. A custom prompt action is refused with "Claude is mid-turn" when the focused agent is `working`, and is refused with a reason when the focused terminal is not an agent. → unit `custom-actions.spec.ts`.
12. `{issue}` with no linked issue disables the action with "No linked issue". → unit `variables.spec.ts`.
13. A shell body over 1024 bytes after expansion is refused, and nothing is written to the PTY. → unit, asserting `terminal.input` was not called.
14. Running Split from the panel shows "Next time: ⌘D". After three direct `⌘D` presses it no longer shows. → unit on the hint logic; e2e once for the toast's visibility.
15. Esc in the panel closes only the panel. A second Esc within the double-Escape window does not exit the extension underneath. → e2e on the Notes view.
16. The AppBand button has the accessible name "Quick actions (⌘P)", opens the panel, and its icon has no colour CSS. → unit + lint of the icon class.
17. Project gate: `npm run format && npm run lint && npx vitest run --coverage` exits 0 with ≥80% patch coverage, and `npm run test:e2e -- quick-actions` exits 0. → exit codes recorded in the PR.

## Resolved decisions (2026-09-19, at /do-work)

1. `api.keyboard.register` is **deleted** (API changelog note). `commands.register({ shortcut })` covers it.
2. Pinning: **both** `⌘.` on the highlighted row and a pin icon on hover.
3. Naming: the mnemonic field is `mnemonic` everywhere (`key` already names the registry key `<extId>.command.<id>`). Manifest: `contributes.quickActions.group: { mnemonic, label }`, `commands[].mnemonic`.
4. `CommandContribution.requires?: 'repo' | 'session'`: core dims the action with "No repository focused" / "No terminal focused" from the context, so extensions need no per-focus `setEnabled` calls.
5. `api.window.showSelf(view?)` (new): asks core to bring forward whichever surface the extension registered for that view (global, workspace, project tab or sidebar panel). Extension actions such as Git "Commit…" need it; core's generated "Open <surface>" actions use the same renderer path.
6. "Open <surface>" actions are generated by core only; extensions do not register their own.
7. ADR 027 is immutable. Its stale `⌘K` line is superseded by ADR 057 rather than edited.
8. Usage, direct-use counts and pins persist as arrays, because `deepMerge` in `src/main/storage/settings-store.ts` replaces arrays but cannot delete record keys, and pruning needs deletes.

## End-to-end verification

On a packaged dev build (`npm run dev`, driven with Playwright `launchApp`), against a temp repo with a bare remote and all v1 extensions enabled:

1. Focus the Notes view. Press `⌘P`, then `g`, then `p`. Confirm the push toast, and that `git -C <worktree> rev-parse HEAD` equals `origin/<branch>`.
2. Press `⌘P`, `n`, `n`. The quick-create dialog is visible.
3. Add a custom shell action `echo {branch}` in Settings. Press `⌘P`, `x`, then its key. A new tab shows the branch name.
4. With an agent session mid-turn, run a custom prompt action. It is refused with "Claude is mid-turn".
5. Run Split from the panel three times, then restart the app. The panel's Recent row shows Split. The "Next time: ⌘D" toast shows until `⌘D` has been pressed directly three times.
6. Screenshot the panel in dark and light themes (the extension view via `capturePage`, the main window via Playwright), and attach the screenshots to the PR.

### Coverage in `tests/e2e/quick-actions.spec.ts`

1. ✅ split across two tests rather than one combined flow: Push against a real bare remote is verified (`git rev-parse HEAD` = `origin/main` after the toast), and `⌘P` from inside the Notes view (via `sendInputEvent` into its `WebContentsView`) is verified separately, with Escape closing only the panel. Not verified as a single "push while Notes has focus" sequence.
2. ✅ as written.
3. ✅ the custom action is added through the real Settings UI (`#qa-action-*` fields, addressed by id — a `label`/role locator was impractical for the `<select>` target field), not seeded over IPC.
4. ❌ not covered end-to-end. A custom prompt action refused with "Claude is mid-turn" needs a live agent session genuinely mid-turn; driving a real `claude` process into that state reliably from Playwright was out of scope for this pass. Covered by the existing unit suite (`custom-actions.spec.ts`), per AC 11.
5. ✅ (partial by design, matching AC 14's own split): Split run three times → appears in "Pinned & recent"; `⌘.` pins it; the pin is first after a real app restart (`closeApp` + `launchApp` on the same profile). The toast is asserted once for visibility (AC 14 assigns the 3-presses-then-stops decay to the unit suite, not e2e).
6. ✅ dark and light, top level and the Git group, `test-results/quick-actions/*.png` — the main window only; there is no extension-view content in the Quick Actions panel itself (it renders in the host window, not a `WebContentsView`), so `capturePage` was not needed.

Two real product bugs were found by this suite and fixed (see the PR / CHANGELOG): Escape did not close the panel while a terminal had focus (focus never moved into the panel), and any action with no mnemonic rendered its label clipped to one letter (the row's 3-column grid collapsed to 2 children).
