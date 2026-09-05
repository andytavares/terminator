# Contract: The layer scale

**Feature**: `036-extension-ux-remediation` | **Status**: proposed

Replaces 14 unmanaged `z-index` values (1, 2, 9, 10, 20, 30, 40, 50, 100, 200, 999, 1000, 2000, 9999) spread across the extension stylesheets, where stacking was decided by whoever picked the
larger number (FR-003).

---

## The four layers

Ordering is the contract. The numbers are an implementation detail and no caller writes one.

| Layer     | Token                | Holds                                              | Above        |
| --------- | -------------------- | -------------------------------------------------- | ------------ |
| `panel`   | `--tm-layer-panel`   | Docked side panels, inline drawers, sticky headers | page content |
| `overlay` | `--tm-layer-overlay` | Dropdowns, pickers, popovers anchored to a control | panels       |
| `modal`   | `--tm-layer-modal`   | Dialogs, confirmations, and their scrim            | overlays     |
| `toast`   | `--tm-layer-toast`   | Transient messages                                 | everything   |

Toasts sit above modals on purpose: a confirmation raised by an action taken _inside_ a dialog
must be readable without dismissing the dialog first.

---

## The nesting rule

The one case naive ordering gets wrong: a picker opened **from inside** a dialog. `overlay` is
numerically below `modal`, so a picker taking the bare `overlay` value renders behind the
dialog that opened it.

**Rule**: a surface opened from another surface renders at its parent's layer plus a nested
offset, not at its own layer's base value. `@terminator/extension-ui` resolves this through
context — a component inside a `Dialog` reads the dialog's layer and offsets from it, so an
extension author never computes a stacking value.

This is the failure mode the current codebase exhibits and the reason the scale is a contract
rather than a convention.

---

## Usage

```css
/* extension stylesheet */
.my-panel {
  z-index: var(--tm-layer-panel);
}
```

```tsx
/* components take their layer from context; nothing is passed */
<Dialog title="Remove branch?" actions={[…]} onDismiss={close}>
  <DatePicker />   {/* resolves above the dialog automatically */}
</Dialog>
```

---

## Enforcement

| Check | Rule                                                                                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint  | A numeric literal `z-index` in `extensions/**/*.css` fails. `var(--tm-layer-*)` passes.                                                                                |
| Test  | For each pair of nested surfaces, the inner surface's computed stacking resolves above the outer — asserted by rendering, not by reading the stylesheet (research R5). |

---

## Migration map

| Current value       | Found in                        | Becomes   |
| ------------------- | ------------------------------- | --------- |
| 1, 2, 9, 10         | inline panel/sticky headers     | `panel`   |
| 20, 30, 40, 50      | dropdowns, pickers, popovers    | `overlay` |
| 100, 200, 999, 1000 | modals, drawers, backdrops      | `modal`   |
| 2000, 9999          | toast containers, drag overlays | `toast`   |

The drag overlay at 9999 is the one judgement call: it is transient and must clear everything,
so it takes `toast`.
