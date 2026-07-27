# Phase 1 Data Model: Agent Supervision Console

**Feature**: `021-agent-supervision-console` | **Date**: 2026-07-26

Entities are grouped by owner. **Console-owned** entities are ours to write. **Producer-owned** entities are read-only to us (FR-073). The distinction is the whole point of the boundary — it is enforced here at the model level, not left to discipline in the code.

---

## 1. Session event (the neutral shape) — `events/session-event.ts`

The single type crossing the agent-runtime seam. **No SDK type may appear in this union or anything it references** (FR-003, enforced by lint).

```
SessionEvent =
  | { kind: 'session_started';    sessionId, transcriptPath, cwd, at }
  | { kind: 'tool_started';       sessionId, toolName, targetPath?, isShell, callId, at }
  | { kind: 'tool_finished';      sessionId, callId, ok, at }
  | { kind: 'permission_requested'; sessionId, requestId, toolName, summary, targetHost?, at }
  | { kind: 'permission_resolved';  sessionId, requestId, decision: 'allow' | 'deny', at }
  | { kind: 'turn_finished';      sessionId, turns, costUsd, contextPct, at }
  | { kind: 'session_ended';      sessionId, outcome: 'success' | 'error', reason?, at }
  | { kind: 'setup_finished';     sessionId, exitCode, output, at }
```

**Why `isShell` and `callId` exist**: FR-015's long-running-command exemption needs to know a shell call is open and when it closes. Without the pair, a 12-minute test run reads as a stall — the spec's named "obvious first bug".

**Validation**: `at` is an injected epoch-ms number, never `Date.now()` read inside a consumer. Every consumer of `SessionEvent` is a pure function of `(events, now)`.

---

## 2. Session — console-owned

| Field                | Type                        | Notes                                   |
| -------------------- | --------------------------- | --------------------------------------- |
| `id`                 | string                      | Stable agent-runtime session id         |
| `workItemId`         | string \| null              | null for ad-hoc work (FR-081)           |
| `laneOrd`            | number \| null              | null for ad-hoc                         |
| `repoPath`           | string                      | Primary checkout                        |
| `worktreePath`       | string                      |                                         |
| `branch`             | string                      |                                         |
| `transcriptPath`     | string                      | From hook input (R3) — never computed   |
| `runtimeState`       | RuntimeState                | §3                                      |
| `stateSince`         | epoch ms                    | FR-001                                  |
| `lastToolActivityAt` | epoch ms \| null            | FR-008                                  |
| `lastNetChangeAt`    | epoch ms \| null            | FR-008, net of reverts                  |
| `openShellCallId`    | string \| null              | Drives the FR-015 exemption             |
| `turns`              | number                      |                                         |
| `costUsd`            | number                      |                                         |
| `contextPct`         | number \| null              |                                         |
| `pendingPermission`  | PendingPermission \| null   | §4                                      |
| `diffSummary`        | `{ files, added, removed }` |                                         |
| `autonomyLevel`      | AutonomyLevel               | §7, chosen at assign time (FR-041)      |
| `lastViewedAt`       | epoch ms \| null            | Drives "since you last looked" (FR-027) |

**Invariants**

- Exactly one `runtimeState` at all times (FR-001).
- `runtimeState` is never `working` without a supporting event; on restart with no evidence it becomes `unknown` (FR-009).
- Reconciliation: when the driver and the transcript disagree, the transcript wins (FR-006).

---

## 3. RuntimeState

`starting | working | needs_input | stalled | ready | failed | merged | unknown`

`unknown` is not in the spec's enumeration but is required by FR-009, which forbids reporting `working` without evidence. It is a console-internal honesty state, rendered as "state unknown — reconciling".

### Transitions

| From                | Event                                   | To            | FR             |
| ------------------- | --------------------------------------- | ------------- | -------------- |
| —                   | provisioning begins                     | `starting`    | FR-030         |
| `starting`          | `setup_finished` exit ≠ 0               | `failed`      | FR-034         |
| `starting`          | `setup_finished` exit 0 → agent starts  | `working`     |                |
| `working`           | `permission_requested`                  | `needs_input` | FR-007         |
| `needs_input`       | `permission_resolved`                   | `working`     |                |
| `working`           | stall fires **and** shadow mode off     | `stalled`     | FR-018, FR-019 |
| `stalled`           | any `tool_started`                      | `working`     |                |
| `working`/`stalled` | `session_ended` success, diff non-empty | `ready`       | FR-045         |
| `working`/`stalled` | `session_ended` success, diff empty     | `merged`¹     | FR-045         |
| any                 | `session_ended` error                   | `failed`      | FR-001         |
| `ready`             | merge completes                         | `merged`      |                |
| any                 | restart, no evidence                    | `unknown`     | FR-009         |

¹ An empty-diff session is terminal and must not enter the review queue (FR-045). It is not literally "merged"; it is closed with nothing to merge, and renders as "finished, no changes".

**Critical**: a stall firing changes state _only_ when shadow mode is off. In shadow mode the firing is recorded and the session stays `working` (FR-018). One code path, one boolean, checked at the surfacing step.

---

## 4. PendingPermission — console-owned

`requestId · toolName · summary · targetHost? · requestedAt · autoDecision?`

`autoDecision` records that the autonomy ladder resolved it without asking, so the audit trail shows what was auto-approved. `targetHost` present and not on the repository allowlist forces a prompt regardless of level (FR-042).

