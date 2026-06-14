# Quickstart & Integration Scenarios: Remote Control Browser Access

**Feature**: `specs/009-remote-control-browser`  
**Purpose**: Manual end-to-end test scenarios to verify the feature works correctly from a user perspective. These complement the automated test suite — run them before reporting the feature complete.

---

## Prerequisites

- Terminator app built and running (`npm run dev` or packaged build)
- `ngrok` installed: `brew install ngrok` (optional — scenarios 1–3 work without it)
- A second browser or device on the same LAN for remote scenarios

---

## Scenario 1: Basic Enable/Disable Lifecycle

**Goal**: Verify SC-008 (zero ports open by default) and SC-001 (connected in ≤30s).

1. Launch Terminator. Open a terminal: `lsof -i :7681` → **expect**: no output (no listener).
2. Open Settings → Remote Control. Toggle **Enable** on.
3. **Expect**: "Remote Control" status changes to "Running on :7681" within 3 seconds.
4. In a separate terminal: `curl http://localhost:7681/health` → **expect**: `{"ok":true}` with HTTP 200.
5. Toggle **Enable** off.
6. **Expect**: status changes to "Stopped" within 5 seconds (SC-004).
7. `lsof -i :7681` → **expect**: no output.

---

## Scenario 2: Password Authentication

**Goal**: Verify FR-007, FR-011, SC-003 (100% unauthorized rejection).

1. Enable Remote Control with a custom password `testpass123`.
2. `curl http://localhost:7681/api/workspaces` → **expect**: HTTP 401 `{"error":"UNAUTHORIZED"}`.
3. `curl -H "Authorization: Bearer wrongpassword" http://localhost:7681/api/workspaces` → **expect**: HTTP 401.
4. `curl -H "Authorization: Bearer testpass123" http://localhost:7681/api/workspaces` → **expect**: HTTP 200 with workspace JSON.
5. Clear the password field and save. **Expect**: a new auto-generated password appears (field is not empty).
6. Old password `testpass123` no longer works: `curl -H "Authorization: Bearer testpass123" ...` → **expect**: HTTP 401.

---

## Scenario 3: Browser Terminal Interaction

**Goal**: Verify US2 end-to-end — create terminal, stream output, resize, close.

1. Enable Remote Control (password: `demo`).
2. Open `http://localhost:7681/` in a browser.
3. Enter password `demo` → **expect**: login succeeds, terminal UI loads.
4. A terminal appears with a shell prompt within 2 seconds.
5. Type `echo hello` and press Enter → **expect**: `hello` appears in the browser terminal (SC-002: <200ms).
6. Resize the browser window → **expect**: the terminal redraws correctly (no garbled output).
7. Type `exit` → **expect**: terminal session is cleaned up; browser shows session-ended state.

---

## Scenario 4: Port Change While Running

**Goal**: Verify FR-024 (auto-restart on port change).

1. Enable Remote Control on port 7681.
2. Confirm: `curl http://localhost:7681/health` → HTTP 200.
3. Change port to **7682** in Settings and save.
4. **Expect**: toast appears: "Remote Control restarted on port 7682".
5. `curl http://localhost:7681/health` → **expect**: connection refused.
6. `curl http://localhost:7682/health` → **expect**: HTTP 200.

---

## Scenario 5: Subscriber Limit

**Goal**: Verify FR-032 (configurable max subscribers, WS close code 4003).

1. Enable Remote Control (password: `demo`, maxSubscribers: 2).
2. Create a terminal session: `curl -X POST -H "Authorization: Bearer demo" -H "Content-Type: application/json" -d '{"cwd":"/tmp","type":"human","tabTitle":"test","scrollbackLimit":10000}' http://localhost:7681/api/terminals` → note `sessionId`.
3. Connect WebSocket client 1: obtain ticket, connect. **Expect**: connection established.
4. Connect WebSocket client 2: obtain ticket, connect. **Expect**: connection established.
5. Connect WebSocket client 3: obtain ticket, attempt connection. **Expect**: WebSocket closed with code `4003`.

---

## Scenario 6: Graceful Shutdown

**Goal**: Verify FR-006 (no orphaned processes) and SC-004.

1. Enable Remote Control with ngrok active (if installed).
2. Note the ngrok process PID: `pgrep ngrok`.
3. Quit Terminator (Cmd+Q).
4. `pgrep ngrok` → **expect**: empty output (process killed).
5. `lsof -i :7681` → **expect**: no output (port released).
6. Restart Terminator → **expect**: no "port already in use" errors.

---

## Scenario 7: LAN Access Without Tunnel

**Goal**: Verify US6 — browser access on local network without ngrok.

1. Enable Remote Control. Do NOT start ngrok.
2. Note the LAN URL shown in Settings (e.g., `http://192.168.1.x:7681`).
3. From a second device on the same network, open the LAN URL.
4. Enter the password → **expect**: terminal loads and works identically to localhost access.
5. Click "Copy Caddyfile" → **expect**: a Caddyfile config is copied to clipboard with the correct port and host.

---

## Scenario 8: ngrok Not Installed

**Goal**: Verify US7 — clear guidance when ngrok binary is absent.

1. Temporarily rename/remove ngrok: `which ngrok` → note path; `mv <path> <path>.bak`.
2. Enable Remote Control.
3. **Expect**: local server starts, LAN URL shown. ngrok section shows: "ngrok is not installed — run `brew install ngrok` to enable tunnel access." Tunnel URL field hidden.
4. Restore ngrok: `mv <path>.bak <path>`.
5. Disable and re-enable Remote Control → **expect**: ngrok starts and public URL appears.
