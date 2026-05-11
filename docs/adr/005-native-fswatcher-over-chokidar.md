# ADR-005: Use Node.js Native `fs.watch` Instead of Chokidar

**Date**: 2026-05-07
**Status**: Accepted
**Branch**: `002-git-github-integration`

## Decision

Use Node.js native `fs.watch` (stdlib) as the primary file-change detection mechanism for the git integration sidebar, with a `setInterval` + `git status` polling fallback for environments where `fs.watch` is unreliable (network mounts, Docker bind volumes). Do not add `chokidar` or any other third-party file-watching library.

## Motivation

The Terminator Constitution (Principle II — Dependency Stewardship) mandates: _"The standard library MUST be used when it fully satisfies the requirement; a third-party package MUST NOT be added if stdlib covers the need."_

Node.js `fs.watch` covers the primary use cases:

- macOS: backed by `FSEvents`, reliable and efficient
- Windows: backed by `ReadDirectoryChangesW`, reliable
- Linux: backed by `inotify`, reliable for project-scale directories

The polling fallback (already required by FR-007 per the clarified spec) covers the minority of cases where `fs.watch` is unreliable, without requiring an external package.

## Alternatives Considered

### `chokidar` (rejected)

Chokidar provides cross-platform normalization, debouncing, and recursive watching on Linux using `inotify`. It is widely used and generally well-maintained.

**Rejection reasons**:

1. Constitution II requires stdlib when sufficient — chokidar is not required because our polling fallback already covers the same gap.
2. Historical maintainer risk: chokidar has gone through periods of low maintainer activity and security advisories. Adding it violates the spirit of Principle II.
3. Adding a dependency for a non-critical enhancement (smoother Linux recursive watch) is not justified when a polling fallback already ships.

### `@parcel/watcher` (rejected)

Native bindings, very fast, Parcel team maintained. Same rejection rationale as chokidar — stdlib fallback suffices, and the Constitution prohibits unnecessary third-party additions.

## Consequences

- Linux recursive watching relies on polling fallback when `fs.watch({ recursive: true })` is unavailable. This is acceptable: the default 3s interval is sufficient for git status updates.
- Zero new dependencies. Build size and supply-chain risk unchanged.
- The `FsWatcherService` is slightly more complex (must handle `fs.watch` errors and switch to polling) but this is bounded, testable logic.
