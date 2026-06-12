# Feature Specification: Remote Control Browser Access

**Feature Branch**: `remote-control`  
**Created**: 2026-06-11  
**Status**: Draft  
**Input**: User description: "read the prd in ~/Desktop/terminator-remote-control-prd.md and write a spec for it"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Enable Remote Access from Settings (Priority: P1)

A developer at their desk enables Remote Control in Terminator's Settings panel. The app immediately starts a local server and an ngrok tunnel, displays the generated public HTTPS URL and the current password, and the developer copies both to their phone. From that phone's browser they access the URL, enter the password when prompted, and see a working terminal.

**Why this priority**: This is the core unlock — without it no other remote story is possible. It defines the primary activation flow.

**Independent Test**: Can be fully tested by toggling on Remote Control in Settings, confirming a public URL appears, and loading it in a separate browser. Delivers full value as a standalone slice.

**Acceptance Scenarios**:

1. **Given** Remote Control is disabled, **When** the user toggles it on in Settings, **Then** a local server starts on the configured port and an ngrok tunnel is established within 10 seconds, displaying the public HTTPS URL in the Settings panel.
2. **Given** Remote Control is enabled and showing a URL, **When** the user opens that URL in a browser and enters the correct password, **Then** they see the remote browser UI with a connected terminal.
3. **Given** Remote Control is enabled, **When** the user toggles it off, **Then** the tunnel is torn down, the local server stops, and the public URL becomes unreachable within 5 seconds.
4. **Given** Remote Control is enabled and a session is active, **When** the Terminator app quits, **Then** the tunnel and server are shut down gracefully — no orphaned ngrok processes or port-in-use errors on next launch.

---

### User Story 2 - Browser Terminal Interaction (Priority: P1)

With Remote Control active, the developer opens the remote URL on a tablet. They create a new terminal, type commands, see the output in real time, resize the terminal to fit the screen, and close it when done.

**Why this priority**: Terminal streaming is the primary value of remote access — without it the feature has no meaningful utility.

**Independent Test**: With the server running locally (no tunnel needed for this test), open `http://localhost:<port>/` in a browser, interact with a terminal session end-to-end.

**Acceptance Scenarios**:

1. **Given** the browser UI is loaded, **When** the user creates a new terminal, **Then** a terminal emulator appears in the browser with an active shell prompt within 2 seconds.
2. **Given** an active browser terminal, **When** the user types a command and presses Enter, **Then** the output appears in the browser terminal with no perceptible delay (under 200ms round-trip on a local network).
3. **Given** an active browser terminal, **When** the user resizes the browser window, **Then** the terminal automatically resizes to fit, and the running shell program (e.g., `vim`, `htop`) redraws correctly.
4. **Given** an active browser terminal, **When** the user closes the terminal in the browser UI, **Then** the underlying PTY process is terminated and removed from the active session list.
5. **Given** an active browser terminal, **When** the terminal process exits naturally (e.g., `exit` command), **Then** the browser terminal shows the process-ended state and the session is cleaned up.

---

### User Story 3 - Password Protection (Priority: P1)

An unauthorized person who somehow learns the ngrok URL attempts to access it. They are blocked at the login step and cannot reach any terminal or app data.

**Why this priority**: Security is non-negotiable — an unprotected public URL to a live terminal would be a critical vulnerability.

**Independent Test**: With the server running, attempt to access `GET /api/workspaces` without credentials — must receive a rejection. Attempt with wrong password — must also be rejected. Attempt with correct password — must succeed.

**Acceptance Scenarios**:

1. **Given** Remote Control is enabled, **When** a request is made to any protected endpoint without credentials, **Then** the server returns an access-denied response and no app data is exposed.
2. **Given** Remote Control is enabled, **When** a request is made with an incorrect password, **Then** the server returns an access-denied response.
3. **Given** Remote Control is enabled and the user has set a custom password, **When** a request is made with that exact password, **Then** the server responds successfully.
4. **Given** Remote Control is enabled with an auto-generated password, **When** the user clicks "Generate new" in Settings, **Then** the old password is immediately invalidated, all active browser sessions are disconnected, and a new password is displayed.

