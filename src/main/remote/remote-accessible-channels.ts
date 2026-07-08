// Core IPC channels the remote-control bridge (the browser `/app/` full-renderer
// surface) is permitted to reach.
//
// DERIVED, not hand-maintained: the channel manifest
// (src/shared/electron-api/manifest.ts) declares every electronAPI method once,
// including its remote behavior ('same' | 'stub' | 'omit'). This set is exactly
// the channels declared 'same' — the ones the generated remote shim actually
// sends over the bridge. Changing the remote surface therefore happens in the
// manifest, and `manifest.spec.ts` pins the full expected channel list so any
// widening or shrinking shows up as a reviewable test diff.
//
// Default-deny: any core channel NOT in this set is rejected by the bridge.
// Extension-owned channels are not listed here — their reachability is recorded
// per registration in the bridge registry (see channel-registrar.ts and
// api.ipc.registerHandler).
//
// SECURITY NOTE: `shell:exec` is intentionally included. The `/app/` surface is the
// full Electron renderer served behind password + single-use ticket + session cookie
// + failed-auth rate limiting, on a `0.0.0.0`-bound server (LAN/ngrok). `shell:exec`
// remains sandboxed (allowlist git/gh only, cwd-pinned, shell:false) — see ADR-006.
// The accepted residual risk (an authenticated remote client can run git/gh as the
// user) is documented in ADR-017.

import { remoteAccessibleCoreChannels } from '../../shared/electron-api/manifest.js'

export const REMOTE_ACCESSIBLE_CHANNELS: ReadonlySet<string> = remoteAccessibleCoreChannels()
