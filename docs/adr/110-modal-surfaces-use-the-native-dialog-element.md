# ADR 110: Modal surfaces use the native dialog element

**Status**: Accepted
**Date**: 2026-10-13
**Changes**: [ADR 038](038-dialogs-render-in-the-extension-view.md) (how a dialog is rendered and how modals stack; where it renders is unchanged)
**Relates to**: [ADR 026](026-double-escape-extension-exit.md), [ADR 098](098-one-design-system.md), Constitution Principle XIII

## Context

The design system had one modal, `Dialog`: a title, a body and one to three actions. Its modal behaviour was written by hand: a keydown listener for Escape, a Tab trap (`focus-trap.ts`), a scrim element, focus captured on open and restored on close, and a z-index lifted per level of nesting (`nestedLayerValue`).

A surface with any other content could not use it, so each built the behaviour again: Settings and Quick Actions in the core; Notepad's search and quick create; Task Vault's block and recurrence dialogs and its query confirmation. None of the seven kept Tab inside or made the page behind inert, and the two in the core stacked by z-index values of their own (600 and 9000).

## Decision

**The design system has a modal shell with no content of its own, built on the native `<dialog>` element opened with `showModal()`. Every modal surface in the core and the extensions is that shell. `Dialog` is the shell plus its title, body and actions; its props did not change.**

`ModalShell` (`packages/extension-ui/src/ModalShell.tsx`) takes `label` or `labelledBy`, `className`, `dismissible`, `onDismiss` and children. What the browser now does, per the HTML standard's [dialog element](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element):

| Was written by hand                              | Now                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Tab trap                                         | Everything outside a modal dialog is inert                                       |
| Focus captured on open, restored on close        | `showModal()` moves focus in; `close()` returns it to what had it                |
| Escape listener, "innermost surface only"        | The `cancel` event, sent to the dialog opened last                               |
| Scrim element                                    | `::backdrop`                                                                     |
| `z-index` per nesting level (`nestedLayerValue`) | The top layer: a modal dialog paints above every z-index, in the order opened    |
| `role="dialog"`, `aria-modal="true"`             | The element's own role; a dialog opened with `showModal()` is announced as modal |

**Every modal is centred in its window on both axes, with no exceptions.** A modal dialog is centred by the browser's default styles (`position: fixed; inset: 0; margin: auto`). The shell states those values `!important`, with `transform: none` and `translate: none`, so no caller's class, offset or animation moves a modal. The window is the whole core window, an extension view's own viewport, or the phone's. Quick Actions and Notepad's search, which sat near the top, are centred like the rest. Content taller than the window scrolls inside the shell (`max-height: calc(100% - 32px); overflow: auto`). `expectCentredInWindow` (`tests/e2e/modal-centre.ts`) measures it in the running app: each spec that opens a modal asserts the box's centre is within 1px of the window's.

What the shell still does itself:

- **It is open exactly while it is mounted.** The caller unmounts it on `onDismiss`, so the shell prevents the `cancel` event's default. The standard lets a page prevent only the first close request after a user activation ([close watchers](https://html.spec.whatwg.org/multipage/interaction.html#close-requests-and-close-watchers)): a second Escape with no click between closes the dialog whatever the page says. A shell still mounted when that happens opens itself again. A shell that is not `dismissible` also prevents the Escape keydown's default while focus is inside it, which stops the close request being made at all.
- **A press outside dismisses.** `closedby="any"` would do it, and is not in Safari ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/closedBy): "Limited availability"). A press on the backdrop arrives on the dialog element, so the shell dismisses on a mousedown whose target is the dialog and whose point is outside its box.
- **The modal depth.** The double-Escape exit gesture (ADR 026) reads how many surfaces are open; the shell registers there as `Dialog` did.
- **It opens before its content takes focus.** React focuses an `autoFocus` field during commit, and a field in a dialog not yet open cannot take focus. The call to `showModal()` is made from a first child's layout effect, which React runs before it reaches the fields after it. `stories/ModalShell.stories.tsx` (`AutoFocusFieldTakesFocus`) fails if a React release changes that order.

`Dialog` puts its close control after its actions in the document and draws it beside the title, so the browser's rule, focus on the first control inside, lands on the first field or the first action and never on the close.

### A caller with its own Escape

Quick Actions handles every key itself. A caller like it listens for the keydown and prevents its default; the standard then makes no close request, and the shell's `onDismiss` is left for the requests that are not a key (a phone's back gesture).

### What may open from inside a modal

Everything outside an open modal dialog is inert and painted over, so anything used while one is open has to be inside it:

- `Popover`, and a panel using `useDismissible`, render in place and so are inside already. `useDismissible` prevents the default of the Escape it answers, or the dialog around it would close too.
- `ToastRegion` is mounted once per view, outside every dialog. It renders into the modal shell opened last (`modal-stack.ts`) while one is open, and back in the page when none is.
- A surface an extension portals to `document.body` must portal into the dialog it was opened from instead. Task Vault's date picker does (`closest('dialog') ?? document.body`).

### What is not a modal

The log window is a strip along the bottom of a window that stays usable, and the notification drawer is docked to the sidebar beside extension views that stay usable. Both claimed `role="dialog"`; each is now a named `region`. Task Vault's task detail pane and the phone client's context menu were not dialogs before and are not now.

### Extension views

Unchanged from ADR 038. An extension's view is a separate native view the compositor paints over the page, and the browser's top layer belongs to one document, so a core modal still hides the views (`useModalEffect`) and a dialog an extension opens still renders in that extension's document.

## Verified in browsers

`packages/extension-ui/visual/modal-keys.visual.ts` presses real keys against the built stories. It passes in Playwright's Chromium, and in Playwright's WebKit 26.5 when run with `--browser=webkit`. In WebKit a second `cancel` stays preventable, so the shell is never closed from under its caller there. Not run on an iPhone.

jsdom 29 implements none of `HTMLDialogElement`'s methods and happy-dom 20 implements `showModal()` and `close()` only. `tests/support/native-dialog.ts` supplies those two for jsdom and the `cancel` event after an Escape for both. Focus, the inert page and the top layer are asserted in the stories, the spec above and the e2e suite, never in a unit test.

## Consequences

- `focus-trap.ts`, `nestedLayerValue`, `useContainingLayer` and `useDismissible`'s `captureEscape` are deleted, with the hand-built scrims and z-indexes of the seven surfaces.
- The `--tm-layer-*` scale stays for what is not a modal: panels, dropdowns, toasts.
- One backdrop, `--tm-scrim`, for every modal. Settings loses its 2px blur; a light-theme `Dialog`'s backdrop goes from 55% to the token's 35%.
- A new modal surface is `ModalShell` with a class. A hand-built `role="dialog"` with `aria-modal` is a defect.
- A modal's entrance animation must not use `transform`: it would make the dialog the containing block of a toast shown inside it.
