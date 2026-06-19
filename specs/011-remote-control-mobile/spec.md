# Feature Specification: Remote Control Mobile UI

**Feature Branch**: `011-remote-control-mobile`
**Created**: 2026-06-19
**Status**: Draft
**Input**: User description: "the remote control extension is awesome but i'd like to see if there's a quick/easy way to make it mobile friendly? Currently it only is effective if i'm viewing it on a desktop or a larger tablet i'd like to be able to check in/interact with the app on my phone as well"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - View and Interact with Terminals on Phone (Priority: P1)

A developer away from their desk opens the Remote Control URL on their phone. After logging in, they see a touch-friendly list of their active workspaces and terminals. They tap a terminal, it opens full-screen, and they can type commands, scroll through output, and navigate back to pick a different terminal — all without pinching or zooming.

**Why this priority**: This is the core scenario — the existing login page already works on mobile, but the `/app/` view (the full desktop UI) is unusable on a phone. The entire value of the feature is unlocked here.

**Independent Test**: With Remote Control running locally, open the URL on a phone browser (or a Chrome DevTools mobile viewport), log in, select a terminal, type a command, and verify the output is readable without zooming.

**Acceptance Scenarios**:

1. **Given** the user opens the remote URL on a phone, **When** they log in, **Then** they land on a mobile-optimized view (not the full desktop UI) that shows their workspaces and terminals in a readable, touch-friendly layout.
2. **Given** the mobile terminal list, **When** the user taps a terminal, **Then** the terminal opens in a full-screen view, input is focused, and the on-screen keyboard does not obscure the output area.
3. **Given** a mobile terminal is open, **When** the user types a command and submits, **Then** output appears in real time with no perceptible delay.
4. **Given** a mobile terminal is open, **When** the user scrolls up through output, **Then** scrolling behaves naturally with touch gestures (no accidental page zoom, no scroll-trapped areas).
5. **Given** a mobile terminal is open, **When** the user navigates back, **Then** they return to the terminal list and the terminal session remains active.

---

### User Story 2 - Send Common Key Sequences from Phone (Priority: P2)

While troubleshooting via phone, the user needs to send Ctrl+C to cancel a running process. A persistent toolbar above the keyboard provides one-tap buttons for common control keys (Ctrl+C, Ctrl+D, Tab, Escape, arrow keys) since phones have no physical keyboard shortcuts.

**Why this priority**: A terminal without control-key access is severely limited — users can't cancel processes, navigate shell history, or trigger completion. This turns the mobile view from "read-only" to genuinely interactive.

**Independent Test**: With a mobile terminal open and a long-running process active, tap the Ctrl+C button and verify the process is cancelled.

**Acceptance Scenarios**:

1. **Given** a mobile terminal is open, **When** the user views the keyboard toolbar, **Then** buttons for Ctrl+C, Ctrl+D, Tab, Escape, and arrow keys (↑ ↓) are visible above the on-screen keyboard.
2. **Given** a mobile terminal with a long-running command, **When** the user taps Ctrl+C, **Then** the process receives a SIGINT and the shell returns to the prompt.
3. **Given** a mobile terminal, **When** the user taps the ↑ arrow button, **Then** the previous shell history entry is recalled (same as pressing the up arrow key).
4. **Given** a mobile terminal, **When** the user taps Tab, **Then** shell completion is triggered.

---

### User Story 3 - Create a New Terminal from Mobile (Priority: P2)

The developer opens the mobile UI and finds no active terminals, or wants to start a fresh session. They tap a "New Terminal" button next to a workspace, and a new terminal spawns in that workspace — visible and interactive immediately on the phone.

**Why this priority**: Without the ability to create terminals, mobile is pure read-only. A single "New Terminal" button per workspace is the minimum viable creation flow.

**Independent Test**: With no active terminals, open the mobile UI, tap "New Terminal" on a workspace, and verify a terminal appears and accepts input.

**Acceptance Scenarios**:

