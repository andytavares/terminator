# Research: Webview-Isolated Extension System

**Feature**: 013-webview-extension-system
**Date**: 2026-06-24

---

## Decision 1: `WebContentsView` for Extension Rendering (NOT `<webview>`)

**Decision**: Use Electron `WebContentsView` (main-process-managed) for extension UI isolation.

**Rationale**:

- Electron 42 official documentation explicitly states: _"We currently recommend to not use the webview tag and to consider alternatives."_ The `<webview>` tag is based on Chromium's OOP-iframe path which is "undergoing dramatic architectural changes," causing instability in rendering, navigation, and event routing.
- `BrowserView` is deprecated since Electron 29.0.0 — not an option.
- `WebContentsView` is Electron's current recommended approach. It has a documented `setVisible(visible: boolean)` API (inherited from the `View` base class) for non-destructive hide/show — exactly what the eager+persistent model requires.
- `WebContentsView` preloads work with `contextIsolation: true` + `contextBridge` — fully documented and identical to BrowserWindow preloads.
- The project's aggressive Electron upgrade cadence (Electron 42.4.1, multiple bumps in recent git history) makes `<webview>` instability a near-certainty risk, not a theoretical concern. Constitution Principle I mandates grounding decisions in official vendor documentation; the official docs say don't use `<webview>`.

**Tradeoff accepted**: `WebContentsView` requires the main process to manage bounds (`view.setBounds(rect)`) and visibility. The renderer sends layout coordinates to main via IPC when the active panel changes or the window resizes. This is additional code, but stable and documented.

**Implementation consequence**: No `webviewTag: true` in BrowserWindow. No `<webview>` JSX. No `webview.d.ts`. The renderer renders placeholder divs ("panel portals") that report their bounds to the main process, which positions the `WebContentsView` to exactly overlay them.

**Alternatives considered**:

- `<webview>` tag: Explicitly deprecated by Electron team. `contextBridge` in webview preloads is undocumented. Rejected based on official Electron guidance.
- `BrowserView`: Deprecated since Electron 29. Rejected.
- `<iframe sandbox>`: Cannot use Electron IPC from inside a sandboxed iframe. Rejected.

**Official references**:

- https://www.electronjs.org/docs/latest/tutorial/web-embeds (recommends against `<webview>`)
- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://www.electronjs.org/docs/latest/api/view (`setVisible` API)

---

## Decision 2: `WebContentsView` Configuration and Preload

**Decision**: Each `WebContentsView` is constructed with `webPreferences: { contextIsolation: true, nodeIntegration: false, preload: join(__dirname, '../preload/webview.js') }`. No changes to `BrowserWindow.webPreferences` are needed (no `webviewTag: true`).

**Rationale**:

- `WebContentsView` constructor accepts identical `webPreferences` as `BrowserWindow`. The preload is specified as an absolute path, compiled by electron-vite from `src/main/preload-webview.ts` to `dist-electron/preload/webview.js`.
- `contextBridge.exposeInMainWorld('electronAPI', ...)` inside the webview preload works identically to BrowserWindow preloads — this is explicitly documented for `WebContentsView`.
- No renderer JSX changes needed. The renderer renders placeholder divs; `WebContentsView` is managed entirely in the main process.

**Official reference**: https://www.electronjs.org/docs/latest/api/web-contents-view

---

## Decision 3: Eager+Persistent WebContentsView Strategy

**Decision**: All enabled extension `WebContentsView` instances are created at app startup, added to `mainWindow.contentView`, and kept alive for the session. Visibility is controlled by `view.setVisible(false)` — NOT by destroying/recreating the view.

**Rationale**:

- User chose Option C (eager + persistent) — all views pre-created, no cold-start delay.
- `WebContentsView` inherits `setVisible(visible: boolean)` from the `View` base class (Electron 42, documented). Calling `setVisible(false)` hides the view without terminating its renderer process.
- The renderer sends `extension:set-panel-visibility` IPC to the main process when the active tab changes. Main calls `view.setVisible(isActive)` and `view.setBounds(bounds)`.
- The `WebContentsViewHost` in main keeps a `Map<string, WebContentsView>` keyed by extension ID.

**Official reference**: https://www.electronjs.org/docs/latest/api/view#viewsetvisiblevisible (inherited by WebContentsView)

---

## Decision 4: WebContentsView Layout — Bounds Coordination

**Decision**: The renderer renders placeholder divs ("panel portals") where extension content should appear. On tab switch or window resize, the renderer sends the placeholder's `DOMRect` to main via IPC. Main calls `view.setBounds({ x, y, width, height })`.

**Rationale**:

