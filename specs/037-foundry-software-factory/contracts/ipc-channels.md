# IPC Channels: Foundry Extension

**Feature**: `037-foundry-software-factory` | **Date**: 2026-09-06

All channels use the `foundry:` namespace, registered by the extension's main-process handler via `api.ipc.registerHandler`. Payloads are validated with zod before processing. Nothing in `src/` names any of these channels (Constitution II).

**Forty-three channels**, of which the thirteen below carry the Forge, the Line and the record and are documented in full; the remaining thirty drive the supervision surface and are listed, with their payloads and responses, in [Supervision and settings channels](#supervision-and-settings-channels) at the end. Every one is renderer → main (invoke) unless stated.

The count is worth stating plainly: an earlier draft of this contract said ten, which was the design's ambition rather than what shipped. Supervising a live agent — its permissions, its transcript, its review queue, its stalls — is where the other thirty went.

Entity shapes referenced below are defined in [data-model.md](../data-model.md) and are not repeated here.

---

## `foundry:issues.mine`

Your tickets, so one can be picked rather than remembered. `order.create` has
always accepted a tracker key and there was no way in the interface to give it
one — importing work is the front door of a tool that does work, and it did not
have one. The host has listed and searched issues the whole time; nothing here
asked.

**Payload**:

```typescript
{ term?: string }   // empty lists your own; otherwise a full-text search
```

**Reply**:

```typescript
{
  connected: { tracker: string; account: string }[]  // empty when none is connected
  issues: { tracker: string; key: string; title: string; status: string }[]
  failures?: string[]                                // per-tracker, reported not thrown
}
| { error: string }
```

No tracker connected is a real answer and not an error: the surface says so
rather than showing an empty list, which reads as "you have no tickets".

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

## `foundry:run.recipes`

The shapes of work this repository can support for one order, which one the system proposes, and **why** it proposes it (FR-014).

`available: false` carries the requirement the repository does not meet, so a shape that cannot run says so rather than disappearing.

**Payload**: `{ id: string }`

**Response**:

```typescript
{
  recipes: Array<{
    name: string
    available: boolean
    unmet: string[]
    rung: 'data-root' | 'repository' | 'built-in' | null
    description?: string
  }>
  proposed: string
  // The grounds, not just the answer: a shape decides how many agents run,
  // what is verified, and whether a pull request opens at the end.
  proposedWhy: string
}
```

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

**Payload**: `{ orderId?: string }` — omitted reads every order.

**Response**:

```typescript
{
  proposals: Array<{
    id: string
    rung: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6'
    asserts: string
    origin: string
    occurrences: number
    // FR-079 requires citation: the specific past rejections it derives from.
    citations: Array<{
      ref: string
      at: string
      actor: string
      action: string
      subject: string
      reason: string
    }>
  }>
}
```

---

## `foundry:rules.decide`

Accept or turn down one proposal (FR-081). Accepting writes a rule into the records location, where it applies to subsequent work in every repository. Turning one down is permanent: it is never offered again.

The proposal is re-derived from the ledger inside the handler rather than trusted from the surface — a rule accepted on evidence the ledger no longer supports is one nobody can justify.

**Payload**: `{ proposalId: string; accept: boolean; reason?: string }`

**Response**: `{ ok: true; accepted: boolean; file?: string; rule?: string }`, or `{ error }` when the ledger no longer supports the proposal.

---

## `foundry:rules.inForce`

The checks the operator accepted, and the ones they turned down — the readable-back half of FR-081.

Only rules that resolved from the **records location** rung are listed. A built-in is not the operator's to remove, and a rule carried by a repository belongs to that repository.

**Payload**: `{}`

**Response**: `{ rules: Array<{ id: string; asserts: string; rung: string; origin: string }>; declined: Array<{ id: string; reason: string }> }`

---

## `foundry:rules.remove`

Take an accepted check back out (FR-081). The rule file is deleted **and** the id is recorded as declined, so the curator does not propose it again next week — a factory that argues with the operator is worse than one that never learned.

Refused for any id not in `foundry:rules.inForce`.

**Payload**: `{ ruleId: string; reason?: string }`

**Response**: `{ ok: true; removed: boolean; reason: string; at: string }`, or `{ error }`.

---

## Settings

Registered via `api.settings.register`; not channels, but part of the surface. **Every key here is read by the extension** — a setting nothing reads is a control the operator can move while the factory ignores it, and `channel-registry.spec.ts` now fails on one.

| Key                                           | Type                                         | Default                                                                               |
| --------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `terminator.foundry.dataDir`                  | string                                       | `""` — empty means `<workdir>/.foundry/` (FR-074)                                     |
| `terminator.foundry.autoOpenDraftPr`          | boolean                                      | `true` (FR-053)                                                                       |
| `terminator.foundry.autonomy`                 | `escorted` \| `standard` \| `lights-out`     | `standard`                                                                            |
| `terminator.foundry.budgets.agents`           | number                                       | `3` — seeded onto every new order (FR-030)                                            |
| `terminator.foundry.budgets.wallClockMinutes` | number                                       | `45` — seeded onto every new order                                                    |
| `terminator.foundry.budgets.filesTouched`     | number                                       | `25` — seeded onto every new order                                                    |
| `terminator.foundry.writeBack.summaryComment` | boolean                                      | `true` (FR-062)                                                                       |
| `terminator.foundry.writeBack.status`         | boolean                                      | `true` (FR-062)                                                                       |
| `terminator.foundry.writeBack.prLink`         | boolean                                      | `true` (FR-062)                                                                       |
| `terminator.foundry.criticalPaths`            | string — one glob per line, workspace-scoped | `""` — operator-declared, never inferred (FR-043); seeded onto every new order's risk |
| `terminator.foundry.stallShadowMode`          | boolean                                      | `true` — record stalls without surfacing them                                         |
| `terminator.foundry.untrackedNoticeSeen`      | boolean                                      | `false` — written by the extension, not shown                                         |

The budgets and the critical-path list are read **when an order is seeded**, not when it runs: the order carries its own agreed budgets, and changing a setting afterwards must not silently re-price work the operator already agreed to.

---

## Supervision and settings channels

Thirty channels serve the Floor: the live runs, their permissions, their transcripts, the review queue and the model box. They take the same `foundry:` namespace and the same invoke shape. Grouped by what they are for.

### The run graph and the session

| Channel                        | Payload                                   | Response                                                                                                        |
| ------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `foundry:run.resume`           | `{ id: string }`                          | Restarts a run's scheduler after a gate was decided. Main-process seam: raised from the inbox, not from a view. |
| `foundry:run-interrupt`        | `{ sessionId: string }`                   | `{ ok: boolean }`                                                                                               |
| `foundry:run-redirect`         | `{ sessionId: string; message?: string }` | `{ ok: boolean }` — interrupts, then sends. Refuses an empty message rather than throwing.                      |
| `foundry:run-stop`             | `{ sessionId: string; reason?: string }`  | `{ ok: boolean }` — archives the run before it leaves the live list                                             |
| `foundry:run-terminal`         | `{ sessionId: string }`                   | `{ ok: boolean }` — focuses the window and navigates to the agent's terminal (FR-027)                           |
| `foundry:run-transcript`       | `{ sessionId: string; limit?: number }`   | `{ lines: string[] }` — the tail, default 40                                                                    |
| `foundry:supervision-snapshot` | `{}`                                      | `{ runs, review, backpressure: { allowed, unreviewed, limit } }`                                                |
| `foundry:stalls-list`          | `{}`                                      | `{ firings, shadowMode: boolean }`                                                                              |

### Review

| Channel                      | Payload                                                                 | Response                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `foundry:review-hunks`       | `{ sessionId: string }`                                                 | `{ files, complete, fullReject }`; `files: null` means the runtime never started, which is not the same as a change that touched nothing |
| `foundry:review-decide-hunk` | `{ sessionId: string; hunkId: string; decision: 'accept' \| 'reject' }` | `{ ok: boolean }`                                                                                                                        |
| `foundry:review-apply`       | `{ sessionId: string }`                                                 | `{ ok, reverted, error? }` — reverts the rejected hunks                                                                                  |
| `foundry:review-advance`     | `{ sessionId: string }`                                                 | `{ step }`                                                                                                                               |
| `foundry:review-done`        | `{ sessionId: string }`                                                 | `{ ok: true }` — reopens the backpressure gate                                                                                           |
| `foundry:review-intent`      | `{ sessionId: string; request: string; agentAccount: string }`          | `{ intent }` — what the change does against what was asked for                                                                           |

### Permissions

| Channel                        | Payload                                                               | Response                                                                        |
| ------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `foundry:permissions-list`     | `{}`                                                                  | `{ pending }`                                                                   |
| `foundry:permission-resolve`   | `{ requestId: string; decision: 'allow' \| 'deny'; answer?: string }` | `{ ok, reason? }` — refuses with a reason when the request is no longer waiting |
| `foundry:permission-hand-back` | `{ requestId: string }`                                               | `{ ok: boolean }` — returns the decision to the terminal                        |

### The activity feed

| Channel                | Payload                                                 | Response                                                 |
| ---------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| `foundry:feed-list`    | `{}`                                                    | `{ entries, mutes }`                                     |
| `foundry:feed-dismiss` | `{ id: string }`                                        | `{ ok: true }`                                           |
| `foundry:feed-mute`    | `{ sessionId?: string; author?: 'agent' \| 'console' }` | `{ mutes }`                                              |
| `foundry:feed-unmute`  | `{ sessionId?: string; author?: 'agent' \| 'console' }` | `{ mutes }`                                              |
| `foundry:feed-digest`  | `{ from: number; to?: number }`                         | The roll-up of what happened while the operator was away |

### The order, beyond compiling it

| Channel                   | Payload                            | Response                                                           |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `foundry:order.list`      | `{}`                               | Every order, for the board                                         |
| `foundry:order.converge`  | `{ id: string }`                   | Runs the architect read-only and reads back its proposal (ADR-043) |
| `foundry:order.states`    | `{ id: string }`                   | The tracker's workflow positions, for the intent mapping (FR-060)  |
| `foundry:order.mapState`  | `{ id: string; intent; optionId }` | `{ ok, mapping }`                                                  |
| `foundry:order.writeBack` | `{ id: string; events: string[] }` | Which write-backs this order will make (FR-062)                    |

### The model

| Channel               | Payload             | Response                          |
| --------------------- | ------------------- | --------------------------------- |
| `foundry:models-list` | `{}`                | `{ models, selected }`            |
| `foundry:model-set`   | `{ model: string }` | `{ ok, selected }` or `{ error }` |