---

### User Story 4 - Password Configuration (Priority: P2)

The developer opens Settings and sets their own memorable password for remote access. On the next enable, their custom password is used. Later they clear the field, and the app auto-generates a secure random password.

**Why this priority**: Password customization is a usability improvement over the random default — important but not blocking the core feature.

**Independent Test**: Set a custom password, disable and re-enable Remote Control, verify the custom password works for authentication.

**Acceptance Scenarios**:

1. **Given** the Settings panel is open, **When** the user types a custom password and saves, **Then** that password is stored and used for all subsequent authentication checks.
2. **Given** a custom password is set, **When** the user clears the password field and saves, **Then** the app auto-generates a new secure random password — the field is never left empty after saving.
3. **Given** no password has been set yet (first enable), **When** the user enables Remote Control, **Then** a secure random password is automatically generated and displayed in Settings.

---

### User Story 5 - Workspace and Project Browsing (Priority: P2)

From the remote browser UI, the developer can see their workspaces and projects — enough context to understand where they are and what terminal to open.

**Why this priority**: Navigation context improves usability significantly; without it users are forced to know paths from memory.

**Independent Test**: Load the browser UI, verify workspace/project list matches what is in the Terminator app.

**Acceptance Scenarios**:

1. **Given** the user is authenticated in the browser UI, **When** they view the workspace list, **Then** all workspaces match those visible in the Terminator desktop app.
2. **Given** the user selects a workspace, **When** they view its projects, **Then** the project list matches the Terminator desktop app state.
3. **Given** a new terminal is created from the browser UI, **When** the user selects a project context, **Then** the terminal opens with the correct working directory for that project.

---

### User Story 6 - ngrok Not Installed (Priority: P3)

The developer enables Remote Control on a machine where ngrok is not installed. The Settings panel explains this clearly and provides the install command, rather than silently failing.

**Why this priority**: Installation guidance prevents confusion when the binary is missing; the feature still partially works (LAN access) without it.

**Independent Test**: Mock `ngrok` as not found, enable Remote Control, verify a clear install hint is shown in Settings.

**Acceptance Scenarios**:

1. **Given** ngrok is not installed, **When** the user enables Remote Control, **Then** the local server starts and the LAN URL is shown, but the ngrok section shows a clear message that ngrok is not installed along with the install command (`brew install ngrok`).
2. **Given** ngrok is not installed and the install hint is shown, **When** the user installs ngrok and disables/re-enables Remote Control, **Then** the tunnel starts and the public URL appears.

---

### Edge Cases

- What happens when the configured port is already in use by another process? → The app surfaces a clear error (toast notification) prompting the user to change the port in Settings; the server does not start.
- What happens when ngrok fails mid-session (process crashes)? → The Settings UI shows "Tunnel disconnected"; the local server and LAN URL remain active; a toast notification appears with a manual "Reconnect" button — the user decides when to restart the tunnel. No automatic retry.
- What happens when the app is closed with an active remote browser session? → In-flight WebSocket connections receive a close frame; ngrok and the local server are terminated before the app exits.
- What happens if two Terminator instances try to use the same port? → Second instance fails with the port-collision error toast; first instance is unaffected.
- What happens when a browser terminal session is left open but idle? → No automatic timeout (P3 enhancement); session stays open until the browser disconnects or the user closes it.
- What happens when the remote user attempts to connect a second WebSocket to the same terminal session? → A second subscriber is allowed for output mirroring (read-only); only the first/primary WebSocket connection may send input to the PTY. Input from subsequent connections is silently dropped.

## Requirements _(mandatory)_

### Functional Requirements

**Server Lifecycle**