---

## 5. StallFiring — console-owned, append-only JSONL

`id · sessionId · firedAt · signal: 'silence' | 'loop' | 'revert' · inputs · shadowMode: boolean · judgement: 'correct' | 'incorrect' | null · judgedAt?`

`inputs` captures the values that satisfied the condition (elapsed silence, files touched, revert count) so a firing can be re-examined without the transcript. Written on **every** firing in both modes (FR-017); `judgement` powers the precision report (FR-020) and therefore SC-002.

---

## 6. StallThresholds — from repo config, defaults in code

`silenceMs` (default 480 000) · `noProgressMs` (default 900 000) · `loopWindow` (8 calls) · `revertWindow` (10 edits) · `revertThreshold` (2)

---

## 7. AutonomyLevel

Ordered, each strictly wider than the last (FR-041):

| Level   | Auto-approved                          | Always prompts                      |
| ------- | -------------------------------------- | ----------------------------------- |
| `read`  | read, search, list                     | everything else                     |
| `edit`  | + write/edit **inside the worktree**   | shell, network                      |
| `build` | + dependency install, local build/test | push, anything outside the worktree |
| `ship`  | + push, open pull request              | destructive ops, prod hosts         |

Off-allowlist network host prompts at every level (FR-042). Destructive operations prompt at every level.

---

## 8. WorkingCopy — console-owned

`sessionId · path · branch · portBase · portSpan · sharedDirs[] · copiedFiles[] · setupExitCode · setupOutput`

**Invariants**: port ranges never overlap across live working copies (SC-008); archiving requires the session not be running (FR-036).

---

## 9. RepositoryConfig — read from `.terminator/config.json`

`sharedDirs[] · copiedFiles[] · portBase · portSpan · setupCmd? · teardownCmd? · verifyCmd? · stallThresholds? · criticalPaths[] · allowedHosts[] · unattendedMergeLowestGrade: boolean (default false)`

**Invariants**: `criticalPaths` defaults to empty and is never inferred (FR-055). `unattendedMergeLowestGrade` is per-repository with no global switch (FR-059).

---

## 10. ReviewItem — console-owned

`sessionId · grade: 'P0' | 'P1' | 'P2' | 'P3' · gradeTrigger · checkState: 'passing' | 'failing' | 'pending' | 'unavailable' · hunks[] · reviewStep · queuedAt · decidedAt?`

**Grading order** — first match wins, evaluated top-down (FR-046 – FR-049):

| Grade | Trigger                                                                                |
| ----- | -------------------------------------------------------------------------------------- |
| P0    | auth, payments, secrets, migrations, public interface, or a repo `criticalPaths` match |
| P1    | schema change, declared shared-contract file, or > 300 changed lines                   |
| P3    | formatting / lockfile / dep-bump only **and** `checkState === 'passing'`               |
| P2    | everything else                                                                        |

P3 is deliberately below P1 in evaluation order: a lockfile change that also touches a critical path is P0, not P3. `checkState` of anything other than `passing` disqualifies P3, so an unreachable code host can never produce a P3 (FR-057, FR-062).

**Review flow** (FR-051): `intent → risk → structure → tests`. Intent compares the original request against the agent's own account and calls out work outside the request.

---

## 11. Console-owned records

- **BackpressureOverride**: `at · queueDepth · sessionId` (FR-054)
- **UnattendedMergeRecord**: `sessionId · mergedAt · diffSummary · gradeTrigger · checkState` (FR-060), surfaced by the after-the-fact view (FR-061)
- **LaneBinding**: `workItemId · laneOrd · sessionId · boundAt` — **console-owned storage, never written into producer state** (FR-075). Single-valued per `(workItemId, laneOrd)`.
- **FeedEntry**: `id · at · sessionId? · author: 'agent' | 'console' · summary · replyable` (FR-091, FR-092)

---

## 12. WorkItem — **producer-owned, read-only** (FR-073)

Read from the console's publication directory (FR-071). Full schema in [contracts/work-item.contract.md](./contracts/work-item.contract.md).

`contractVersion · id · source · sourceUrl · title · createdAt · phase · artifacts{spec,plan,tasks} · gates{} · contract{summary, sharedFiles[]} · lanes[]`

**Invariants**

- The console never writes, amends, or deletes this file (FR-073).
- The bound session is **not** here — it lives in LaneBinding (FR-075).
- Duplicate `id` across two producers is a reported conflict, never a silent pick (FR-074).
- Malformed or partially written → that one item is `unreadable`, every other surface unaffected (FR-085).
- Unknown major `contractVersion` → `unreadable` with reason, never a partial parse.

---

## 13. Lane — producer-owned

`ord · repo · role: 'producer' | 'consumer' · branch · taskIds[] · blocks[] · blockedBy[]`

**Invariants**: merge refused while any `blockedBy` lane is unmerged and a shared file is involved (FR-088). A file in more than one lane's shared set is flagged on every lane that touches it (FR-087). One lane renders as one row with no extra ceremony (FR-089).

---

## Ownership summary

| Console writes                                                                                                                                          | Console reads only               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Session, PendingPermission, StallFiring, WorkingCopy, ReviewItem, LaneBinding, BackpressureOverride, UnattendedMergeRecord, FeedEntry, shadow-mode flag | WorkItem, Lane, RepositoryConfig |

Anything in the right-hand column that the console appears to need to modify is a design error, not a case for an exception.