1. **Given** the mobile terminal list is empty (no active terminals), **When** the user views it, **Then** each workspace shows a "New Terminal" button rather than a blank or error state.
2. **Given** workspaces are listed with "New Terminal" buttons, **When** the user taps one, **Then** a new terminal is created in that workspace and the user is taken directly to the mobile terminal view for it.
3. **Given** one or more terminals are already active, **When** the user views the terminal list, **Then** the "New Terminal" button remains accessible alongside existing terminals (not hidden once terminals exist).

---

### User Story 4 - Switch Between Terminals Without Losing Sessions (Priority: P3)

The developer has multiple terminals open (e.g., one running a server, one for git — started from desktop or created via the mobile UI). From the mobile terminal list they can switch between them freely, with each terminal preserving its scroll position and running processes.

**Why this priority**: Multi-terminal navigation is essential for real-world use but can be delivered after the single-terminal experience is solid.

**Independent Test**: Open two terminals (from desktop or via the mobile "New Terminal" button), then switch between them from the phone mobile UI and verify each session is intact.

**Acceptance Scenarios**:

1. **Given** multiple active terminals exist, **When** the user views the mobile terminal list, **Then** each terminal is shown with its workspace name and a brief preview of recent output (last line).
2. **Given** the user is viewing terminal A, **When** they navigate back and tap terminal B, **Then** terminal B opens at its current scroll position with its process still running.
3. **Given** a terminal's process exits while the user is viewing a different terminal, **When** the user returns to the terminal list, **Then** the exited terminal is marked as ended (not silently removed).

---

### Edge Cases

- What happens when the phone browser loses network connectivity or goes to background while a terminal is open? When the page becomes visible again, the mobile UI MUST automatically attempt to re-establish the WebSocket connection and resume the terminal session. A visible reconnecting indicator is shown during the attempt; if reconnection fails after 3 attempts, a clear error state is shown with a manual retry button.
- What happens when the on-screen keyboard opens and reduces the viewport height? The terminal output area must shrink to remain visible above the keyboard — not scroll behind it.
- What happens when a terminal produces very wide output (e.g., a wide table)? Lines should be scrollable horizontally within the terminal area without breaking the page layout.
- What happens when Remote Control is disabled while a mobile session is active? The user should see a clear "Server disconnected" state, not a blank or broken page.

## Clarifications

### Session 2026-06-19

