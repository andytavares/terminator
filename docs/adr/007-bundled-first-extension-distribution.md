# ADR-007: Bundled-First Extension Distribution (No Marketplace in v1)

**Date**: 2026-05-07
**Status**: Accepted
**Branch**: `002-git-github-integration`

## Decision

The git integration extension ships pre-bundled with the application at `extensions/git-integration/`. The `ExtensionHost` loads all subdirectories of `extensions/` automatically at startup as built-in extensions. Third-party extensions are installed from a local directory path via the existing `extension:install` IPC channel. No hosted extension marketplace or remote registry is built in v1.

## Motivation

The spec clarified (Q4 in `/speckit-clarify` session 2026-05-07) that extension distribution should use "bundled + local install" for v1. This decision is consistent with:

1. **YAGNI (Constitution V)**: A marketplace requires infrastructure (hosting, versioning, signing, discovery) that is beyond current scope. The git integration is the only planned first-party extension for v1.
2. **The existing `extension:install` channel** already supports installing from a local `directoryPath`. No new infrastructure is needed for local installs.
3. **Simplicity**: Bundled extensions load deterministically at startup. No network calls, no registry lookups, no version resolution at install time.

## Alternatives Considered

### Hosted extension marketplace (rejected)

Would require: a package registry (npm-like or custom), extension signing for security, a discovery/search UI, version management, and CDN hosting. All of this is beyond v1 scope and would require significant ongoing infrastructure maintenance.

### Install from URL (rejected)

Downloading extensions from arbitrary URLs introduces supply-chain risk without a code-signing infrastructure. Rejected pending a proper security model for remote extension distribution.

## Consequences

- All first-party extensions must be included in the repository under `extensions/`. This is acceptable given the small number of planned first-party extensions.
- Community extension authors install their extensions by pointing the app at a local build directory — sufficient for developer workflows.
- A marketplace can be introduced in a future version with a new ADR covering the security and infrastructure design.
- The `extension:install` channel's `directoryPath` parameter must point to a directory containing a valid `manifest.json`. The `ExtensionHost` validates the manifest on install.
