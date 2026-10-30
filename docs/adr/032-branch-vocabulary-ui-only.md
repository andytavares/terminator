# ADR 032: The branch vocabulary is user-visible only

**Status**: Accepted

**Date**: 2026-08-27

**Feature**: `032-branch-first-sidebar`

## Context

Terminator has three objects: a workspace, a project, and a session. The team named the middle one before worktrees existed, and the name no longer describes what it is. A "project" is a **branch**: one checkout, optionally with its own worktree directory on disk.

The consequence is not cosmetic. Every repository's default branch is called `main`, so every repository's default project is called `main` too. The 2026-08-27 interface audit found the result in four places at once:

- the command palette listed six entries that read `New terminal in main`, one per repo, textually identical;
- the link-issue dialog said `Attaching to main`;
- the move-session dialog offered a list of branches that were all called `main`;
- the sidebar needed a workspace suffix bolted onto project headers to disambiguate them.

So the word has to change. The question is how deep.

## Decision

**The rename is user-visible only.** Every string a user reads says "branch". The stored entity, its TypeScript type, its IPC channel names and its Extension API surface all keep the identifier `Project`.

A lint rule holds the seam. It is scoped to `src/renderer/components/**/*.tsx`, and it fails the build on the word "project" in:

- JSX text,
- a `label:` property value,
- a `placeholder`, `title` or `aria-label` attribute.

The rule leaves identifiers, imports, type names and internal discriminants like `type: 'new-project'` untouched, because users do not see them.

## Consequences

**Good**

- No data migration. `FR-021` requires that an older build can still read the store, and it can, because the stored shape did not change.
- No extension breakage. `FR-020` forbids requiring extension changes, and installed extensions call `api.project.*` and the `project:*` channels unchanged.
- The rule is not advisory. Principle X already makes a lint error a merge blocker, so "someone will forget" becomes a build failure and not a certainty. It earned its place immediately: on first run it caught two strings the manual sweep had missed, in `IssueDrawer` and `LinkIssueDialog`.

**Bad**

- **A permanent translation seam.** A reader of the code sees `Project` where the product says "branch". This is the honest cost. The feature plan's Complexity Tracking records it and does not gloss over it.
- The rule is regex-and-selector based, so it can miss a string assembled at runtime from fragments. It catches the shapes that actually occurred. It is a net, not a proof.
- The rule does not cover new user-facing surfaces outside `src/renderer/components/`. Extending the scope is cheap when a case appears.

## Alternatives considered

**Rename the entity end to end.** Rejected. It touches the workspace store schema, every `project:*` IPC channel, and the published `api.project.*` Extension API that installed extensions call. That is exactly the compatibility break `FR-020` and `FR-021` rule out. The user-visible benefit is zero, because the UI controls its own labels.

The condition for revisiting is concrete: if the Extension API takes a major version bump for other reasons, the rename should ride along, and a new ADR should supersede this one and not edit it.

**Rename the type but keep the wire format.** Rejected as the worst of both: the same translation seam, plus a diff across every file that touches a project, plus no compatibility gain.

**No lint rule; rely on review.** Rejected. Review had already failed at this once. The audit found the word simultaneously in the palette, three dialogs and the README, and all of them passed review when written.
