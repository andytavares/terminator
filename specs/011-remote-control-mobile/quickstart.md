# Quickstart: Remote Control Mobile UI

## Prerequisites

- Node.js 20+
- Terminator development environment already set up (see root `README.md`)
- An ngrok auth token configured (for remote access; local testing does not require it)

## Testing the Mobile UI Locally

1. **Start the dev build**:

   ```sh
   npm run dev
   ```

2. **Enable Remote Control** in Terminator Settings → Remote Control → toggle on.

3. **Open Chrome DevTools** (or any Chromium browser) and switch to mobile viewport:

   - Press `F12` → Device Toolbar (phone icon)
   - Set width to `375px` (iPhone SE) or `390px` (iPhone 14)

4. **Navigate to** `http://localhost:<port>/` (port shown in Remote Control settings).

5. **Log in** with the displayed password. Because the viewport is < 768px, you will be redirected to `/mobile/` instead of `/app/`.

6. **Verify**:
   - Terminal list shows active sessions and workspace "New Terminal" buttons
   - Tapping a terminal opens full-screen view
   - Control toolbar (Ctrl+C, Ctrl+D, Tab, Esc, ↑, ↓) is visible above the input area

## Running Tests

```sh
# All renderer-remote tests (includes mobile):
npx vitest run tests/unit/renderer-remote/

# Coverage (must stay ≥ 80%):
npx vitest run --coverage
```

## Building

```sh
# Builds both login SPA and mobile SPA into out/renderer-remote/:
npm run build:remote
```

The mobile build output is `out/renderer-remote/mobile.html` + shared assets in `out/renderer-remote/assets/`.

## File Locations

| Purpose                             | Path                                                             |
| ----------------------------------- | ---------------------------------------------------------------- |
| Mobile HTML entry                   | `src/renderer-remote/mobile.html`                                |
| Mobile app root                     | `src/renderer-remote/MobileApp.tsx`                              |
| Terminal list component             | `src/renderer-remote/components/MobileTerminalList.tsx`          |
| Terminal view component             | `src/renderer-remote/components/MobileTerminalView.tsx`          |
| Control toolbar component           | `src/renderer-remote/components/MobileControlToolbar.tsx`        |
| Reconnect hook                      | `src/renderer-remote/hooks/useReconnect.ts`                      |
| Mobile CSS                          | `src/renderer-remote/mobile.css`                                 |
| Server route (new `/mobile/` route) | `extensions/remote-control/src/server/remote-server.ts`          |
| New API endpoint                    | `extensions/remote-control/src/server/routes/terminal.routes.ts` |
| Tests                               | `tests/unit/renderer-remote/mobile/`                             |
