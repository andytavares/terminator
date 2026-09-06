# IPC Channels: Foundry Extension

**Feature**: `037-foundry-software-factory` | **Date**: 2026-09-06

All channels use the `foundry:` namespace, registered by the extension's main-process handler via `api.ipc.registerHandler`. Payloads are validated with zod before processing. Nothing in `src/` names any of these channels (Constitution II).

Ten channels replace roughly forty in the extension being retired. Every one is renderer → main (invoke) unless stated.

Entity shapes referenced below are defined in [data-model.md](../data-model.md) and are not repeated here.

---

## `foundry:order.create`

Seed a new work order and return the first complete draft. Scout runs before this resolves — the operator never sees an empty shell (FR-002, FR-003).

**Payload**:

```typescript
{
  source: {
    kind: 'typed' | 'tracker' | 'failing_run' | 'review_comment' | 'deferred'
    text?: string                       // kind = typed
    tracker?: 'linear' | 'jira'         // kind = tracker
    key?: string                        // kind = tracker
    ref?: string                        // kind = failing_run | review_comment | deferred
  }
  workspaceId: string
  repoPaths: string[]                   // ≥1; more than one starts a multi-lane order
}
```

**Response**:

```typescript
{ order: WorkOrder; compile: CompileResult }
| { existing: { id: string; title: string } }   // FR-013: same issue already seeded
| { error: string }
```

---

## `foundry:order.turn`

One turn of intake. Exactly one of `message`, `strike` or `answer` is present. Returns the redrawn order and re-evaluated checks; a strike redraws only what depended on the assumption (FR-007).

**Payload**:

```typescript
{
  id: string
  message?: string          // free text
  strike?: string           // assumption id
  answer?: { questionId: string; option: number | string }
}
```

**Response**: `{ order: WorkOrder; compile: CompileResult; changed: string[] } | { error: string }`

`changed` lists the ids of fields the turn redrew, so the surface can mark them without diffing the whole order.

---

## `foundry:order.compile`

Run the six checks and, when they all pass, move the order to `agreed`. Idempotent; safe to call to preview.

**Payload**: `{ id: string; commit: boolean }`

**Response**: `{ compile: CompileResult; order: WorkOrder }`

When `commit` is true and `compile.ok` is false the order is unchanged and `failures` names the specific offending criterion or unit (FR-011).

---

## `foundry:run.start`

Compile an agreed order into a run graph and begin. Provisions one worktree per unit and one branch per lane.

**Payload**: `{ id: string; recipe?: string }`

`recipe` overrides the proposal and is recorded as an operator decision (FR-015).

**Response**: `{ graph: RunGraph } | { error: string }`

Errors, all before any work starts: order not `agreed`; recipe unmet requirements (FR-020); records location unwritable (FR-075); dirty working tree (Edge Cases).

---

## `foundry:run.observe`

**Direction**: main → renderer (stream, via `api.window.broadcast`)

Graph and feed events for one order. Subscribed by id; unsubscribed when the surface unmounts.

```typescript
| { type: 'node'; node: RunNode }
| { type: 'verdict'; verdict: Verdict }
| { type: 'feed'; at: string; nodeId: string | null; text: string; tone: 'info' | 'good' | 'warn' | 'bad' }
| { type: 'gate'; gate: Gate }
| { type: 'done'; outcome: 'shipped' | 'failed' | 'cancelled' }
```

---

## `foundry:session.attach`

Return the terminal session behind any running agent so the surface can focus it. The backstop of FR-027 and the guarantee behind SC-009.

**Payload**: `{ orderId: string; nodeId: string }`

**Response**: `{ terminalSessionId: string } | { error: string }`

Resolves for the Forge conversation as well as for any unit — both run in supervised sessions.

---

## `foundry:inbox.list`

Every outstanding gate across every order, ranked (FR-048).

**Payload**: `{}`

**Response**: `{ gates: Gate[]; summary: { building: number; converging: number; autoDecisions24h: number } }`

Ordered by `rank` descending. The summary is what the surface shows when `gates` is empty — "nothing needs you" is a state worth rendering well.

---

## `foundry:inbox.decide`

**Payload**: `{ gateId: string; option: string; note?: string }`

**Response**: `{ ok: true } | { error: string }`

Writes a ledger entry before acting. A gate already decided returns an error rather than deciding twice.

---

## `foundry:ledger.query`

**Payload**:

```typescript
{
  orderId?: string
  actor?: 'operator' | string          // 'rule:<id>' | 'role:<id>'
  action?: string
  since?: string                       // ISO 8601
  limit?: number                       // default 200
}
```

**Response**: `{ entries: LedgerEntry[]; more: boolean }`

---

## `foundry:rules.propose`

Run the curator over the ledger and return proposals. On request only — never scheduled, never unprompted (FR-080).

**Payload**: `{ since?: string }`

**Response**:

```typescript
{
  proposals: Array<{
    id: string
    ruleId: string
    rung: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6'
    asserts: string
    derivedFrom: string[] // ledger entry ids — FR-079 requires citation
    wouldHaveCaught: number
  }>
}
```

Accepting or rejecting a proposal is `foundry:inbox.decide` against the gate the proposal raises, so there is one decision path and one ledger shape for every decision in the system.

---

## Settings

Registered via `api.settings.register`; not channels, but part of the surface.

| Key                                           | Type                                     | Default                                           |
| --------------------------------------------- | ---------------------------------------- | ------------------------------------------------- |
| `terminator.foundry.dataDir`                  | string                                   | `""` — empty means `<workdir>/.foundry/` (FR-074) |
| `terminator.foundry.autoOpenDraftPr`          | boolean                                  | `true` (FR-053)                                   |
| `terminator.foundry.autonomy`                 | `escorted` \| `standard` \| `lights-out` | `standard`                                        |
| `terminator.foundry.budgets.agents`           | number                                   | `3`                                               |
| `terminator.foundry.budgets.wallClockMinutes` | number                                   | `45`                                              |
| `terminator.foundry.budgets.filesTouched`     | number                                   | `25`                                              |
| `terminator.foundry.writeBack`                | string[]                                 | all three (FR-062)                                |
| `terminator.foundry.criticalPaths`            | Record&lt;repo, string[]&gt;             | `{}` — operator-declared, never inferred          |
