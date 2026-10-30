# ADR 061: One project per order, and an extension may file an issue

**Status**: Accepted

**Date**: 2026-09-26

**Supersedes**: the "no way to create an issue" clause of ADR 041 and of the
provider contract (`src/main/integrations/providers/provider.ts`, rule 6)

## Context

A Foundry order scattered itself across the sidebar. The architect ran on the
repository root under a project named `foundry/intake-wo-…`. Each lane got a
second project on its worktree. Neither project carried the order's Linear
ticket. When the checkout was torn down, the project pointed at a directory
that no longer existed. The operator asked for one project per order, named
after the ticket's recommended branch and linked to that ticket. The operator
also asked that a typed idea offer a ticket before any work starts (spec 061).

The second request needs a tracker write that the application refused on
purpose. ADR 041 widened the boundary to `comment` and `transition`. It also
restated that nothing may create an issue.

## Decision

**One checkout, one project.** The order's lane checkout is made before the
architect's first turn. Every session of the order runs in it: architect, lane
agents and check commands. The project takes the name of the branch that
`branchFor` gives lane 1. That name is the tracker's own `branchName` when the
order has a ticket, and `foundry/wo-…` otherwise. `createProject` receives the
ticket, so the existing project↔issue link is set. Teardown deletes the project
together with the checkout.

**`issues.create`, Linear only, on the operator's word.** The provider gains
`teams` and `create`. The service and `ExtensionAPI.issues` (v2.5.0) expose
`teams`, `create` and `supportsCreate`. `create` is a write operation in the
contract test. This is the conspicuous edit that ADR 041 asked a widening to be.
Deletion and field edits remain forbidden. Foundry calls `create` only from the
prompt that the operator answers when seeding a typed idea.

## Alternatives

- **Keep intake on the repository root and only rename projects.** Two
  projects would still exist per order. The architect would read the operator's
  uncommitted working tree, not the base that the lanes build on.
- **Open a Linear URL for the operator to file the issue by hand.** This needs
  no create API. But the order could not pick up the new key without a second
  step. The operator would also type back in the branch name, which is the
  reason for the ticket.
- **A setting for the default team.** Rejected for now. One team is used
  silently. More than one team is a picker in the same prompt.

## Consequences

- The architect now reads the base branch in a fresh worktree, not the
  operator's checkout. This is the same tree that the builder will change.
- Orders seeded before this change keep the projects they already made.
