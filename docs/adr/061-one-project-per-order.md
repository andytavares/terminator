# ADR 061: One project per order, and an extension may file an issue

**Status**: Accepted

**Date**: 2026-09-26

**Supersedes**: the "no way to create an issue" clause of ADR 041 and of the
provider contract (`src/main/integrations/providers/provider.ts`, rule 6)

## Context

A Foundry order scattered itself across the sidebar. The architect ran on the
repository root under a project named `foundry/intake-wo-…`, each lane got a
second project on its worktree, neither carried the order's Linear ticket, and
tearing the checkout down left the project pointing at a directory that no
longer existed. The operator asked for one project per order, named after the
ticket's recommended branch and linked to that ticket, and for a typed idea
to offer a ticket before any work starts (spec 061).

The second half needs a tracker write the application refused on purpose:
ADR 041 widened the boundary to `comment` and `transition` and restated that
nothing may create an issue.

## Decision

**One checkout, one project.** An order's lane checkout is made before the
architect's first turn, and every session of the order — architect, lane
agents, check commands — runs in it. The project is named with the branch
`branchFor` gives lane 1: the tracker's own `branchName` when the order has a
ticket, `foundry/wo-…` otherwise. `createProject` receives the ticket, so the
existing project↔issue link is set. Teardown deletes the project along with
the checkout.

**`issues.create`, Linear only, on the operator's word.** The provider gains
`teams` and `create`; the service and `ExtensionAPI.issues` (v2.5.0) expose
`teams`, `create` and `supportsCreate`. `create` is a write operation in the
contract test, which is the conspicuous edit ADR 041 asked a widening to be.
Deletion and field edits remain forbidden. Foundry calls it only from the
prompt the operator answers when seeding a typed idea.

## Alternatives

- **Keep intake on the repository root and only rename projects.** Two
  projects would still exist per order, and the architect would read the
  operator's uncommitted working tree rather than the base the lanes build on.
- **Open a Linear URL for the operator to file the issue by hand.** No
  create API needed, but the order could not pick the new key up without a
  second step, and the branch name — the reason for the ticket — would be
  typed back in by hand.
- **A setting for the default team.** Rejected for now: one team is used
  silently, and more than one is a picker in the same prompt.

## Consequences

- The architect now reads the base branch in a fresh worktree, not the
  operator's checkout — the same tree the builder will change.
- Orders seeded before this change keep whatever projects they already made.
