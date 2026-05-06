# ADR-002: Extension Host Runs in the Main Process (Phase 1)

**Date**: 2026-05-05  
**Status**: Accepted (supersede with Phase 2 ADR when separate process is introduced)

## Decision

Extensions are loaded as Node.js CommonJS modules directly in the **main process** via `require()`. They receive only the `ExtensionAPI` capability object and cannot import internal Terminator modules. Extension errors are caught at `activate()` and do not crash the host.

## Motivation

1. **Phase 1 scope**: The extension API surface is intentionally minimal (4 contribution points). A separate process host is over-engineering for this API surface (YAGNI).

2. **Implementation simplicity**: In-process loading avoids the full IPC bridge between extension host and main process that VS Code's architecture requires. That bridge is a significant engineering investment appropriate for a plugin ecosystem with hundreds of extensions; not for a Phase 1 with local-only installs.

3. **Capability-based boundary**: Passing only the `ExtensionAPI` object (rather than `require`-ing internal modules) provides an acceptable permission boundary for Phase 1 (FR-029). Extensions cannot call internal functions they are not given.

## Alternatives Considered

- **Separate extension host process** (VS Code model): Correct long-term architecture. Deferred to Phase 2 when the extension API grows and process isolation becomes necessary for stability.
- **VM sandbox (`vm.runInNewContext`)**: Provides code isolation but prevents extensions from using npm packages, which would make real-world extension development impractical.

## Consequences

- A crashing extension can throw into the main process. The `activate()` call is wrapped in `try/catch`. Runtime errors from extension callbacks are also caught per-callback.
- Extensions have access to the full Node.js runtime (filesystem, network) — they are trusted locally-installed packages, analogous to VS Code extensions. No sandboxing of filesystem or network access in Phase 1.
- When Phase 2 introduces a separate host process, this ADR is superseded and extensions must be migrated to the new IPC-based API.