- Q: Where does the mobile terminal UI live — new route in renderer-remote, responsive CSS on /app/, or separate build? → A: New mobile route in `renderer-remote`; login detects viewport width and redirects phones to `/mobile/`, a purpose-built terminal UI with no Electron renderer loaded.
- Q: What does the mobile terminal list show when there are no active terminals? → A: Show workspaces with a "New Terminal" button that creates a terminal remotely.
- Q: What happens when the phone backgrounds the browser and the WebSocket drops? → A: Auto-reconnect — when the page becomes visible again, attempt to re-establish the WebSocket and resume the terminal session automatically.
- Q: Which xterm.js renderer for mobile — canvas (default) or DOM (broader Safari compat)? → A: Canvas renderer. If canvas causes Safari issues during implementation, fall back to DOM as a fix, not a redesign.
- Q: What viewport width cutoff triggers the /mobile/ redirect vs /app/? → A: 768px — viewports narrower than 768px go to /mobile/, 768px and above go to /app/.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: After login, the `renderer-remote` app MUST detect viewport width and redirect accordingly: viewports narrower than 768px go to `/mobile/`; viewports 768px and wider go to `/app/` as before. The 768px threshold is a hard requirement, not a heuristic.
- **FR-002**: The mobile layout MUST display a scrollable list of workspaces and their terminals without requiring horizontal scrolling or zooming. Each workspace MUST include a "New Terminal" button that creates a terminal in that workspace.
- **FR-002a**: When no terminals exist, the mobile landing screen MUST show workspaces with "New Terminal" buttons rather than a blank or error state.
- **FR-003**: Tapping a terminal in the mobile list MUST open a full-screen terminal view that fills the available viewport height above the on-screen keyboard.
- **FR-004**: The mobile terminal view MUST include a persistent control-key toolbar with at minimum: Ctrl+C, Ctrl+D, Tab, Escape, ↑ (up arrow), ↓ (down arrow).
- **FR-005**: The mobile terminal view MUST support natural touch scrolling through terminal output without triggering accidental page zoom.
- **FR-006**: The mobile terminal view MUST provide a visible back navigation control to return to the terminal list.
- **FR-007**: The web UI MUST include a `viewport` meta tag that disables user-agent scaling (`user-scalable=no`) on the app page to prevent pinch-zoom interfering with terminal interaction.
- **FR-008**: When the on-screen keyboard opens, the terminal output area MUST dynamically resize so the input line remains visible and output does not scroll behind the keyboard.
- **FR-009**: The mobile layout MUST display terminal output in a readable monospace font at a size legible on a phone screen without zooming (minimum 14px effective size).
- **FR-010**: Terminal connections MUST be maintained when the user navigates between the terminal list and an individual terminal within the same session.
- **FR-012**: When the mobile page regains visibility (e.g., after phone screen unlock or app switch), the UI MUST automatically attempt to reconnect the WebSocket. A visible reconnecting indicator MUST be shown during reconnection attempts. After 3 failed attempts the UI MUST show an error state with a manual retry button — not a blank screen.
- **FR-011**: The mobile UI MUST work on the current versions of Safari on iOS and Chrome on Android without requiring any app installation.

### Key Entities

- **Mobile Terminal View**: The full-screen terminal component rendered on phone-width viewports, including the output area, input field, and control-key toolbar.
- **Control-Key Toolbar**: A persistent row of touch buttons that send special key sequences to the active terminal PTY.
- **Terminal List**: The mobile landing screen showing all active terminals grouped by workspace with last-line output previews.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user on a phone can open a terminal, run a command, and read the output without zooming or horizontal scrolling on a 375px-wide viewport (iPhone SE width).
- **SC-002**: The on-screen keyboard opens and closes without the terminal input line becoming obscured or inaccessible.
- **SC-003**: All control-key toolbar buttons (Ctrl+C, Ctrl+D, Tab, Escape, ↑, ↓) successfully deliver the correct key event to the terminal shell in manual testing.
- **SC-004**: Switching between two active terminals from the mobile terminal list completes in under 1 second without session loss.
- **SC-005**: The mobile UI loads and is interactive within 3 seconds on a typical mobile network connection (after authentication).
- **SC-006**: The feature works in Safari on iOS 16+ and Chrome on Android 12+ with no installation required.
- **SC-007**: Tapping "New Terminal" on a workspace creates an interactive terminal and navigates to it within 3 seconds.

## Assumptions

- The mobile UI lives in `renderer-remote` as a new `/mobile/` route — a purpose-built terminal UI served by the same Fastify server. It does not load the full Electron renderer.
- The existing ngrok tunnel and authentication flow are unchanged — mobile users authenticate via the same password-protected URL.
- The desktop experience (`/app/` rendering the full Electron renderer) remains available for tablet and desktop browsers; the mobile layout is an addition, not a replacement.
- "Mobile" means viewports narrower than 768px (portrait phones in both orientations). Viewports ≥ 768px (tablets in landscape, desktops) use the existing desktop layout. This threshold is defined in FR-001.
- xterm.js (already used in the desktop renderer) is the terminal emulator for mobile, using its default canvas renderer. If the canvas renderer causes rendering failures in Safari on iOS during implementation, switching to the DOM renderer is an acceptable in-place fix that does not require a spec revision.
- No offline/PWA caching is in scope for this iteration; reconnection behavior is a best-effort UX improvement.
- The control-key toolbar covers the most common developer needs; a full software keyboard or custom IME is out of scope.
