# ADR-092: The Inbox Is a Band on the Forge

**Status**: Accepted
**Date**: 2026-10-08

## Decision

Foundry has two surfaces, the Forge and the Ledger. The Inbox stops being a tab. Its queue (gates, orders waiting on you, sensor signals) renders as a band across the top of the Forge, above the list, the factory site, a hall or an open order. When the queue is empty the band is not rendered at all. The Forge is home.

```
before                               after
┌ Inbox · Forge · Ledger ┐           ┌ Forge (5) · Ledger ─────────┐
│ (home)                 │           │ Waiting on you   ← only when │
│   Nothing needs you.   │           │   gate · order · signal      │
│                        │           ├──────────────────────────────┤
│                        │           │ Forge: list / factory / order│
└────────────────────────┘           └──────────────────────────────┘
```

The Forge tab's badge is the sum of `foundry:attention`'s `inbox` and `forge` counts.

## Context

The Inbox was home because it was "the one surface the operator is required to visit". Between runs it held nothing, so opening Foundry landed on a page that said "Nothing needs you" and offered nothing to do. The work (start an order, watch one) was a click away on the Forge. The Inbox's own rows already sent you to the Forge: a waiting order's **Open** button switched tabs.

## Consequences

- The empty state goes, along with what it carried: the "since you last looked" digest, the counts of what is building and converging, and the list of rules the autonomy setting silences. `foundry:feed-digest` and the `silenced` field of `foundry:inbox.list` no longer have a caller in this UI.
- A hall halted on a gate no longer has an **Open Inbox** button. The gate is in the band above it.
- The band caps at 45% of the view height and scrolls inside itself, so a long queue cannot push the Forge off the screen.

## Alternatives considered

| Alternative                                | Why rejected                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Keep the tab, make the Forge home          | Clicking the tab between runs still lands on an empty page.                                    |
| Hide the Inbox tab while it is empty       | Tabs that appear and disappear move the others under the cursor.                               |
| Switch to the Inbox when something arrives | Pulls the operator off whatever they were doing in the Forge.                                  |
| Put the queue in a side rail on the Forge  | An input buried in a rail was the original "took for ever to find" defect: a band goes on top. |
