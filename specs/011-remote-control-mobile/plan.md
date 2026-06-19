# Implementation Plan: Remote Control Mobile UI

**Branch**: `011-remote-control-mobile` | **Date**: 2026-06-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/011-remote-control-mobile/spec.md`

## Summary

Extend the Remote Control extension's browser UI to support phones. After login, the `renderer-remote` app detects viewport width (< 768px) and redirects phones to `/mobile/` — a new purpose-built mobile terminal UI — while tablets and desktops continue to `/app/` unchanged. The mobile UI is a second Vite entry point in `src/renderer-remote/`, served by the same Fastify server behind a new `/mobile/` auth-gated route. It provides a workspace/terminal list, full-screen xterm.js terminal view with a control-key toolbar, and auto-reconnect on page visibility change.

## Technical Context

**Language/Version**: TypeScript 5.x + React 18.3.1 + Vite 5.x (renderer-remote); Node.js 20 + Fastify 4.28.1 (server)
**Primary Dependencies**: `@xterm/xterm` 6.0.0, `@xterm/addon-fit` 0.11.0, `@xterm/addon-attach` 0.12.0, `@fastify/static` 7.0.4, `@fastify/websocket` 8.3.1, `react` 18.3.1, `lucide-react`
**Storage**: None (no new persistent storage; auth session cookie mirrors existing pattern)
**Testing**: vitest + @testing-library/react; existing patterns in `tests/unit/renderer-remote/`
**Target Platform**: Mobile Safari iOS 16+, Chrome Android 12+ (browser-based, no install)
**Project Type**: Browser web-app (SPA) + extension server route additions
**Performance Goals**: Mobile UI interactive within 3 seconds; terminal creation in < 3 seconds (SC-005, SC-007)
**Constraints**: 375px min viewport width; `dvh` CSS units for keyboard-safe layout; canvas renderer (xterm default)
**Scale/Scope**: Single-user (personal remote access); 1–10 concurrent terminals typical

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                        | Status | Notes                                                                                                                                                                                                                                                   |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Source Integrity              | PASS   | All decisions cite official xterm.js, MDN, and Fastify docs                                                                                                                                                                                             |
| II. Extension Isolation          | PASS   | Server route changes are IN `extensions/remote-control/src/`. Frontend changes are in `src/renderer-remote/` (core app). Extension serves files from core build output — permitted pattern (mirrors `/app/` today). No extension imports from core src. |
| IV. Dependency Stewardship       | PASS   | No new npm dependencies. All packages already in `package.json`.                                                                                                                                                                                        |
| V. Code Readability & Minimalism | PASS   | Two new React components + one hook + one CSS file. No abstraction beyond what the spec requires.                                                                                                                                                       |
| VI. TDD (NON-NEGOTIABLE)         | PASS   | Test files authored before/alongside implementation; 80% coverage gate enforced.                                                                                                                                                                        |
| VII. SOLID & YAGNI               | PASS   | No extensibility layers. Mobile route mirrors `/app/` exactly; no generalization.                                                                                                                                                                       |
| VIII. Documentation              | PASS   | `quickstart.md`, `contracts/api-changes.md`, `data-model.md` ship with the feature.                                                                                                                                                                     |
| IX. ADRs                         | PASS   | Research decisions recorded in `research.md` per the project's lightweight ADR practice.                                                                                                                                                                |
| X. Code Cleanliness              | PASS   | `npm run lint` + `npx vitest run --coverage` must pass before done.                                                                                                                                                                                     |
| XII. UI Icons                    | PASS   | All mobile UI icons use `lucide-react`.                                                                                                                                                                                                                 |

## Project Structure

### Documentation (this feature)

```text
specs/011-remote-control-mobile/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research decisions
├── data-model.md        # Phase 1 data model
├── quickstart.md        # Phase 1 quickstart
├── contracts/
│   └── api-changes.md   # New and changed API endpoints
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code

```text
src/renderer-remote/
├── index.html                          # Login SPA entry (unchanged)
├── mobile.html                         # NEW: Mobile SPA entry point
├── App.tsx                             # MODIFY: add viewport check → redirect to /mobile/
├── Login.css                           # Unchanged
├── main.tsx                            # Unchanged (login SPA boot)
├── mobile.main.tsx                     # NEW: Mobile SPA boot
├── mobile.css                          # NEW: Mobile layout styles
├── MobileApp.tsx                       # NEW: Root mobile component (route: list | terminal)
├── api/
│   └── remote-client.ts                # MODIFY: add listTerminals()
├── components/
│   ├── MobileTerminalList.tsx          # NEW: Workspace + terminal list with "New Terminal"
│   ├── MobileTerminalView.tsx          # NEW: Full-screen xterm view + reconnect logic
│   └── MobileControlToolbar.tsx        # NEW: Ctrl+C / Ctrl+D / Tab / Esc / ↑ / ↓ buttons
└── hooks/
    └── useReconnect.ts                 # NEW: Page Visibility API reconnect hook

extensions/remote-control/src/server/
├── remote-server.ts                    # MODIFY: add /mobile/ route + /api/mobile-ticket
└── routes/
    └── terminal.routes.ts              # MODIFY: add GET /api/terminals (list all)

vite.config.remote.ts                   # MODIFY: add mobile entry point

tests/unit/renderer-remote/
├── App.spec.tsx                        # MODIFY: add viewport-redirect test cases
└── mobile/
    ├── MobileApp.spec.tsx              # NEW
    ├── MobileTerminalList.spec.tsx     # NEW
    ├── MobileTerminalView.spec.tsx     # NEW
    ├── MobileControlToolbar.spec.tsx   # NEW
    └── useReconnect.spec.ts            # NEW
```

## Complexity Tracking

_No constitution violations._

## Implementation Notes

### Login redirect (App.tsx)

After the successful ticket fetch, before `location.replace`:

```ts
const isMobile = window.innerWidth < 768
const dest = isMobile ? '/mobile/' : '/app/'
location.replace(`${dest}?t=${encodeURIComponent(ticket)}`)
```

The mobile ticket endpoint (`POST /api/mobile-ticket`) is called only when `isMobile` is true; the existing `POST /api/app-ticket` is called for desktops.

### Control toolbar key sequences

Button → PTY bytes:

- Ctrl+C → `\x03`
- Ctrl+D → `\x04`
- Tab → `\t`
- Escape → `\x1b`
- Arrow Up → `\x1b[A`
- Arrow Down → `\x1b[B`

Written directly to the terminal WebSocket (not via xterm API) — same channel as typed input.

### Viewport height (keyboard safe)

Mobile terminal container: `height: 100dvh` — shrinks when address bar or on-screen keyboard is visible. `FitAddon.fit()` called on `ResizeObserver` callback attached to the container div.

### Server: /mobile/ route

Mirrors the `/app/` route in `remote-server.ts`:

1. `GET /mobile/` validates ticket, issues `mobile-session` cookie, serves `out/renderer-remote/mobile.html`.
2. Session cookie check added to the existing `onRequest` hook for paths starting with `/mobile/` (excluding `/mobile/` itself).
3. `@fastify/static` with prefix `/mobile` pointing to `loginStaticDir` (same `out/renderer-remote/` directory).
