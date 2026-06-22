# ADR-021: Electron Upgrade — node-pty NAN Blocker (Resolved)

**Status**: Superseded — upgrade completed 2026-06-21  
**Date**: 2026-06-21

## Context

The audit (FR-019) flagged Electron 30.4.0 as end-of-life. An initial upgrade attempt to Electron 32 was deferred because `node-pty@1.0.0` and `1.1.0` use NAN (Native Abstractions for Node.js), which is incompatible with the C++20 requirement enforced by Electron 32+ Node.js headers.

## Resolution

`node-pty@1.2.0-beta.13` migrated from NAN to `node-addon-api` (NAPI). NAPI modules have no `NODE_MODULE_VERSION` constraint and compile cleanly against any Electron 32+ runtime.

**Upgrade applied**: `electron@30.4.0` → `electron@34.5.8`, `node-pty@1.0.0` → `node-pty@1.2.0-beta.13`.

`npm run rebuild` succeeds with only benign uninitialized-field warnings. All 4015 tests pass.

## Consequences

- App runs on Electron 34.5.8 (Node.js 20 LTS runtime, Chrome 132).
- `node-pty` is pinned at `1.2.0-beta.13` until the 1.2.x stable release; monitor for the stable tag.
- Previous Electron 30 CVEs are resolved by this upgrade.
