# Contract: App Band

**Feature**: `032-branch-first-sidebar`

The sidebar's app-level surfaces move into one labelled band. **No extension-facing contract changes** — this is a core layout decision applied to registration data that already exists (FR-020, constitution II).

## What feeds it

Two existing sources, both read through the extension registry the renderer already consumes.

| Source        | Registered by                                    | Shape                                           | Today renders in                             |
| ------------- | ------------------------------------------------ | ----------------------------------------------- | -------------------------------------------- |
| Global tabs   | `contributes.globalTab` in an extension manifest | `{ label: string, icon: string, view: string }` | The unlabelled icon strip in `SidebarHeader` |
| Sidebar items | `api.sidebar.registerItem()` at runtime          | `{ id, label, action }`                         | `ExtensionFooter` at the bottom              |

Core contributes Overview to the first list, exactly as it does today.

Currently registered, for reference — `AppBand` must not name any of these in code:

| Label          | Icon          | Source                                           |
| -------------- | ------------- | ------------------------------------------------ |
| Overview       | `layout-grid` | core                                             |
| Remote Control | `wifi`        | `extensions/remote-control`                      |
| Notes          | `file`        | `extensions/notepad`                             |
| Task Vault     | `calendar`    | `extensions/task-vault`                          |
| Git Changes    | —             | `extensions/git-integration`, via `registerItem` |

## Component — `src/renderer/components/sidebar/AppBand.tsx`

```ts
interface AppBandProps {
  globalTabs: GlobalTabRegistration[]
  sidebarItems: SidebarItemRegistration[]
  activeId: string | null
  onSelect: (id: string) => void
}
```

**Rules**

- Renders one entry per registration, in source order: core first, then global tabs, then sidebar items.
- Every entry shows its icon **and** its `label` as visible text (FR-016). There is no icon-only mode and no configuration to produce one — that is the whole point of the change.
- `aria-label` is the `label`; the icon is `aria-hidden` (FR-016, SC-007).
- Entries are keyboard reachable in DOM order with a visible focus ring (SC-007).
- Icon resolution: the contribution's `icon` string maps to a lucide component. **An unresolved name renders `Square`** and never throws — an extension must not be able to break the sidebar with a typo.
- The band is separated from the session list by a rule and a distinct surface, so the two read as different systems (FR-015).
- `AppBand` contains no reference to any extension id or name. It iterates registry data only (constitution II).

## Sidebar header changes — `SidebarHeader.tsx`

| Control           | Before                       | After                                  | Why                                           |
| ----------------- | ---------------------------- | -------------------------------------- | --------------------------------------------- |
| Global tab icons  | Own row under the search box | Moved into `AppBand`, above the search | FR-015                                        |
| Notification bell | On the icon row              | On the search row                      | It acts on the list, not the apps (FR-017)    |
| New repo `+`      | On the icon row              | On the search row                      | Same (FR-017)                                 |
| Search            | Top                          | Below the band                         | The band is app-level; search scopes the list |

## Deletions

| File                           | Replaced by         | Note                                                                                 |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------------------ |
| `ExtensionFooter.tsx` / `.css` | `AppBand`           | Constitution X — delete, do not leave orphaned. Its spec moves to `AppBand.spec.tsx` |
| `ScratchSection.tsx` / `.css`  | A group in the list | Scratch becomes a normal group with a count (FR-018)                                 |

## Scratch as a group

Scratch sessions (`projectId === SCRATCH_PROJECT_ID`) render as a group in the session list with a label, a count and a "New scratch terminal" action, rather than as a pinned footer (FR-018).

**Boundary with audit NAV-6**: this feature moves _where scratch renders_. It does **not** change the count `buildGroups` reports. Making the chip counts equal the rendered rows is a standalone repair, deliberately excluded here so the two changes can be reviewed and reverted independently — see [data-model.md](../data-model.md#what-deliberately-does-not-change).

## Test obligations

| File                      | Must cover                                                                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppBand.spec.tsx`        | Every registration renders a visible label; `aria-label` present; unknown icon falls back to `Square` without throwing; entries fire `onSelect` with the right id; keyboard focus order; a contributed sidebar item and a global tab both appear in the same band |
| `SidebarHeader.spec.tsx`  | Bell and add-repo are on the search row; no unlabelled icon row remains                                                                                                                                                                                           |
| `UnifiedSidebar.spec.tsx` | Scratch renders as a group with a count; no `ExtensionFooter` in the tree; each contributed item appears exactly once (existing FR-028 assertions must keep passing)                                                                                              |
| e2e                       | The band survives an extension registering after mount                                                                                                                                                                                                            |
