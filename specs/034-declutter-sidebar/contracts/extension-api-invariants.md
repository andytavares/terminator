# Contract: what this feature must NOT change

**Feature**: `034-declutter-sidebar`

FR-037 says the contribution contracts by which extensions register surfaces are unchanged — only where and how densely they are drawn may change. This document is the list, because the sidebar is the host for five contribution points and this feature rebuilds the host.

Constitution Principle II runs in both directions: an extension may not reach into core, and **core may not read, call, or special-case any extension**. Nothing below may grow a branch that names a specific extension.

---

## Unchanged registration surfaces

| Contribution  | Registered by                           | Rendered by, before                         | Rendered by, after             |
| ------------- | --------------------------------------- | ------------------------------------------- | ------------------------------ |
| Global tab    | `contributes.globalTab` in the manifest | `AppBand`, icon + 8px label                 | `AppBand`, icon only + tooltip |
| Sidebar item  | `api.sidebar.registerItem()`            | `AppBand`, same band                        | `AppBand`, same band           |
| Workspace tab | `api.sidebar.registerWorkspaceTab()`    | hover icons on the first group of each repo | hover icons on the repo header |
| Sidebar panel | `api.sidebar.registerPanel(slot)`       | unchanged                                   | unchanged                      |
| Command       | `api.commands.registerCommand()`        | palette                                     | palette                        |

**Invariant EA-1**: The signature, arguments and semantics of every function above are byte-identical before and after. This feature changes render targets and density only — which the codebase has already done once, without a contract change, in ADR-033.

**Invariant EA-2**: An extension that registers a global tab and a workspace tab must render, be reachable, and be operable by keyboard after this feature, with no change to the extension.

**Invariant EA-3**: `registry.ts`'s maps — `globalTabs`, `workspaceTabs`, `projectTabs`, `sidebarButtons`, `sidebarPanels`, `commands` — keep their shapes. Tab activation mutual-exclusion (`activeGlobalTabId` / `activeWorkspaceTabId` / `activeProjectTabId`) is unchanged.

**Invariant EA-4**: A contribution with no icon still falls back to a lucide `Square`. Losing the text label must not lose the accessible name — every band entry keeps `aria-label` and `title` (FR-036).

**Verification**: `tests/unit/renderer/components/extension-surfaces.spec.tsx` already exercises this and must pass unmodified except where it asserts the presence of the 8px text label. That one assertion changes to assert an accessible name instead — and that is the only permitted edit to it. If any other assertion needs changing, a contract has moved and the change is out of scope.

---

## Unchanged published token contract

`--tm-*` tokens in `src/renderer/styles.css` are the stable, versioned API extensions consume (`docs/EXTENSION-DEVELOPMENT.md`, `specs/003-pr-review/contracts/extension-token-api.md`).

**Invariant EA-5**: No `--tm-*` token is removed, renamed, or given a different meaning. This feature touches core-private `--bg-*` / `--text-*` usage inside sidebar components only.

**Invariant EA-6**: `--ws-color` is core-private and not part of the published contract, so narrowing its use from four washes to one rail is not a contract change. Extensions must not be reading it; if one is, that is a Principle II violation on the extension's side and is out of scope here.

---

## Unchanged IPC and stored data

**Invariant EA-7**: No IPC channel is added, removed, or changed in shape. This feature is renderer-only.

**Invariant EA-8**: `Workspace`, `Project` and `TerminalSession` in `src/shared/types/index.ts` are unchanged. There is no migration. A user downgrading loses the board's lane-visibility preference (a `localStorage` key) and nothing else.

**Invariant EA-9**: `api.project.*` keeps the name `Project`. The product says "branch", the code says `Project`, and renaming would break installed extensions for no user-visible gain (ADR-032). The lint rule on `src/renderer/components/**` that fails the build when "project" reaches JSX text, a `label:`, or a `placeholder`/`title`/`aria-label` stays on and applies to every new component this feature adds.

---

## The isolation test

Before this feature is complete, the question from Principle II must still answer yes:

> If any extension directory were deleted, would the core application still build and run without modification?

The sidebar rebuild must not introduce a single import, type reference, string literal, or conditional in `src/` that names a specific extension.
