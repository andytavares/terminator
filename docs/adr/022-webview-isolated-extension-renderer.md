# ADR-022: WebContentsView-Isolated Extension Renderer

**Status**: Accepted  
**Date**: 2026-06-24  
**Deciders**: Andrew Tavares

---

## Context

The previous extension renderer model loaded extension UI code directly into the host renderer's JavaScript context via `import.meta.glob('../../../extensions/*/src/renderer.tsx')` — a Vite build-time directive. This caused three compounding problems:

1. **Build-time coupling**: Every extension renderer change required a full app rebuild. Moving an extension out of the `extensions/` directory broke it entirely.

2. **Dual React instance**: External extensions dynamically imported via `import(ext://id/renderer.js)` into the same browser context. Extensions bundle their own React copy (required for external distribution), resulting in two React instances. React hooks throw "Invalid hook call" immediately on mount.

3. **No cache busting**: Dynamic ESM imports cached aggressively. Extension updates required a full page reload and sometimes a rebuild to take effect.

The litmus test that revealed the failure: an extension moved from `extensions/` to an arbitrary directory on disk could not be made to work without core app changes.

---

## Decision

Extension renderer UIs run in Electron `WebContentsView` instances — completely isolated browser contexts served via the `ext://` custom protocol.

The host renderer renders an `ExtensionPanelPortal` placeholder that reports its layout bounds via `extension:update-panel-bounds` IPC. The main process creates and positions a `WebContentsView` over those bounds. The extension's `dist/index.html` loads in this isolated context with its own preload (`dist-electron/preload/webview.js`), giving it the full `window.electronAPI` surface via `contextBridge`.

Extensions declare all UI surfaces in `manifest.json` under `contributes`. The core app never runs extension renderer code — it reads the manifest and creates views accordingly. Extensions communicate with the main process via `extensionBridge.invoke` and `extensionBridge.on`, which route through their isolated preload to `ipcRenderer`.

---

## Considered Alternatives

### `<webview>` element (rejected)

Electron 42 explicitly discourages `<webview>` in favour of `WebContentsView`. The `<webview>` tag requires `webviewTag: true` in `BrowserWindow` webPreferences (a privileged flag), has a known quirky lifecycle, and is scheduled for eventual deprecation. `WebContentsView` provides the same isolation with a cleaner API and official support trajectory.

### `BrowserView` (rejected)

Deprecated since Electron 29 in favour of `WebContentsView`. Would require migration work within months of adoption.

### Sandboxed `iframe` with `srcdoc` (rejected)

Cannot load `ext://` URLs across origins. CSP restrictions prevent useful IPC patterns. No equivalent to `contextBridge` for injecting a typed API surface.

### Keep bundled renderer glob (rejected)

Maintains all three failure modes. Ruled out by the litmus test requirement: extensions must be installable from any directory without a core app rebuild.

---

## Consequences

**Positive:**

- Complete isolation: extensions can use any React version, any framework, or no framework at all.
- No app rebuild required to update extension UI — reload updates content instantly.
- Extensions are truly portable: install from any directory, works identically.
- `Cache-Control: no-store` on the `ext://` protocol guarantees fresh files on every load.

**Negative:**

- `WebContentsView` positioning is pixel-perfect but requires bounds synchronization on resize and scroll. `ExtensionPanelPortal` handles this via `ResizeObserver` + IPC.
- Each extension view is a full browser process — higher memory footprint than a shared context. Acceptable given typical extension counts (< 10).
- Extensions cannot directly access host renderer stores (Zustand). They receive context via URL params and `extensionBridge` push events. Extensions requiring workspace context subscribe to `workspace:changed` events.

---

## Implementation Notes

- `ExtensionViewHost` (`src/main/extensions/extension-view-host.ts`) manages the `WebContentsView` lifecycle.
- `ExtensionPanelPortal` (`src/renderer/components/ExtensionPanelPortal.tsx`) is the host-side placeholder component.
- `ext://` protocol handler in `src/main/index.ts` serves extension assets with `Cache-Control: no-store`.
- Webview preload: `src/main/preload-webview.ts` → compiled to `dist-electron/preload/webview.js`.
- Extension SDK types: `packages/extension-sdk/` — install with `npm install --save-dev @terminator/extension-sdk`.
