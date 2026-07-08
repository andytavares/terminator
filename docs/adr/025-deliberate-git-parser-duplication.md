# ADR-025: Core and git-integration Keep Separate Git Parsers

**Status**: Accepted
**Date**: 2026-07-08
**Relates to**: Constitution Principle II (Extension Isolation), ADR-022

## Context

`src/main/git/git-parser.ts` (core: worktree/branch operations used by
`git.ipc.ts` and `workspace.ipc.ts`) and
`extensions/git-integration/src/git/git-parser.ts` (the extension's
status/diff surface) implement near-identical porcelain-v1 `-z` and diff-hunk
parsing. Both copies are fully tested. Architecture reviews keep flagging the
duplication.

## Decision

Keep both copies. Extension Isolation forbids extensions importing core
source; eliminating the duplication would require publishing a parser-only
module through the Extension API — a new, versioned public surface to
maintain for two consumers of a parser that is stable (git porcelain-v1
output does not change). The maintenance cost of the duplication (a git
edge-case fix applied twice, guarded by two test suites) is lower than the
cost of a published API surface.

## Consequences

- A porcelain-parsing fix must be applied to both files; each side's tests
  (`tests/unit/git/git-parser.spec.ts`,
  `extensions/git-integration/tests/**`) catch drift in behavior they cover.
- Revisit if the parser starts changing more than rarely, or if a third
  consumer appears — either would justify promoting the parser into the
  published Extension API (`api.git.parse*`).
- Future architecture reviews should not re-flag this duplication.
