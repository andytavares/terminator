# ADR 083: Extension commands take validated arguments

**Status**: Accepted

**Date**: 2026-10-05

## Context

A command handler received only `CommandContext` (project, session, repo root),
so one extension could not ask another to do something specific. Foundry wants
to open a pull request in git-integration's review window. Importing
git-integration, or calling its IPC channel, would break extension isolation
(constitution principle II).

## Decision

- A command contribution may declare `args`, a Zod schema. The handler becomes
  `(ctx, args?)`. A command without a schema never receives args.
- `executeExtensionCommand(key, ctx, args?)` validates against the schema
  before the handler runs and returns `{ ok: true } | { ok: false, reason }`.
  `reason` is `not-registered`, `disabled`, `invalid-args: …` or `failed: …`.
- Extension views get `electronAPI.extension.runCommand(key, args)` and
  `hasCommand(key)`, backed by the channels `extension:run-command` and
  `extension:has-command`. They are not on the remote allowlist.
- A command that declares `args` is left out of the quick-actions list, since
  nothing there can supply them.
- Extension API version 2.7.0.
- First use: git-integration registers `review-pull-request` with
  `{ repoRoot: string, number: number }`, opening the same `pr-review` window
  as `window:open-pr-review`. Foundry calls
  `terminator.git-integration.command.review-pull-request`.
- Fallback: when `runCommand` answers `not-registered` (git-integration missing
  or disabled), the caller falls back to its own behaviour, such as opening
  the pull request on GitHub.

## Consequences

- Extensions talk through registered commands only, keeping both directions of
  principle II intact.
- The schema is the contract: a caller learns of a mismatch from the `reason`,
  not from a handler that silently ignores bad input.
