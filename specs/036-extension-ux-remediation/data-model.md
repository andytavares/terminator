# Phase 1 Data Model: One UI Floor for Every Extension

**Feature**: `036-extension-ux-remediation` | **Date**: 2026-09-05

This feature persists nothing. There are no new tables, no migrations, and no changes to the
existing extension SQLite stores. What follows are the **runtime shapes** the contracts trade
in, and the two state machines the redesigned views render.

---

## 1. UI primitive shapes

### `DialogRequest`

What a caller hands to `api.ui.dialog`.

| Field         | Type             | Rules                                                                                                                                                   |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | string           | Required, non-empty. Becomes the accessible name via `aria-labelledby`.                                                                                 |
| `body`        | ReactNode        | Optional. Rendered in the caller's own React tree (ADR 038), so any content is permitted.                                                               |
| `actions`     | `DialogAction[]` | 1–3. Exactly one may be `primary`.                                                                                                                      |
| `dismissible` | boolean          | Default `true`. When `false`, Escape and outside-click do not close — reserved for a surface with unsaved work, which must offer its own explicit exit. |
| `onDismiss`   | `() => void`     | Called for Escape, outside-click and the close control alike, so a caller cannot handle one route and forget another.                                   |

### `DialogAction`

| Field      | Type                                 | Rules                                                                                    |
| ---------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `label`    | string                               | Required. Verb-first, sentence case (FR-038). Says what happens: "Save brief", not "OK". |
| `onSelect` | `() => void \| Promise<void>`        | Required.                                                                                |
| `tone`     | `'default' \| 'primary' \| 'danger'` | Default `'default'`.                                                                     |
| `shortcut` | string                               | Optional, display-only hint (e.g. `⌘↵`).                                                 |

### `ConfirmRequest`

A narrowing of `DialogRequest` for the two-button case. `title`, optional `description`,
`confirmLabel` (default `"Confirm"`), `danger` (default `false`). Resolves to a boolean.

### `ToastRequest`

| Field      | Type                                          | Rules                                                                                                                       |
| ---------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `message`  | string                                        | Required.                                                                                                                   |
| `tone`     | `'info' \| 'success' \| 'warning' \| 'error'` | Default `'info'`. Matches the core's existing `ToastType` so migrating `toast.store.ts` is not an API change (research R7). |
| `duration` | number (ms)                                   | Default 5000. `error` defaults to sticky.                                                                                   |
| `onClick`  | `() => void`                                  | Optional.                                                                                                                   |

A toast never takes focus, so it cannot interrupt a dialog (spec Edge Cases).

### `EmptyStateSpec`

Notepad's existing pattern, promoted to the house pattern (FR-026).

| Field         | Type             | Rules                                                                               |
| ------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `icon`        | lucide component | Optional. Flat, inherits `currentColor`, sized by CSS (Principle XII).              |
| `heading`     | string           | Required. States the situation: "No notes yet".                                     |
| `description` | string           | Required. One sentence, in the reader's language, no implementation terms (FR-039). |
| `actions`     | `DialogAction[]` | **At least one.** An empty state with no action fails FR-026.                       |
| `hint`        | ReactNode        | Optional — the keyboard gesture worth learning.                                     |

### `ModalDepth`

Per-document counter, not shared across the process boundary (research R2).

| Operation   | Effect                                                   |
| ----------- | -------------------------------------------------------- |
| `push()`    | Increment on dialog mount.                               |
| `pop()`     | Decrement on unmount, floored at 0.                      |
| `current()` | Read by the double-escape detector in the same document. |

**Invariant**: `current() > 0` suppresses the extension-exit gesture. A dialog that mounts and
throws before its cleanup runs must not leak a count — the counter is owned by an effect whose
cleanup is unconditional.

---

## 2. Layer scale

Replaces 14 ad-hoc `z-index` values (FR-003). Ordering is the contract; the numbers are an
implementation detail callers never write.

