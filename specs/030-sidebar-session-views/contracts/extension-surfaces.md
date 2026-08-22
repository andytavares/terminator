# Contract: Extension Surfaces

**This is the acceptance gate for the feature.** Flattening the sidebar removes the elements that two of
these surfaces hang on, and a third has never had a working host at all. Every cell in the matrix below is
asserted by
`src/renderer/components/sidebar/extension-surfaces.spec.tsx`. A failing cell blocks the merge.

## The surfaces that exist

Verified against `src/renderer/extensions/registry.ts` and every `extensions/*/manifest.json`.

| #   | Surface               | Registry field                                                         | Rendered today                                                                     | Real contributors                                                                                         |
| --- | --------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Global tab buttons    | `globalTabs: Map`                                                      | `SidebarHeader.tsx:40-52`, always visible                                          | built-in `core.overview`; `notepad` (Notes), `remote-control` (Remote Control), `task-vault` (Task Vault) |
| 2   | Workspace tab buttons | `workspaceTabs: Map`                                                   | `WorkspaceCard.tsx:121-134`, revealed by `.ws-card__header:hover .ws-card__ws-tab` | `speckit-pilot` (SpecKit), `git-integration` (Code Reviews)                                               |
| 3   | Sidebar items         | `sidebarButtons: []` (renderer) ← `globalRegistry.sidebarItems` (main) | **nowhere — this feature gives it its first host**                                 | `git-integration` ("Git Changes", `src/index.ts:146`)                                                     |
| 4   | Project tabs          | `projectTabs: Map`                                                     | `TabBar.tsx:117`, main area — not the sidebar                                      | `git-integration` (Git)                                                                                   |

**Surface 3 is contributed to today and has never rendered.** `api.sidebar.registerItem` (`api.ts:214,608`,
SDK `api.d.ts:145`, documented at `EXTENSION-DEVELOPMENT.md:187-203`) stores the item in
`globalRegistry.sidebarItems` and exposes it over `extension:get-sidebar-items`; no host-renderer code has
ever read that channel. This feature completes the chain — see [research.md](../research.md) R1-CORRECTION.
Note it is enumerated from the **main-process** API, not the renderer registry: reading only the renderer is
what produced the wrong conclusion in R1.

Sidebar **panels** (`sidebarPanels`, e.g. git-integration's "Git Changes", task-vault's "Vault Calendar")
are a separate mechanism that does not live in the sidebar tree at all: they render in `App.tsx:608-628` and
are toggled by the accelerator registered in `loader.ts:82-91` plus the persisted `openPanels` key. This
feature does not touch them; the regression spec asserts `⌘⇧G` still toggles the Git panel.

## Host matrix — which element hosts each surface, per grouping mode

| Grouping    | 1 · global                  | 2 · workspace tabs                                            | 3 · sidebar items       | 4 · project tabs                |
| ----------- | --------------------------- | ------------------------------------------------------------- | ----------------------- | ------------------------------- |
| `project`   | `SidebarHeader` — unchanged | `SessionGroup` header (hover), on the workspace's first group | `ExtensionFooter`, once | `TabBar`, via `activeProjectId` |
| `workspace` | `SidebarHeader` — unchanged | `SessionGroup` header (hover)                                 | `ExtensionFooter`, once | `TabBar`, via `activeProjectId` |
| `status`    | `SidebarHeader` — unchanged | `ScopeMenu` on the row + row context menu + `⌘K`              | `ExtensionFooter`, once | `TabBar`, via `activeProjectId` |
| `branch`    | `SidebarHeader` — unchanged | `ScopeMenu` on the row + row context menu + `⌘K`              | `ExtensionFooter`, once | `TabBar`, via `activeProjectId` |
| `none`      | `SidebarHeader` — unchanged | `ScopeMenu` on the row + row context menu + `⌘K`              | `ExtensionFooter`, once | `TabBar`, via `activeProjectId` |

Surface 3 is grouping-independent by construction: `sidebarButtons` is a flat global array, so the footer
hosts it once per window regardless of how sessions are grouped.

## Invariants

- **I1 — `SidebarHeader` does not change.** Surface 1 is workspace-independent. The `ViewBar` is inserted
  _below_ it. (FR-025)
- **I2 — a scope-bearing group header hosts everything the old row hosted**: expand/collapse, project icon
  and name, `BranchSwitcher`, busy aggregate, `+ new terminal`, the project/workspace context menu, and the
  hover-revealed `workspaceTabs` buttons. (FR-026)
- **I3 — under a non-scope grouping every row exposes the same scope actions** via `ScopeMenu`, the row
  context menu, and the command palette. Same registry data, second host — no new contribution type. (FR-027)
- **I4 — `activeProjectId` is never undefined after a selection.** Selecting a session sets both
  `activeProjectId = session.projectId` and that project's active session. This is load-bearing for the
  per-project auto-open effect (`App.tsx:303-318`), surface 3, and `projectViews` state. (FR-029, SC-010)
- **I5 — Extension API changes are additive only.** `ExtensionContributes`
  (`src/shared/types/index.ts:69-76`) and `ExtensionRendererAPI` (`registry.ts:97-110`) are byte-identical
  after this feature; no contribution type is added, removed, or re-specified. Two additions are made:
  `api.sidebar.togglePanel()` and the internal channel `extension:sidebar-item-click`.
  `packages/extension-sdk` goes 1.0.0 → **1.1.0**; no existing extension must change. (FR-030)
- **I6 — the sidebar-item chain is complete end to end.** `api.sidebar.registerItem` →
  `globalRegistry.sidebarItems` → `extension:get-sidebar-items` → `loader.ts` →
  `registry.registerSidebarButton` → `ExtensionFooter` → click → `extension:sidebar-item-click` →
  `dispatchSidebarItemClick` → the extension's `onClick`. A break anywhere in that chain is the defect this
  feature exists to fix, so the spec asserts the click reaches the handler, not merely that the button
  renders. (FR-028)
- **I7 — `registerSidebarButton` stays off `ExtensionRendererAPI`.** Extensions register through the main
  API; the renderer registry is an internal detail that `loader.ts` populates. Exposing it would be a second
  public path to the same capability. (Principle VII)

## Regression spec obligations

`extension-surfaces.spec.tsx` registers a fake extension contributing a `workspaceTab`, a `projectTab`, and a sidebar item,
then for **each** of the five grouping modes asserts:

1. every registered global tab button renders in the header and fires its handler on click;
2. the workspace tab is reachable — on the group header under scope groupings, in `ScopeMenu` otherwise —
   and fires with the correct `workspaceId`;
3. the contributed sidebar item renders exactly once in the footer and its click reaches the handler
   (invariant I6) — asserted per mode, because the footer must survive every regrouping;
4. selecting any session leaves `activeProjectId` equal to that session's `projectId`;
5. the project tab resolves for the selected session's project.

Plus, once (not per mode): `⌘⇧G` toggles the git-integration sidebar panel; `ExtensionContributes` and
`ExtensionRendererAPI` member lists are asserted unchanged against inline literals so an accidental change
fails loudly; and `api.sidebar.togglePanel` is asserted present, since FR-028a's whole point is that a
sidebar item can act.
