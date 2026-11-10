# ADR 158: A facet says where it opens

**Status**: Accepted

**Date**: 2026-11-10

**Relates to**: [ADR 117](117-extensions-send-home-data-core-draws-it.md), [ADR 148](148-the-inbox-sidebar-reuses-home-threads.md)

## Context

An Inbox card opens the thread's most recent terminal. A Foundry order's thread has a terminal, so the card opened it, and nothing on the card reached the order in Foundry. The operator had to switch the sidebar back to the tree. A Home ask already says where it opens (`open: { command, args }`); a facet, which describes the work itself, did not.

## Decision

- `ThreadFacet` takes an optional `open: { command, args? }`, the same shape as an ask's. Foundry sets it to `show-order` with the order's id.
- Core keeps the first facet target on the thread, with the extension that sent it, and offers **Open in ‹extension›** on the Inbox card, the Home row menu, the task drawer and the tree branch menu. Running it reuses the command path that opens an ask.
- A card click still opens the terminal, the common case. A card with no terminal opens the facet's target before it falls back to the Home drawer.

## Consequences

- Any extension can make its work reachable from either sidebar mode by setting `open` on its facet. It is an additive SDK change.
- The card icon is the extension's own declared icon.
