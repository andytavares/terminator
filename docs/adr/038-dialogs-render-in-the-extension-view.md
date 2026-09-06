# ADR 038: A dialog renders in the view that opened it

**Status**: Accepted

**Date**: 2026-09-05

## Context

Every one of the five bundled extensions had written its own overlay. Before
this feature there were four independent implementations of "a thing over the
screen with a scrim", none agreeing on what Escape does, whether the scrim
closes it, where focus goes, or what happens when two of them are open at once.
Fifteen dismissible surfaces across the five, and the behaviour a person got
depended on which extension they happened to be in.

The obvious consolidation is to hoist this into the core: the core already has
`modal.store.ts`, `useModalEffect`, and a `ConfirmDialog` that eleven core
components use. An extension would ask the core to open a dialog, and there
would be exactly one implementation in the process.

That does not work, for a reason particular to how extension UI is hosted.

An extension renders in a `WebContentsView`. That is a native overlay: the
compositor paints it **above** the host renderer's DOM, not inside it. Anything
the core renderer draws in the same region is simply not visible while the view
is on screen — this is the same constraint that made `setLeftInset` necessary
for the notification panel, rather than drawing a panel over the extension.

So a core-hosted dialog has two options, and both are wrong:

- **Draw it in the core renderer.** The extension view covers it. The dialog is
  invisible.
- **Hide the extension view while the dialog is open**, which is what
  `useModalEffect` does for core modals. The extension blanks. A confirmation
  that says "Delete this note?" would appear on an empty screen, with the note
  it names no longer visible — and FR-002's promise, that the surface behind a
  dialog stays visible and inert behind a scrim, would be broken by the
  mechanism meant to keep it.

## Decision

**A dialog renders inside the extension view that opened it. The shared
implementation is published as a component, not as a service.**

`packages/extension-ui` exports `Dialog`, `ConfirmDialog`, `Popover` and
`ToastRegion`. An extension imports and renders them in its own document. There
is one implementation of the behaviour; there are many mount points.

The three consequences that follow from "many documents":

**Modal depth is per document.** `contextIsolation: true` means the extension's
page and its preload hold different `window` objects, so the preload cannot read
a counter the page sets. Depth is mirrored across the bridge —
`electronAPI.ui.setModalDepth` — which is how the double-Escape exit gesture
learns not to fire while a dialog is open.

**Escape is answered by the innermost surface only.** With several dialogs
mounted in one document, each would otherwise close on the same keystroke. Every
surface registers in a depth registry and `isInnermost()` gates the handler.

**Stacking comes from a published scale.** Separate documents cannot see each
other's `z-index`, but they can disagree about magnitude within their own —
which is how 38 unmanaged values ended up ordered by whoever picked the biggest
number. `LAYERS` and `nestedLayerValue()` name four steps; CSS reads
`var(--tm-layer-*)`, injected by `EXTENSION_BASE_CSS`.

## Consequences

The core's own dialogs keep `useModalEffect`, which is correct for them: a core
modal genuinely does want the extension view out of the way, because the modal
is not in it.

`src/renderer/components/ConfirmDialog.tsx` now wraps the shared component, so
the core and the extensions render the same markup and answer Escape the same
way — one implementation, two hosts.

A third-party extension gets the same floor by depending on
`@terminator/extension-ui`. It is a source-only workspace package with React as
a peer dependency, so it adds no build step and no second copy of React.

The cost is that the shared components ship into each extension's bundle rather
than being loaded once. At the size of these components that is a few kilobytes
per extension, and it is the price of the views being separate documents, which
they are for security reasons that long predate this decision.
