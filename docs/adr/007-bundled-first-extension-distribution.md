# ADR-007: Bundled-First Extension Distribution (No Marketplace in v1)

**Date**: 2026-05-07
**Status**: Accepted
**Branch**: `002-git-github-integration`

## Decision

The git integration extension ships pre-bundled with the application at `extensions/git-integration/`. At startup, the `ExtensionHost` automatically loads all subdirectories of `extensions/` as built-in extensions. Users install third-party extensions from a local directory path via the existing `extension:install` IPC channel. v1 builds no hosted extension marketplace or remote registry.

## Motivation

The spec clarified (Q4 in `/speckit-clarify` session 2026-05-07) that extension distribution should use "bundled + local install" for v1. This decision is consistent with:

1. **YAGNI (Constitution V)**: A marketplace needs infrastructure (hosting, versioning, signing, discovery) that is beyond current scope. The git integration is the only planned first-party extension for v1.
2. **The existing `extension:install` channel** already supports installing from a local `directoryPath`. Local installs need no new infrastructure.
3. **Simplicity**: Bundled extensions load deterministically at startup. There are no network calls, no registry lookups, and no version resolution at install time.

## Alternatives Considered

### Hosted extension marketplace (rejected)

It would require a package registry (npm-like or custom), extension signing for security, a discovery/search UI, version management, and CDN hosting. All of this is beyond v1 scope and would need significant ongoing infrastructure maintenance.

### Install from URL (rejected)

Downloading extensions from arbitrary URLs introduces supply-chain risk without a code-signing infrastructure. Rejected until a proper security model for remote extension distribution exists.

## Consequences

- All first-party extensions must be included in the repository under `extensions/`. This is acceptable given the small number of planned first-party extensions.
- Community extension authors install their extensions by pointing the app at a local build directory. This is sufficient for developer workflows.
- A future version can introduce a marketplace with a new ADR that covers the security and infrastructure design.
- The `directoryPath` parameter of the `extension:install` channel must point to a directory that contains a valid `manifest.json`. The `ExtensionHost` validates the manifest on install.