| Layer     | Purpose                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `panel`   | Docked side panels, inline drawers.                                                                   |
| `overlay` | Dropdowns, pickers, popovers anchored to a control.                                                   |
| `modal`   | Dialogs, confirmations, and their scrim.                                                              |
| `toast`   | Transient messages. Above modals so a save confirmation is visible over the dialog that triggered it. |

**Invariant**: a surface opened _from_ another surface renders above it. A picker opened inside
a dialog is the case that breaks naive ordering — `overlay` is numerically below `modal`, so
the picker takes the modal's layer plus a nested offset rather than the bare `overlay` value.

---

## 3. Remote Control view state (FR-012, FR-017)

The view renders exactly one of these. Today it has no representation of any of them.

```text
        ┌──────────┐
        │   off    │◄─────────────┐
        └────┬─────┘              │
             │ turn on            │ turn off / stop
             ▼                    │
        ┌──────────┐              │
        │ starting │──────────────┤
        └────┬─────┘              │
             │ listening          │
             ▼                    │
        ┌──────────┐              │
   ┌───►│    on    │──────────────┘
   │    └────┬─────┘
   │         │ port taken · credential rejected
   │         │ tunnel dropped · upstream unreachable
   │         ▼
   │    ┌──────────┐
   └────┤  failed  │  retry
        └──────────┘
```

| State      | What the view must show                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `off`      | One prominent control to turn it on.                                                                                                  |
| `starting` | Progress, and a way to cancel.                                                                                                        |
| `on`       | Address + copy, scannable code, concealed credential with reveal and copy, the one-line consequence, connected devices, stop control. |
| `failed`   | What happened in plain language, and an action that resolves it (FR-017).                                                             |

A distinct sub-case of `on`: **local-only** — running, but no credential supplied, so a local
address exists and a public one does not. The view must not present these as the same thing
(spec Edge Cases).

### `ConnectedDevice`

| Field         | Type   | Notes                                                                                        |
| ------------- | ------ | -------------------------------------------------------------------------------------------- |
| `id`          | string | Stable for the life of the connection; the handle `disconnect` takes.                        |
| `label`       | string | What the person recognises — "iPhone", "iPad". Derived from the user agent, never shown raw. |
| `viewing`     | string | Which terminal or branch.                                                                    |
| `connectedAt` | number | Epoch ms. Rendered as elapsed time, never as a raw timestamp.                                |

**Lifecycle**: the list is seeded once on mount and thereafter maintained by connect/disconnect
events pushed from the server, which is the authority because it owns the sockets (research
R8). A disconnect issued from this view must be reflected by the same event path, so the list
has one source of truth rather than an optimistic local edit.

---

## 4. SpecKit phase progress (FR-019)

The board card's payload today is ten unnamed integers and a fraction. What it needs:

| Field            | Type                   | Notes                                                                               |
| ---------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `phases`         | `{ id, name, done }[]` | The **name** is the field the current card omits, and the reason it cannot be read. |
| `completedCount` | number                 | Derived.                                                                            |
| `nextPhaseName`  | string \| null         | The one actionable fact on the card. `null` when complete.                          |

**Derivation rule**: `nextPhaseName` is the first phase with `done === false`. A card whose
phases are all done shows completion rather than a next step.

**Card identity** (FR-023): title is the brief's title; the branch or folder name is a fallback
used only when there is no title, so one rule names every card in every column.

---

## 5. Validation rules carried from requirements

| Rule                                                                    | Source           |
| ----------------------------------------------------------------------- | ---------------- |
| A dialog exposes `role="dialog"` and `aria-modal="true"` whenever open. | FR-002           |
| Content behind a dialog stays in the DOM and is dimmed, never hidden.   | FR-002a, ADR 038 |
| An empty state without at least one action is invalid.                  | FR-026           |
| An icon control without a label is unconstructible.                     | FR-005           |
| No card renders a label whose value is identical on every instance.     | FR-021           |
| The credential is concealed until an explicit reveal.                   | FR-013           |
| Approval is never a queue row's primary action.                         | FR-034a          |