- **FR-001**: The system MUST start a local HTTP server bound exclusively to the loopback address when Remote Control is enabled, and stop it when disabled.
- **FR-002**: The local server MUST remain inaccessible from external network interfaces at all times — only tunnel traffic reaches it.
- **FR-003**: The system MUST spawn an ngrok tunnel process when Remote Control is enabled and the ngrok binary is available, and terminate that process when Remote Control is disabled.
- **FR-004**: The system MUST discover the active public URL from the ngrok local agent API after spawning the tunnel and display it in the Settings panel.
- **FR-005**: The system MUST display the LAN-accessible URL (machine IP + port) in the Settings panel regardless of whether ngrok is running.
- **FR-006**: The system MUST shut down the local server and ngrok process gracefully before the Electron app exits, ensuring no orphaned processes or port locks remain.
- **FR-006a**: If the ngrok process exits unexpectedly during an active session, the system MUST display a toast notification with a manual "Reconnect" button. The local server and LAN URL MUST remain active. The system MUST NOT auto-retry.
- **FR-006b**: All remote server events (tunnel start/stop, auth failures, connection errors, ngrok process crashes) MUST be written to the app's existing log window. No remote-control event may be silent.

**Authentication**

- **FR-007**: Every request to a protected endpoint MUST be rejected with an access-denied response if it does not carry the correct password credential. The password MUST be stored as a bcrypt hash; incoming credentials MUST be verified by comparing the provided value against the stored hash — never via plaintext comparison.
- **FR-008**: The system MUST reject requests where the `Host` header does not match `localhost`, `127.0.0.1`, or the active tunnel domain, to prevent DNS rebinding attacks.
- **FR-009**: The system MUST support a user-defined password configurable from the Settings panel.
- **FR-010**: The system MUST auto-generate a cryptographically random password on first enable when no password has been set, and whenever the user clears the password field and saves.
- **FR-011**: The system MUST NEVER allow an empty or no-password state — auto-generation is the fallback, not disabling auth.
- **FR-012**: Generating a new password MUST immediately invalidate all active browser sessions.

**Terminal Access**

- **FR-013**: The browser UI MUST allow creating a new terminal session, which starts a real PTY process on the host machine.
- **FR-014**: Terminal output MUST stream to the browser in real time via a persistent connection.
- **FR-015**: The browser terminal MUST accept user keyboard input and forward it to the host PTY.
- **FR-016**: The browser terminal MUST support dynamic resizing — when the browser window is resized, the PTY dimensions update accordingly.
- **FR-017**: Closing a terminal in the browser UI MUST terminate the associated PTY process on the host.
- **FR-018**: The system MUST clean up terminal sessions when a WebSocket connection is closed unexpectedly (network drop, browser tab closed).
- **FR-019**: WebSocket connections for terminal streaming MUST use a short-lived ticket mechanism to avoid credentials appearing in URLs or server logs. Tickets MUST expire after 30 seconds and be invalidated on first use.
- **FR-019a**: When multiple WebSocket clients connect to the same terminal session, all clients MUST receive the PTY output stream; only the first (primary) connection MAY send input to the PTY — input from all subsequent connections MUST be silently discarded.

**Settings UI**

- **FR-020**: The Settings panel MUST include a toggle to enable/disable Remote Control without requiring an app restart.
- **FR-021**: The Settings panel MUST show the active public URL with a one-click copy button while Remote Control is enabled.
- **FR-022**: The Settings panel MUST show whether ngrok is installed and provide the install command if it is not.
- **FR-023**: The Settings panel MUST show the password in a masked field with show/copy and "Generate new" actions.
- **FR-024**: The Settings panel MUST allow configuring the local server port (default 7681, valid range 1024–65535).

**Workspace / Project Navigation**

- **FR-025**: The browser UI MUST display the list of workspaces matching the current Terminator state.
- **FR-026**: The browser UI MUST display the projects within a selected workspace.
- **FR-027**: New terminal sessions MUST be openable with a specific project's directory as the working directory.

**Persistence**

- **FR-028**: The enabled/disabled state, port number, and password MUST survive app restarts.

### Key Entities

