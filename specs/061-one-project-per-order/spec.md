# 061 — One project per order

**Status:** ratified 2026-09-26 · **Date:** 2026-09-26

## Problem

Foundry scatters one order across several sidebar projects. The architect runs
on the repository root under a project named `foundry/intake-wo-…`; each lane
then gets its own project on its worktree. None carries the order's Linear
ticket, and none is removed when the order's checkout is torn down.

## Requirements

- **FR-1** An order owns exactly one project per repository it touches. The
  architect, every lane agent and every check command run in that project's
  worktree. No `foundry/intake-*` project is created.
- **FR-2** The project and its branch are named with the ticket's
  tracker-recommended branch name (Linear `branchName`) when the order has a
  ticket; otherwise `foundry/wo-mmdd-xxx`, as today.
- **FR-3** When the order has a ticket, it is linked to the project (the
  existing project↔issue link the sidebar badge reads).
- **FR-4** Seeding an order from a typed idea while Linear is connected asks
  first: create a Linear ticket for this? **Create** makes the issue (title =
  the idea's first sentence, description = the idea) in the operator's Linear
  team — picked in the prompt only when they belong to more than one — and
  seeds the order from it, so FR-2/FR-3 apply. **No ticket** seeds a typed order as today. Linear not
  connected: no question.
- **FR-5** Tearing an order's checkout down also removes the project that
  pointed at it.
- **FR-6** Core gains one tracker write: `issues.create` (Linear only),
  exposed to extensions as ExtensionAPI v2.5.0. ADR-061 supersedes the
  "no create" clause of ADR-041 and the provider contract.

## Acceptance

- **AC-1** A ticket-seeded order that runs intake then a lane leaves one
  project, named the ticket's branch name, with the ticket linked.
- **AC-2** A typed order where the operator chose "No ticket" leaves one
  project named `foundry/wo-…`.
- **AC-3** Choosing "Create" creates one Linear issue and opens an order whose
  source is that issue.
- **AC-4** Teardown removes the project.

## Out of scope

Jira issue creation; deleting projects of orders shipped before this change.
