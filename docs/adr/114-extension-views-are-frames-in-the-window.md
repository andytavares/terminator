# ADR 114: Extension views are frames in the window

**Status**: Accepted
**Date**: 2026-10-15
**Supersedes**: [ADR 022](022-webview-isolated-extension-renderer.md) (where an extension's view runs; its `ext://` protocol, manifest-declared surfaces and isolation from core source are unchanged)
**Relates to**: [ADR 026](026-double-escape-extension-exit.md), [ADR 057](057-quick-actions-are-a-leader-panel.md), [ADR 109](109-a-file-watch-belongs-to-the-view-that-asked.md), [ADR 110](110-modal-surfaces-use-the-native-dialog-element.md)

## Context

Under ADR 022, every extension view was a native `WebContentsView` that main placed over a placeholder in the window. A native view paints above the DOM of the page. So nothing in the main renderer could draw over it: not a modal, not a drawer, not a toast. The workaround hid every view while any modal was open, and reserved a strip of the window for the notification drawer (`setLeftInset`). Opening Quick Actions over the Git view blanked the screen behind the palette.

## Decision

**The view of an extension is an `<iframe>` in the main window, loading `ext://<id>/<renderer>`. It talks to main over one `MessagePort` per frame. The `ext://` handler injects a shim into the HTML of the extension. The shim builds the `window.electronAPI` of the extension from the channel manifest.**

```
ExtensionPanelPortal ── iframe load ──▶ extension.openFramePort {extensionId, viewParam, frameToken}
        ▲                                           │ FrameBridge: new MessageChannelMain, keep port2
        │ preload: port to main world               ▼
        └──── extension:frame-port {frameToken} [port1] ◀── main
ExtensionPanelPortal ── postMessage(terminator:frame-port, ext://<id>, [port1]) ──▶ frame-shim.js
frame-shim.js ── invoke / send / subscribe / request-exit / quick-actions-open / settings-open ──▶ FrameBridge ──▶ ipc registry
```

- **Layering.** The frame is page content. So the `::backdrop` of a modal dims it, and a drawer or toast draws over it ([ADR 110](110-modal-surfaces-use-the-native-dialog-element.md)). The app hides nothing and reserves no strip.
- **Identity.** Main knows which surface sent a call by the port that the call arrived on. A frame cannot claim to be another extension. The file watch of ADR 109 is keyed by the caller, a port or a window. It ends when the port closes or the surface opens a new port.
- **The API.** The frame mode of `buildElectronApi` gives a frame exactly the specs marked `extensionView`, as the hand-written view preload did. Extension code does not change.
- **Keys.** The shim hears the double-Escape exit (ADR 026), the ⌘P leader (ADR 057) and ⌘, for Settings in the frame. It sends them to main over the port.
- **Theme.** Main sends the theme over the port. The shim sets `data-theme`, as the view host did.
- **The model.** This is the webview model of VS Code: an iframe that talks to its extension by message passing ([VS Code: Webview API](https://code.visualstudio.com/api/extension-guides/webview)). The ports into a context-isolated page follow the guide of Electron ([Electron: MessagePorts](https://www.electronjs.org/docs/latest/tutorial/message-ports)).

## Alternatives considered

| Option                                           | Why not                                                                                                                                                                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep views, hide them while a modal is open      | The screen behind the modal goes blank. That is the bug.                                                                                                                                                                    |
| Keep views, show a screenshot under the modal    | It imitates the page instead of showing the page. The content goes stale while the modal is open.                                                                                                                           |
| Keep views, draw modals in a topmost native view | It needs a second renderer. 11 modals would have to move across a process boundary with their stores and callbacks. Native views would still cover popovers and toasts.                                                     |
| Iframe with `nodeIntegrationInSubFrames`         | Experimental, and "all your preloads will load for every iframe" ([WebPreferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences)). This hands the whole API of the main preload to extension code. |

## Consequences

- `ExtensionViewHost`, `preload-webview.ts`, the `ext-views` partition, and the channels `extension:update-panel-bounds`, `extension:set-bottom-inset`, `extension:set-left-inset`, `extension:set-theme` and `extension:panel-loaded` are gone.
- Chromium chooses the process of a frame, not the app. Under ADR 022, every view had its own process. Nobody has measured whether Chromium places an `ext://` frame out of process. If it does not, a stalled extension view can stall the window.
- Extension `localStorage` lives in the default session, so it now survives a restart. The in-memory `ext-views` partition dropped it.