- **RemoteControlSettings**: Enabled state, port number, password plaintext (stored locally in electron-store for display in Settings UI), and a bcrypt hash of the password (used for request validation). Persisted across restarts.
- **RemoteSession**: Represented at runtime by a WebSocket connection tracked in `WsSubscriberManager`. The first connection to a terminal session is the primary subscriber (may send input); subsequent connections are read-only observers. No persistent storage — sessions exist only while the WebSocket connection is open.
- **TerminalSession**: An active PTY process on the host. Has a unique ID, working directory, dimensions (cols × rows), and an output stream that fans out to one or more WebSocket subscribers.
- **WsTicket**: A short-lived, single-use token issued per terminal WebSocket upgrade request. Expires after **30 seconds** and is consumed on first use — any unused ticket after 30 seconds is invalidated.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can go from "Remote Control disabled" to "browser terminal connected and accepting input" in under 30 seconds on a machine with ngrok installed.
- **SC-002**: Terminal output appears in the browser within 200ms of the host PTY producing it on a local network.
- **SC-003**: An unauthorized request (no password) to any protected endpoint is rejected 100% of the time — zero information leakage about workspace or terminal state.
- **SC-004**: The local server and ngrok process are fully stopped within 5 seconds of the user toggling Remote Control off.
- **SC-005**: The public URL changes on every enable/disable cycle — no two consecutive enable events produce the same URL.
- **SC-006**: Port-collision errors are surfaced to the user via a visible notification within 3 seconds of the enable attempt failing.
- **SC-007**: All new code reaches ≥ 80% test coverage (statements, branches, functions, lines) as enforced by the existing coverage gate.
- **SC-008**: The feature is off by default — zero network listeners are created when Remote Control has never been enabled.
- **SC-009**: All remote server events (tunnel start/stop, auth failures, connection errors, unexpected crashes) appear in the app's existing log window — no remote-control events are silent.

## Assumptions

- The user has `ngrok` installed via Homebrew or a direct download; the app will not install it automatically but will guide them if it is missing.
- A single password credential is sufficient for the initial version — no per-user accounts or roles.
- The browser remote UI is a minimal functional shell (terminal + workspace/project list); it does not replicate the full Terminator desktop UI (no task board, no PR review panel) in this version.
- The local server port defaults to 7681 and is user-configurable; the app does not attempt automatic port selection if 7681 is busy.
- The feature targets macOS (the primary platform for Terminator) but the server code has no macOS-specific dependencies.
- The remote browser SPA is a separate Vite build entry bundled with the app; it does not require a separate dev server or deployment step.
- Sessions are not persisted across app restarts — re-enabling Remote Control after a restart requires re-sharing the URL and password with any remote users.
- Multi-user collaborative terminal sharing (two people typing in the same PTY) is out of scope; the feature is single-owner only.

## Out of Scope

- Mobile-native app — browser only.
- Collaborative / multi-user sessions — single owner, one active session.
- Remote file upload/download (beyond what terminals naturally allow via CLI tools).
- Remote control of the Electron window (maximize, minimize, window management).
- TOTP/2FA at the app level.
- Git, task vault, and code review panels in the remote browser UI (Phase 3, deferred).
- Automatic ngrok installation by the app.
- Persistent public URLs across sessions.

## Clarifications

### Session 2026-06-11

- Q: When a second WebSocket client connects to an active terminal session, should it be able to send input to the PTY? → A: All clients receive output; only the first/primary connection may send input — subsequent connections are output-only (input silently discarded).
- Q: When ngrok crashes mid-session, should Terminator auto-retry or prompt the user manually? → A: Show a toast with a manual "Reconnect" button — no auto-retry. Local server and LAN URL stay active.
- Q: What is the WsTicket expiry window? → A: 30 seconds.
- Q: How should the password credential be stored and compared? → A: Stored as a bcrypt hash; incoming requests verified by bcrypt comparison — never plaintext.
- Q: Where should remote server errors and events be logged? → A: The app's existing log window — all remote-control events route there, no new log surface needed.
