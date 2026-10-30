# ADR-002: Extension Host Runs in the Main Process (Phase 1)

**Date**: 2026-05-05  
**Status**: Accepted (supersede with Phase 2 ADR when separate process is introduced)

## Decision

The **main process** loads extensions as Node.js CommonJS modules directly via `require()`. Extensions receive only the `ExtensionAPI` capability object. They cannot import internal Terminator modules. The host catches extension errors at `activate()`, so they do not crash the host.

## Motivation

1. **Phase 1 scope**: The extension API surface is intentionally minimal (4 contribution points). A separate process host is over-engineering for this surface (YAGNI).

2. **Implementation simplicity**: In-process loading avoids the full IPC bridge between extension host and main process that VS Code's architecture requires. That bridge is a significant engineering investment. It suits a plugin ecosystem with hundreds of extensions, not a Phase 1 with local-only installs.

3. **Capability-based boundary**: Passing only the `ExtensionAPI` object (rather than `require`-ing internal modules) gives an acceptable permission boundary for Phase 1 (FR-029). Extensions cannot call internal functions they are not given.

## Alternatives Considered

- **Separate extension host process** (VS Code model): Correct long-term architecture. Deferred to Phase 2, when the extension API grows and process isolation becomes necessary for stability.
- **VM sandbox (`vm.runInNewContext`)**: Gives code isolation but stops extensions from using npm packages. That would make real-world extension development impractical.

## Consequences

- A crashing extension can throw into the main process. The `activate()` call is wrapped in `try/catch`. The host also catches runtime errors from extension callbacks per callback.
- Extensions have access to the full Node.js runtime (filesystem, network). They are trusted, locally installed packages, like VS Code extensions. Phase 1 does not sandbox filesystem or network access.
- When Phase 2 introduces a separate host process, it supersedes this ADR. Extensions must then migrate to the new IPC-based API.
