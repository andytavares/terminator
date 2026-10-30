# ADR 110: Modal surfaces use the native dialog element

**Status**: Accepted
**Date**: 2026-10-13
**Changes**: [ADR 038](038-dialogs-render-in-the-extension-view.md) (how a dialog is rendered and how modals stack; where it renders is unchanged)
**Relates to**: [ADR 026](026-double-escape-extension-exit.md), [ADR 098](098-one-design-system.md), Constitution Principle XIII

## Context

The design system had one modal, `Dialog`: a title, a body and one to three actions. Its modal behaviour was written by hand: a keydown listener for Escape, a Tab trap (`focus-trap.ts`), a scrim element, focus captured on open and restored on close, and a z-index lifted per level of nesting (`nestedLayerValue`).

A surface with any other content could not use `Dialog`, so each surface built the behaviour again. These are Settings and Quick Actions in the core, the search and quick create of Notepad, and the block dialog, recurrence dialog and query confirmation of Task Vault. None of the seven kept Tab inside or made the page behind inert. The two in the core stacked by z-index values of their own (600 and 9000).

## Decision

**The design system has a modal shell with no content of its own. The shell is built on the native `<dialog>` element, opened with `showModal()`. Every modal surface in the core and the extensions is that shell. `Dialog` is the shell plus its title, body and actions. Its props did not change.**

`ModalShell` (`packages/extension-ui/src/ModalShell.tsx`) takes `label` or `labelledBy`, `className`, `dismissible`, `onDismiss` and children. The browser now does the following, per the [dialog element](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element) of the HTML standard:

| Was written by hand                              | Now                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Tab trap                                         | Everything outside a modal dialog is inert                                       |
| Focus captured on open, restored on close        | `showModal()` moves focus in; `close()` returns it to what had it                |
| Escape listener, "innermost surface only"        | The `cancel` event, sent to the dialog opened last                               |
| Scrim element                                    | `::backdrop`                                                                     |
| `z-index` per nesting level (`nestedLayerValue`) | The top layer: a modal dialog paints above every z-index, in the order opened    |
| `role="dialog"`, `aria-modal="true"`             | The element's own role; a dialog opened with `showModal()` is announced as modal |

**Every modal is centred in its window on both axes, with no exceptions.** The default styles of the browser centre a modal dialog (`position: fixed; inset: 0; margin: auto`). The shell states those values `!important`, with `transform: none` and `translate: none`. So no class, offset or animation of a caller moves a modal. The window is the whole core window, the own viewport of an extension view, or the phone's viewport. Quick Actions and the search of Notepad sat near the top. They are now centred like the rest. Content taller than the window scrolls inside the shell (`max-height: calc(100% - 32px); overflow: auto`). `expectCentredInWindow` (`tests/e2e/modal-centre.ts`) measures the position in the running app. Each spec that opens a modal asserts that the centre of the box is within 1px of the centre of the window.

The shell still does these things itself:

- **It is open exactly while it is mounted.** The caller unmounts it on `onDismiss`, so the shell prevents the default of the `cancel` event. The standard lets a page prevent only the first close request after a user activation ([close watchers](https://html.spec.whatwg.org/multipage/interaction.html#close-requests-and-close-watchers)). A second Escape with no click between closes the dialog, whatever the page says. A shell that is still mounted when this happens opens itself again. A shell that is not `dismissible` also prevents the default of the Escape keydown while focus is inside it. This stops the close request at the source.
- **A press outside dismisses.** `closedby="any"` would do this, but Safari does not support it ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/closedBy): "Limited availability"). A press on the backdrop arrives on the dialog element. So the shell dismisses on a mousedown whose target is the dialog and whose point is outside its box.
- **The modal depth.** The double-Escape exit gesture (ADR 026) reads how many surfaces are open. The shell registers there, as `Dialog` did.
- **It opens before its content takes focus.** React focuses an `autoFocus` field during commit, and a field in a dialog that is not yet open cannot take focus. The layout effect of a first child calls `showModal()`. React runs this effect before it reaches the fields after the child. `stories/ModalShell.stories.tsx` (`AutoFocusFieldTakesFocus`) fails if a React release changes that order.

`Dialog` puts its close control after its actions in the document and draws it beside the title. So the rule of the browser, focus on the first control inside, lands on the first field or the first action, and never on the close control.

### A caller with its own Escape

Quick Actions handles every key itself. A caller like it listens for the keydown and prevents its default. The standard then makes no close request. The `onDismiss` of the shell remains for the requests that are not a key (the back gesture of a phone).

### What may open from inside a modal

Everything outside an open modal dialog is inert and painted over. So anything used while a modal dialog is open must be inside it:

- `Popover`, and a panel that uses `useDismissible`, render in place, so they are inside already. `useDismissible` prevents the default of the Escape it answers. Otherwise the dialog around it would close too.
- `ToastRegion` is mounted once per view, outside every dialog. While a modal is open, it renders into the modal shell opened last (`modal-stack.ts`). When none is open, it renders in the page.
- A surface that an extension portals to `document.body` must portal into the dialog it was opened from. The date picker of Task Vault does this (`closest('dialog') ?? document.body`).

### What is not a modal

The log window is a strip along the bottom of a window that stays usable. The notification drawer is docked to the sidebar, beside extension views that stay usable. Both claimed `role="dialog"`. Each is now a named `region`. The task detail pane of Task Vault and the context menu of the phone client were not dialogs before, and are not dialogs now.

### Extension views

Unchanged from ADR 038. The view of an extension is a separate native view that the compositor paints over the page. The top layer of the browser belongs to one document. So a core modal still hides the views (`useModalEffect`), and a dialog that an extension opens still renders in the document of that extension.

## Verified in browsers

`packages/extension-ui/visual/modal-keys.visual.ts` presses real keys against the built stories. It passes in Chromium of Playwright. It also passes in WebKit 26.5 of Playwright when run with `--browser=webkit`. In WebKit, a second `cancel` stays preventable, so the shell never closes from under its caller there. The test was not run on an iPhone.

jsdom 29 implements none of the methods of `HTMLDialogElement`. happy-dom 20 implements `showModal()` and `close()` only. `tests/support/native-dialog.ts` supplies those two for jsdom, and the `cancel` event after an Escape for both. The stories, the spec above and the e2e suite assert focus, the inert page and the top layer. No unit test asserts them.

## Consequences

- `focus-trap.ts`, `nestedLayerValue`, `useContainingLayer` and the `captureEscape` of `useDismissible` are deleted, with the hand-built scrims and z-indexes of the seven surfaces.
- The `--tm-layer-*` scale stays for what is not a modal: panels, dropdowns and toasts.
- Every modal has one backdrop, `--tm-scrim`. Settings loses its 2px blur. The backdrop of a light-theme `Dialog` goes from 55% to the 35% of the token.
- A new modal surface is `ModalShell` with a class. A hand-built `role="dialog"` with `aria-modal` is a defect.
- The entrance animation of a modal must not use `transform`. It would make the dialog the containing block of a toast shown inside it.
