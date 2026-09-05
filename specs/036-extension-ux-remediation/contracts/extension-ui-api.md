# Contract: `api.ui` and `@terminator/extension-ui`

**Feature**: `036-extension-ux-remediation` | **Status**: proposed | **Contract version**: Extension API v1.3.0

This is the surface the feature publishes. It is **additive**: every existing member of
`ExtensionAPI` is unchanged, so an extension written against v1.2.0 loads and runs untouched
(FR-006).

---

## 1. Two halves, and why

The primitives are React components, and React components cannot cross a `contextBridge` — the
preload boundary serialises. So the contract has two halves:

| Half                    | Where it lives                                                        | What it carries                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Components**          | `@terminator/extension-ui`, a workspace package the extension imports | `Dialog`, `ConfirmDialog`, `Toast`, `EmptyState`, `IconButton`, `layers`, `useModalDepth`                                                   |
| **Main-process handle** | `api.ui` on `ExtensionAPI`                                            | Requests that originate in the main process and must surface in a view (`api.ui.toast`), plus the layer constants for stylesheet generation |

Components render **inside the calling document** (ADR 038), which is what keeps the content
behind a dialog visible and dimmed rather than hidden.

---

## 2. Component contract

```ts
// @terminator/extension-ui

export function Dialog(props: {
  title: string
  children?: React.ReactNode
  actions: DialogAction[] // 1–3, at most one tone: 'primary'
  dismissible?: boolean // default true
  onDismiss: () => void
}): JSX.Element

export function ConfirmDialog(props: {
  title: string
  description?: string
  confirmLabel?: string // default 'Confirm'
  danger?: boolean // default false
  onConfirm: () => void
  onClose: () => void
}): JSX.Element

export function Toast(props: ToastRequest): JSX.Element
export function ToastRegion(): JSX.Element // mount once per view

export function EmptyState(props: {
  icon?: LucideIcon
  heading: string
  description: string
  actions: [DialogAction, ...DialogAction[]] // at least one, enforced by the type
  hint?: React.ReactNode
}): JSX.Element

export function IconButton(props: {
  icon: LucideIcon
  label: string // required — there is no way to omit it (FR-005)
  onClick: () => void
  pressed?: boolean
}): JSX.Element
```

### Guarantees every `Dialog` and `ConfirmDialog` carries

A caller gets all of these without writing any of them (FR-002):

| Guarantee      | Observable as                                                              |
| -------------- | -------------------------------------------------------------------------- |
| Escape closes  | `onDismiss` fires; the extension is **not** exited                         |
| Focus trapped  | Tab and Shift+Tab cycle within the dialog                                  |
| Focus restored | On close, focus returns to the element that was focused when it opened     |
| Announced      | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` bound to the title |
| Scrim          | Content behind is dimmed and remains present in the DOM                    |
| Outside click  | `onDismiss` fires, unless `dismissible: false`                             |
| Depth counted  | `useModalDepth().current() > 0` while open, suppressing the exit gesture   |
| Reduced motion | No scrim or panel animation under `prefers-reduced-motion: reduce`         |

`dismissible: false` is the single escape hatch, for a surface holding unsaved work (FR-025).
It suppresses Escape and outside-click **only** — the dialog must still offer an explicit way
out, and `role`/focus/scrim guarantees still apply.

---

## 3. `api.ui` (main process)

```ts
interface ExtensionAPI {
  // …existing: db, app, log, settings, sidebar, globalShortcut, workspace, topBar, shell
  ui: {
    /** Raise a toast in the extension's view from main-process code. */
    toast(message: string, options?: { tone?: ToastTone; duration?: number }): void
    /** The published stacking order. Extensions style against these, never raw numbers. */
    readonly layers: Readonly<Record<'panel' | 'overlay' | 'modal' | 'toast', number>>
  }
}
```

`dialog` and `confirm` are deliberately **not** on the main-process handle. A dialog needs a
React tree to render into and a user to answer it; exposing it to main would invite
fire-and-forget prompts with no view guaranteed to be open.

---

## 4. Theming

Components consume the published `--tm-*` tokens only. They declare no literal colours, so they
inherit both themes automatically and satisfy FR-040 by construction.

Layer values are exported as CSS custom properties on the document root:

```css
--tm-layer-panel   /* … */
--tm-layer-overlay
--tm-layer-modal
--tm-layer-toast
```

Extension stylesheets reference these. A raw `z-index` in extension CSS fails FR-003 and is
detectable by lint.

---

## 5. Compatibility and migration

| Concern                | Position                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing extensions    | Unaffected until migrated. `api.ui` is additive; nothing is removed from the contract.                                                                              |
| Third-party extensions | Continue to work. They may adopt `@terminator/extension-ui` by adding it to their own `package.json`.                                                               |
| React                  | Declared as a **peer** dependency. All five bundled extensions pin `react@18.3.1`; components render in the caller's tree, so no shared React instance is required. |
| The core app           | Migrates onto the same components (FR-007a). `src/renderer/components/ConfirmDialog.tsx` becomes a thin re-export or is deleted in favour of the package.           |
| Deprecation            | The five bespoke implementations are **removed**, not deprecated in place — Principle X forbids leaving superseded code dormant.                                    |

---

## 6. What this contract deliberately does not include

Recorded so a later reader does not read the absence as an oversight (Principle VII, YAGNI):

- **No theming or variant API.** Components take tokens from CSS; a props-based theme would be
  a second theming system.
- **No animation configuration.** One transition, honouring `prefers-reduced-motion`.
- **No slot or composition system.** `Dialog` takes `children`; that is the whole extension
  point.
- **No promise-returning `dialog()`.** Callers own their open state, which is what lets a
  dialog hold unsaved work and decide for itself what dismissal means.
