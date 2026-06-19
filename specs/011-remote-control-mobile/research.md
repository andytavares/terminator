# Research: Remote Control Mobile UI

**Feature**: `specs/011-remote-control-mobile`
**Date**: 2026-06-19

## Decision Log

---

### Decision 1: Mobile UI architectural home

**Decision**: New Vite entry point (`mobile.html`) inside `src/renderer-remote/`, built alongside the existing login SPA. Fastify serves it at `/mobile/` behind the same session-cookie auth used by `/app/`.

**Rationale**: The `vite.config.remote.ts` rollup config already uses named inputs (`index`, `shim`). Adding a third entry `mobile` produces a separate `mobile.html` + chunked JS in `out/renderer-remote/` — no new build pipeline, no extra Vite config file. The Fastify server already has a proven pattern for gating an HTML page behind a one-time ticket (`/app/` route in `remote-server.ts`), so the `/mobile/` route is a direct copy-adapt.

**Alternatives considered**:

- _Client-side router on `index.html`_: Would require Fastify to serve `index.html` for `/mobile/` URLs (SPA fallback config) and adds a routing library dependency. No gain over a second entry point.
- _Separate Vite config file_: Unnecessary overhead; rollup multi-input handles it cleanly.

---

### Decision 2: xterm.js renderer for mobile

**Decision**: Use `@xterm/xterm` v6.0.0 (the newer scoped package already in `package.json`) with its **default canvas renderer**. If canvas fails to initialize in a specific browser (detected via `Terminal` constructor throwing), catch and fall back to `new Terminal({ allowTransparency: false })` — the DOM renderer is not an explicit option in xterm v6; canvas is enabled automatically unless WebGL is requested.

**Rationale**: The user explicitly chose the canvas renderer. `@xterm/xterm` v6 dropped the legacy `xterm` namespace; the project already has both packages but the v6 scoped package is the intended forward path. Canvas renders correctly in Chrome on Android 12+ and Safari on iOS 16+; the known WebKit issues with xterm canvas are specific to WKWebView (used in native iOS apps) not mobile Safari (a full browser).

**Alternatives considered**:

- _DOM renderer_: Simpler, avoids all canvas issues, but significantly slower for high-throughput terminal output. Deferred to a fix-in-place fallback per the spec assumption.
- _xterm v5 (`xterm` package)_: Already used by the desktop renderer but the scoped v6 package is the project's current xterm; avoid mixing.

**Official docs**: https://xtermjs.org/docs/api/terminal/ — `@xterm/xterm` v6 changelog.

---

### Decision 3: Viewport detection for mobile redirect

**Decision**: In `App.tsx` (login page), after successful auth, check `window.innerWidth < 768` at the moment of redirect. Redirect phones (`< 768px`) to `/mobile/?t=<ticket>`, tablets/desktops (`≥ 768px`) to `/app/?t=<ticket>`.

**Rationale**: `window.innerWidth` is the CSS viewport width in CSS pixels, accounting for device pixel ratio and the browser's current zoom level. It is the correct value for matching a `@media (max-width: 767px)` breakpoint. Checking at redirect time (after login) is simpler than adding CSS media queries that must also work when the server decides which page to serve. The 768px threshold is the standard tablet-portrait boundary per the spec.

**Alternatives considered**:

- _User-Agent detection on server_: Brittle, breaks for unusual UA strings, requires maintenance. Rejected.
- _CSS media query redirect (JS `matchMedia`)_: Equivalent to `innerWidth < 768` check but slightly more semantic; either works, `innerWidth` is simpler.

---

### Decision 4: Terminal list API

**Decision**: Add `GET /api/terminals` to `terminal.routes.ts` that returns the array of all active sessions from the existing `sessions` Map.

**Rationale**: The mobile UI needs to enumerate active terminals on load. Currently only `GET /api/terminals/:sessionId` exists. Adding the list endpoint requires one `app.get` handler iterating the existing `sessions` Map — no schema change, no new data structures.

**Shape**: `Array<{ sessionId: string; cwd: string; createdAt: string }>` — matching the existing `TerminalSession` interface already in the file.

**Alternatives considered**:

- _Piggyback on `/api/workspaces`_: Terminals are not workspace-scoped at the server level (the PTY manager doesn't store workspace associations); the server can't provide that mapping. Mobile UI will label terminals by `cwd` and creation time.

---

### Decision 5: Auto-reconnect strategy

**Decision**: Use the [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) (`document.addEventListener('visibilitychange', ...)`) to detect when the page becomes visible again after backgrounding. On `visibilityState === 'visible'`, if the terminal WebSocket is closed, attempt re-fetch of a new WS ticket and reconnect. Retry up to 3 times with 2s delay between attempts; show a reconnecting banner during attempts and an error state with a retry button after all attempts fail.

**Rationale**: The Page Visibility API is supported in Safari iOS 16+ and Chrome Android 12+ (the spec's target browsers). It fires reliably on screen unlock and app switch. A new WS ticket must be fetched on reconnect because tickets are single-use (consumed on WebSocket upgrade in `WsTicketStore`).

**Official docs**: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API

**Alternatives considered**:

- _WebSocket `onerror`/`onclose` only_: Catches drops but not the visibility-triggered reconnect UX. Can be combined (and should be, as a fallback).
- _Service Worker keep-alive_: Out of scope per spec; no PWA caching in v1.

---

### Decision 6: on-screen keyboard and viewport height

**Decision**: Use the CSS `dvh` (dynamic viewport height) unit for the mobile terminal container height (`height: 100dvh`). `dvh` shrinks when the browser's address bar / on-screen keyboard is visible, so the terminal always fills exactly the visible area without JavaScript resize listeners.

**Rationale**: `dvh` is supported in Safari iOS 15.4+ and Chrome Android 108+, covering the spec's iOS 16 / Android 12 targets. The `xterm` FitAddon uses the container's current pixel dimensions, so `dvh`-based layout + a `ResizeObserver` (or FitAddon's `fit()` call on keyboard events) provides correct terminal sizing.

**Alternatives considered**:

- _`window.visualViewport.height` listener_: More code, solves the same problem as `dvh`, not needed with CSS unit support at target browser versions.
- _`vh` units_: Fixed to initial viewport; does NOT shrink when keyboard opens. Incorrect choice.

---

### Decision 7: Control toolbar key events

**Decision**: Send raw escape sequences directly to the PTY WebSocket as strings (same as xterm's natural input). Map:

- Ctrl+C → `\x03`
- Ctrl+D → `\x04`
- Tab → `\t`
- Escape → `\x1b`
- Arrow Up → `\x1b[A`
- Arrow Down → `\x1b[B`

**Rationale**: The xterm WebSocket protocol used by `@xterm/addon-attach` sends raw bytes to the PTY. These are the canonical terminal control sequences. No xterm API call is needed — write to the WS directly.

**Alternatives considered**:

- _xterm `Terminal.input()` method_: Would work if xterm is the WS owner, but writing raw bytes to the shared WebSocket is simpler since the WS is already managed by the component.

---

## Outstanding Risks

1. **Canvas renderer on Safari**: If testing reveals canvas rendering failures in Safari iOS 16 (possible in edge cases with strict Content-Security-Policy), the in-place fix is to use `@xterm/addon-webgl` or switch to a text-based rendering approach. This is not a design change.

2. **No terminal-to-workspace mapping at server level**: `GET /api/terminals` returns `cwd` and `createdAt` only — no workspace label. The mobile UI will display `cwd` (shortened to the last path component) as the terminal identifier.
