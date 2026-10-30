# ADR-025: Core and git-integration Keep Separate Git Parsers

**Status**: Accepted
**Date**: 2026-07-08
**Relates to**: Constitution Principle II (Extension Isolation), ADR-022

## Context

Two files implement near-identical porcelain-v1 `-z` and diff-hunk
parsing:

- `src/main/git/git-parser.ts` (core: worktree/branch operations used by
  `git.ipc.ts` and `workspace.ipc.ts`)
- `extensions/git-integration/src/git/git-parser.ts` (the extension's
  status/diff surface)

Both copies are fully tested. Architecture reviews keep flagging the
duplication.

## Decision

Keep both copies. Extension Isolation forbids extensions from importing core
source. To eliminate the duplication, the team would have to publish a parser-only
module through the Extension API. That is a new, versioned public surface to
maintain for two consumers of a parser that is stable (git porcelain-v1
output does not change). The duplication costs less to maintain (a git
edge-case fix applied twice, guarded by two test suites) than a published API surface.

## Consequences

- A porcelain-parsing fix must be applied to both files. Each side's tests
  (`tests/unit/git/git-parser.spec.ts`,
  `extensions/git-integration/tests/**`) catch drift in the behavior they cover.
- Revisit if the parser starts changing more than rarely, or if a third
  consumer appears. Either would justify promoting the parser into the
  published Extension API (`api.git.parse*`).
- Future architecture reviews must not re-flag this duplication.
