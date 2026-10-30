# ADR 038: A dialog renders in the view that opened it

**Status**: Accepted. [ADR 110](110-modal-surfaces-use-the-native-dialog-element.md) changes how a dialog is rendered and how modals stack. The native `<dialog>` element replaces the scrim, the "innermost surface" Escape gate and `nestedLayerValue()` described below. Where a dialog renders, and the per-document modal depth, stand.

**Date**: 2026-09-05

## Context

Each of the five bundled extensions had written its own overlay. Before this feature there were four independent implementations of "a thing over the screen with a scrim". They disagreed on what Escape does, whether the scrim closes the overlay, where focus goes, and what happens when two overlays are open at once. The five extensions had fifteen dismissible surfaces, and the behaviour a person got depended on which extension they were in.

The obvious consolidation is to move this into the core. The core already has `modal.store.ts`, `useModalEffect`, and a `ConfirmDialog` that eleven core components use. An extension would ask the core to open a dialog, and the process would have exactly one implementation.

That does not work, because of how extension UI is hosted.

An extension renders in a `WebContentsView`. That is a native overlay: the compositor paints it **above** the host renderer's DOM, not inside it. While the view is on screen, nothing the core renderer draws in the same region is visible. The same constraint made `setLeftInset` necessary for the notification panel, instead of drawing a panel over the extension.

So a core-hosted dialog has two options, and both are wrong:

- **Draw it in the core renderer.** The extension view covers it. The dialog is invisible.
- **Hide the extension view while the dialog is open.** This is what `useModalEffect` does for core modals. The extension blanks. A confirmation that says "Delete this note?" would appear on an empty screen, and the note it names would no longer be visible. This would break FR-002, which promises that the surface behind a dialog stays visible and inert behind a scrim. The mechanism meant to keep that promise would break it.

## Decision

**A dialog renders inside the extension view that opened it. The shared implementation is published as a component, not as a service.**

`packages/extension-ui` exports `Dialog`, `ConfirmDialog`, `Popover` and `ToastRegion`. An extension imports them and renders them in its own document. There is one implementation of the behaviour, and there are many mount points.

Three consequences follow from "many documents":

**Modal depth is per document.** `contextIsolation: true` gives the extension's page and its preload different `window` objects, so the preload cannot read a counter that the page sets. The bridge mirrors the depth with `electronAPI.ui.setModalDepth`. This is how the double-Escape exit gesture knows not to fire while a dialog is open.

**Only the innermost surface answers Escape.** If several dialogs are mounted in one document, each would otherwise close on the same keystroke. Every surface registers in a depth registry, and `isInnermost()` gates the handler.

**Stacking comes from a published scale.** Separate documents cannot see each other's `z-index`. Each document can still disagree about magnitude within its own, and this is how 38 unmanaged values ended up ordered by whoever picked the biggest number. `LAYERS` and `nestedLayerValue()` name four steps. CSS reads `var(--tm-layer-*)`, which `EXTENSION_BASE_CSS` injects.

## Consequences

The core's own dialogs keep `useModalEffect`. This is correct for them: a core modal does want the extension view out of the way, because the modal is not in that view.

`src/renderer/components/ConfirmDialog.tsx` now wraps the shared component. The core and the extensions render the same markup and answer Escape the same way: one implementation, two hosts.

A third-party extension gets the same floor by depending on `@terminator/extension-ui`. It is a source-only workspace package with React as a peer dependency. It adds no build step and no second copy of React.

The cost is that the shared components ship in each extension's bundle. They are not loaded once. At the size of these components, that is a few kilobytes per extension. It is the price of the views being separate documents, and they have been separate for security reasons that long predate this decision.