- `WebContentsView.setBounds(rect)` positions the view RELATIVE to the parent view (the window's content view). The `DOMRect` from `getBoundingClientRect()` in the renderer uses the same coordinate space.
- `devicePixelRatio` must be applied: `view.setBounds({ x: rect.x * dpr, y: rect.y * dpr, width: rect.width * dpr, height: rect.height * dpr })`.
- The renderer uses a `ResizeObserver` on the placeholder div to detect layout changes and immediately sends updated bounds to main.
- This is the same pattern used by Arc Browser, Figma desktop, and other Electron apps with embedded views.

**New IPC channel**: `extension:update-panel-bounds` — renderer → main, payload `{ id: string, bounds: { x, y, width, height }, visible: boolean }`.

---

## Decision 5: `ext://` Protocol — Cache-Control Headers

**Decision**: Add `Cache-Control: no-store` and `Pragma: no-cache` headers to all `ext://` protocol responses. Use the `Response` constructor's second argument (`{ headers }`) in `session.defaultSession.protocol.handle()`.

**Rationale**:

- Electron's `protocol.handle()` (Electron 25+) returns a standard WHATWG `Response`. Response headers are set in the second constructor argument.
- `no-store` prevents any caching (memory or disk). This ensures the webview always reads fresh files from disk when it (re)loads, which is the mechanism for extension updates taking effect after "Reload".
- Correct pattern:
  ```ts
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  })
  ```

**Official reference**: https://www.electronjs.org/docs/latest/api/protocol#protocolhandlescheme-handler

---

## Decision 6: ~~TypeScript JSX Declaration for `<webview>`~~ — NOT NEEDED

**Decision**: No `src/renderer/webview.d.ts` file is needed. The renderer does not render any `<webview>` elements. All extension views are `WebContentsView` instances managed by the main process.

The renderer renders standard `<div>` placeholder elements ("panel portals"). No custom JSX intrinsic types are required.

---

## Decision 7: Loading State — `did-finish-load` Event via IPC Push

**Decision**: Loading state is tracked in the renderer as a React `useState(true)`. The main process listens for `webContentsView.webContents.on('did-finish-load')` and sends an IPC push `extension:panel-loaded` with the extension ID to the renderer. The renderer dismisses the spinner on receipt.

**Pattern** (main process):

```ts
view.webContents.on('did-finish-load', () => {
  mainWindow.webContents.send('extension:panel-loaded', { id: extensionId })
})
```

**Pattern** (renderer):

```ts
useEffect(() => {
  return window.electronAPI.extensionEvents.onExtensionPanelLoaded((id) => {
    if (id === extensionId) setLoading(false)
  })
}, [extensionId])
```

**Official reference**: https://www.electronjs.org/docs/latest/api/web-contents#event-did-finish-load

---

## Decision 8: Extension Main Entry Format — CommonJS Required

**Decision**: Extension `main` entries MUST be compiled to CommonJS (`.cjs` or `module.exports` format). The extension-host uses Node's `require()` to load them.

**Rationale**:

- `extension-host.ts` uses `require(record.entryPoint)` — synchronous CommonJS module loading. ESM `import()` is async and would require significant changes to the extension-host lifecycle.
- electron-vite compiles the core app's main process to CJS. Extension main entries follow the same constraint.
- Extension developers must configure their bundler output to `format: 'cjs'` (Vite/Rollup) or `module.exports` (webpack CommonJS).

---

## Decision 9: Loading State — Spinner in Panel Portal

**Decision**: The renderer renders a spinner overlay inside the placeholder portal div while `loading === true`. When `extension:panel-loaded` arrives for this extension ID, `loading` is set to `false` and the spinner is hidden. The `WebContentsView` is simultaneously set visible.

**Pattern**:

```tsx
<div ref={portalRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
  {loading && (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
      }}
    >
      <LoadingSpinner label={extensionName} />
    </div>
  )}
</div>
```

---

## Decision 10: Panel Portal Layout — `ResizeObserver` + IPC

**Decision**: The `ExtensionPanelPortal` component uses a `ResizeObserver` on its container div to detect bounds changes and immediately sends `extension:update-panel-bounds` to main. The main process calls `view.setBounds()` and `view.setVisible()` in the same handler.

**Consequence**: `UnifiedSidebar.tsx`, the project tab area, and any other area that renders extension surfaces renders an `ExtensionPanelPortal` component for each registered extension surface. The portal is always mounted (React conditional rendering would break the ResizeObserver chain), and the portal sends `visible: false` when the tab is inactive so main calls `setVisible(false)`.

---

## Decision 11: Workspace Context Propagation to Webviews

**Decision**: Active workspace context (workspaceId, projectId, repoRoot) is passed to extension webviews via:

1. **URL parameters at mount time**: `ext://id/dist/index.html?workspaceId=...&projectId=...&repoRoot=...`
2. **IPC broadcast on change**: `workspace:changed` event sent from renderer → main → webview

**Rationale**: Since eager webviews are mounted at startup (possibly before a workspace is selected), URL params may be empty on first mount. Extensions must handle null workspace context gracefully. The `workspace:changed` broadcast keeps them updated.

**New IPC required**:

- `workspace:get-active` → returns `{ workspaceId: string | null, projectId: string | null, repoRoot: string | null }` — for on-demand queries from webviews.
- The renderer sends `workspace:active-changed` to main on workspace/project switch; main broadcasts to all webviews.

---

## Decision 12: Transitional Loader — Parallel Support During Migration

**Decision**: During migration, `loader.ts` supports both models simultaneously:

1. `import.meta.glob` path for un-migrated bundled extensions (no `renderer` field or `renderer` ends in `.tsx`).
2. Webview path for extensions with `renderer` pointing to an HTML file AND a `contributes` block.

Detection: `ext.rendererUrl?.endsWith('.html') && ext.contributes != null` → webview model.

This allows migrating extensions one at a time without breaking the app.

---

## Deferred / Out of Scope

- Extension marketplace / registry: not in this spec.
- `@terminator/extension-sdk` npm registry publication: deferred to follow-on.
- ESM extension main entries: deferred; requires async extension-host lifecycle changes.
- Scaffolding CLI (`create-terminator-extension`): deferred.
- `<webview>` tag usage: explicitly ruled out based on Electron 42 official documentation.
