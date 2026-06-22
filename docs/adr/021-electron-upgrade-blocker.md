# ADR-021: Electron Upgrade — node-pty NAN Blocker (Resolved)

**Status**: Superseded — upgrade completed 2026-06-21  
**Date**: 2026-06-21

## Context

The audit (FR-019) flagged Electron 30.4.0 as end-of-life. An initial upgrade attempt to Electron 32 was deferred because `node-pty@1.0.0` and `1.1.0` use NAN (Native Abstractions for Node.js), which is incompatible with the C++20 requirement enforced by Electron 32+ Node.js headers.

## Resolution

`node-pty@1.2.0-beta.13` migrated from NAN to `node-addon-api` (NAPI). NAPI modules expose a stable ABI with no `NODE_MODULE_VERSION` constraint, so a single `npm install` build loads across any Electron version.

**Upgrade applied**: `electron@30.4.0` → `electron@42.4.1`, `node-pty@1.0.0` → `node-pty@1.2.0-beta.13`.

Verified empirically: `node-pty` built against Node ABI 137 loads and spawns a PTY under Electron 42 (ABI 146) with no rebuild.

### `electron-rebuild` removed

Because `node-pty` is now NAPI and is the only runtime native module, the per-Electron `electron-rebuild` step is no longer needed. The `electron-rebuild` devDependency and the `npm run rebuild` script were removed. This also cleared the `electron-rebuild` → `cacache`/`node-gyp`/`tar`/`make-fetch-happen` chain of high-severity npm-audit advisories.

## Consequences

- App runs on Electron 42.4.1 (Chrome 136, Node.js 22 runtime).
- `node-pty` is pinned at `1.2.0-beta.13` until the 1.2.x stable release; monitor for the stable tag.
- No `electron-rebuild` / `npm run rebuild` step — `npm install` is sufficient.
- Previous Electron 30 CVEs are resolved by this upgrade.
