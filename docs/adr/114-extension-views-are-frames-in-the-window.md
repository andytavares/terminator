# ADR 114: Extension views are frames in the window

**Status**: Accepted
**Date**: 2026-10-15
**Supersedes**: [ADR 022](022-webview-isolated-extension-renderer.md) (where an extension's view runs; its `ext://` protocol, manifest-declared surfaces and isolation from core source are unchanged)
**Relates to**: [ADR 026](026-double-escape-extension-exit.md), [ADR 057](057-quick-actions-are-a-leader-panel.md), [ADR 109](109-a-file-watch-belongs-to-the-view-that-asked.md), [ADR 110](110-modal-surfaces-use-the-native-dialog-element.md)

## Context

Under ADR 022 every extension view was a native `WebContentsView` that main placed over a placeholder in the window. A native view paints above the page's DOM, so nothing in the main renderer could draw over it: not a modal, not a drawer, not a toast. The workaround was to hide every view while any modal was open, and to reserve a strip of the window for the notification drawer (`setLeftInset`). Opening Quick Actions over the Git view blanked the screen behind the palette.

## Decision

**An extension's view is an `<iframe>` in the main window, loading `ext://<id>/<renderer>`. It talks to main over one `MessagePort` per frame. A shim that the `ext://` handler injects into the extension's HTML builds its `window.electronAPI` from the channel manifest.**

```
ExtensionPanelPortal ── iframe load ──▶ extension.openFramePort {extensionId, viewParam, frameToken}
        ▲                                           │ FrameBridge: new MessageChannelMain, keep port2
        │ preload: port to main world               ▼
        └──── extension:frame-port {frameToken} [port1] ◀── main
ExtensionPanelPortal ── postMessage(terminator:frame-port, ext://<id>, [port1]) ──▶ frame-shim.js
frame-shim.js ── invoke / send / subscribe / request-exit / quick-actions-open / settings-open ──▶ FrameBridge ──▶ ipc registry
```

- **Layering.** The frame is page content, so a modal's `::backdrop` dims it, and a drawer or toast draws over it ([ADR 110](110-modal-surfaces-use-the-native-dialog-element.md)). Nothing is hidden and no strip is reserved. While a modal is open the frame is `inert` with `pointer-events: none`: the modal makes the page around it inert, but the browser has still routed a click on the modal into the out-of-process frame beneath it.
- **Identity.** Main knows which surface a call came from by the port it arrived on. A frame cannot claim to be another extension. The file watch of ADR 109 is keyed by the caller, a port or a window, and ends when the port closes or the surface opens a new one.
- **The API.** The frame mode of `buildElectronApi` gives a frame exactly the specs marked `extensionView`, as the hand-written view preload did. Extension code does not change.
- **Keys.** The double-Escape exit (ADR 026), the ⌘P leader (ADR 057) and ⌘, for Settings are heard in the frame by the shim and sent to main over the port.
- **Theme.** Main sends the theme over the port, and the shim sets `data-theme` as the view host did.
- **The model.** This is VS Code's webview model: an iframe that talks to its extension by message passing ([VS Code: Webview API](https://code.visualstudio.com/api/extension-guides/webview)). Ports into a context-isolated page follow Electron's guide ([Electron: MessagePorts](https://www.electronjs.org/docs/latest/tutorial/message-ports)).

## Alternatives considered

| Option                                           | Why not                                                                                                                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep views, hide them while a modal is open      | The screen behind the modal goes blank. That is the bug.                                                                                                                                                                |
| Keep views, show a screenshot under the modal    | It imitates the page instead of showing it, and the content goes stale while the modal is open.                                                                                                                         |
| Keep views, draw modals in a topmost native view | It needs a second renderer, and 11 modals would have to move across a process boundary with their stores and callbacks. Popovers and toasts would still be covered.                                                     |
| Iframe with `nodeIntegrationInSubFrames`         | Experimental, and "all your preloads will load for every iframe" ([WebPreferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences)), which hands the main preload's whole API to extension code. |

## Consequences

- `ExtensionViewHost`, `preload-webview.ts`, the `ext-views` partition, and the channels `extension:update-panel-bounds`, `extension:set-bottom-inset`, `extension:set-left-inset`, `extension:set-theme` and `extension:panel-loaded` are gone.
- A frame's process is Chromium's choice, not ours. Under ADR 022 every view had its own. Whether an `ext://` frame is placed out of process has not been measured. If it is not, a stalled extension view can stall the window.
- Extension `localStorage` lives in the default session, so it now survives a restart. The in-memory `ext-views` partition dropped it.
