# Phase 1 Data Model: Foundry

**Feature**: 037-foundry-software-factory | **Date**: 2026-09-06

Every entity below is validated with a zod schema at its boundary (R8). Files are written by agents and by the operator, so nothing is trusted on read.

---

## 1. WorkOrder

The contract between the Forge and the Line. The only object that crosses.

| Field                    | Type                  | Rules                                                                     |
| ------------------------ | --------------------- | ------------------------------------------------------------------------- |
| `id`                     | string                | `WO-<MMDD>-<3 hex>`. Assigned once, never reused.                         |
| `title`                  | string                | Non-empty.                                                                |
| `status`                 | enum                  | `draft` \| `agreed` \| `running` \| `shipped` \| `cancelled`.             |
| `source`                 | Source                | Where the idea came from.                                                 |
| `writeBack`              | WriteBack[]           | Subset of `summary_comment`, `status`, `pr_link`. Defaults from settings. |
| `recipe`                 | string \| null        | Null until selected; must resolve (R2) before `agreed`.                   |
| `recipeOverriddenBy`     | `operator` \| null    | Set when the operator rejects the proposed recipe (FR-015).               |
| `intent`                 | Intent                |                                                                           |
| `context`                | ContextPack           | Written by Scout. Never asked of the operator.                            |
| `acceptance`             | AcceptanceCriterion[] | ≥1.                                                                       |
| `risk`                   | RiskAssessment        |                                                                           |
| `budgets`                | Budgets               |                                                                           |
| `plan`                   | Plan                  |                                                                           |
| `assumptions`            | Assumption[]          |                                                                           |
| `openQuestions`          | OpenQuestion[]        | ≤3 unanswered at any time (FR-006). Must be empty to agree.               |
| `redTeam`                | RedTeamFinding[]      | Every entry `resolved` or `accepted` to agree.                            |
| `provenance`             | Provenance            | Forge session id, decisions, amendment history.                           |
| `createdAt` / `agreedAt` | ISO 8601              | `agreedAt` null while draft.                                              |

### State transitions

```text
                 amend (FR-012)
              ┌───────────────────┐
              ▼                   │
  (new) → draft ──compile OK──→ agreed ──start──→ running ──ship──→ shipped
              │                   │                  │
              └───────────────────┴──────────────────┴──── cancel ──→ cancelled
```

- `draft → agreed` is permitted **only** when all six compile checks pass (§13). Nothing else may set it.
- `agreed → draft` on any amendment, and on a red-team finding raised after agreement; running units are paused, not abandoned (Edge Cases).
- `running → shipped` when every lane has an open draft pull request and the operator has decided.
- `→ cancelled` from any state. Entering it requires the cleanup reconciliation of FR-077 to have run.

### Source

| Field     | Type                       | Rules                                                                                        |
| --------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| `kind`    | enum                       | `typed` \| `tracker` \| `failing_run` \| `review_comment` \| `deferred`                      |
| `tracker` | `linear` \| `jira` \| null | Present iff `kind = tracker`.                                                                |
| `key`     | string \| null             | e.g. `TAV-42`. Unique across open orders — a second seed offers the existing order (FR-013). |
| `url`     | string \| null             |                                                                                              |

---

## 2. Intent

| Field      | Type     | Rules                                                                                                       |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `problem`  | string   | What is wrong or missing.                                                                                   |
| `outcome`  | string   | The observable difference when done.                                                                        |
| `nonGoals` | string[] | May be empty, but the field is required — an absent exclusions list and an empty one mean different things. |

---

## 3. ContextPack

Produced by Scout before the operator is asked anything (FR-002).

| Field         | Type       | Rules                                                                     |
| ------------- | ---------- | ------------------------------------------------------------------------- |
| `repos`       | RepoRef[]  | ≥1.                                                                       |
| `toolchain`   | Toolchain  | Per repo. Probed, never assumed (R4).                                     |
| `entryPoints` | string[]   | `path:symbol`.                                                            |
| `priorArt`    | PriorArt[] | Commits and past ledger decisions on the same files (FR-082).             |
| `conventions` | string[]   | What the surrounding code does.                                           |
| `houseDocs`   | string[]   | Paths to whatever the repository actually carries; may be empty (FR-073). |

### RepoRef

`name`, `path` (absolute), `lane` (int ≥1), `baseBranch`, `headBranch`.

### Toolchain

One entry per check. **`null` is a meaningful value**, not a missing one — it is what makes FR-039's "not measured" reachable.

| Field                                                     | Type                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `test` / `lint` / `format` / `coverage` / `e2e` / `build` | `{ command: string, source: 'package.json' \| 'config' \| 'makefile' \| 'ci' } \| null` |

---

## 4. AcceptanceCriterion

| Field          | Type                                         | Rules                                                                                       |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `id`           | string                                       | `AC-<n>`, unique in the order.                                                              |
| `statement`    | string                                       | Falsifiable.                                                                                |
| `priority`     | `P0` \| `P1` \| `P2`                         |                                                                                             |
| `verify`       | Verify                                       | Must be executable to agree (FR-008).                                                       |
| `unverifiable` | `{ accepted: true, reason: string }` \| null | The only escape from the executability rule, and it requires a written reason (Edge Cases). |

### Verify

| `kind`       | Required fields        | Verdict from                                   |
| ------------ | ---------------------- | ---------------------------------------------- |
| `test`       | `command`, `assert`    | Exit status (FR-037).                          |
| `command`    | `command`, `assert`    | Exit status.                                   |
| `judge`      | `rubric`, `evidence[]` | A verifier's cited judgement.                  |
| `artifact`   | `path`, `assert`       | Presence and content of a produced file.       |
| `screenshot` | `target`               | A picture of the running application (FR-040). |

`evidence[]` values: `exit_code`, `stdout`, `report_file`, `screenshot`, `diff`.

---

## 5. Plan, PlanUnit, Lane

### Plan

| Field         | Type       | Rules                                                                                           |
| ------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `units`       | PlanUnit[] | ≥1. Ids unique. `dependsOn` must reference existing ids and form a DAG — a cycle fails compile. |
| `lanes`       | Lane[]     | ≥1. One per repository (FR-065).                                                                |
| `sharedFiles` | string[]   | Files more than one lane touches. Derived, not authored (FR-026).                               |

### PlanUnit

| Field       | Type     | Rules                                                          |
| ----------- | -------- | -------------------------------------------------------------- |
| `id`        | string   | `U-<n>`.                                                       |
| `title`     | string   |                                                                |
| `role`      | RoleId   | Must resolve.                                                  |
| `lane`      | int      | Must exist in `lanes`.                                         |
| `dependsOn` | string[] | Unit ids.                                                      |
| `satisfies` | string[] | Criterion ids. **≥1 — an orphan unit fails compile** (FR-010). |
| `touches`   | string[] | Predicted paths. Feeds `sharedFiles` and the risk grader.      |
| `verify`    | Verify[] | Unit-local checks in addition to the criteria's.               |

### Lane

Carried into the existing coordinator unchanged (R10).

| Field                  | Type                             | Rules                                                                  |
| ---------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `ord`                  | int                              | Merge order. Lane 1 merges first.                                      |
| `repo`                 | string                           | Must match a `RepoRef.name`.                                           |
| `branch`               | string                           |                                                                        |
| `role`                 | `producer` \| `consumer` \| null |                                                                        |
| `blocks` / `blockedBy` | int[]                            | Normalised to `[]` when absent — absent and empty mean the same thing. |

---

## 6. RiskAssessment

| Field           | Type                         | Rules                                                                                 |
| --------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| `grade`         | `P0` \| `P1` \| `P2` \| `P3` | From the existing grader, top-down, first match wins.                                 |
| `triggers`      | Trigger[]                    | The specific reason, shown on every gate this raises (FR-047).                        |
| `blastRadius`   | string[]                     | Paths the order expects to stay inside. Writing outside is itself a trigger (FR-043). |
| `criticalPaths` | string[]                     | Operator-declared per repository. **Never inferred.**                                 |

`Trigger` ∈ `authentication`, `payments`, `secrets`, `migration`, `public_interface`, `new_dependency`, `network_egress`, `outside_blast_radius`, `critical_path`.

The grade decides two things directly: whether L4 inspection runs (FR-043/FR-044) and whether the draft pull request opens before or after the operator's decision (R11).

---

## 7. Budgets

| Field              | Type        | Default | On breach                                 |
| ------------------ | ----------- | ------- | ----------------------------------------- |
| `agents`           | int         | 3       | Pause + gate (FR-030)                     |
| `wallClockMinutes` | int         | 45      | Pause + gate                              |
| `filesTouched`     | int         | 25      | Pause + gate                              |
| `tokens`           | int \| null | `null`  | Deliberately unset — see spec Assumptions |

---

## 8. Assumption / OpenQuestion / RedTeamFinding

### Assumption

`id`, `text`, `struck` (bool), `affects` (unit and criterion ids). Striking triggers a redraft of exactly `affects` and nothing else (FR-007).

### OpenQuestion

`id`, `text`, `why` (what it changes), `options[]`, `recommended` (index), `answer` (null until answered), `rank`. At most three unanswered are shown (FR-006).

### RedTeamFinding

`id`, `severity`, `text`, `status` ∈ `open` \| `resolved` \| `accepted`, `reason` (required when `accepted`).

---

## 9. Recipe, Step, Role, Rule

Authored as YAML, validated on load (R2). Resolution order for all four: data root → target repository (honoured, never required) → built-in (FR-022).

### Recipe

| Field         | Type          | Rules                            |
| ------------- | ------------- | -------------------------------- |
| `id`          | string        | Filename must match.             |
| `description` | string        |                                  |
| `requires`    | Requirement[] | Unmet ⇒ not offered (FR-020).    |
| `steps`       | Step[]        | Ids unique; `after` forms a DAG. |

`Requirement` examples: `path_exists: .specify/`, `toolchain: test`, `repos: >1`.

### Step

| `kind`   | Fields                                              | Verdict                  |
| -------- | --------------------------------------------------- | ------------------------ |
| `agent`  | `role`, `expect?`, `context: fresh \| resume`       | Output schema validates  |
| `run`    | `command`, `expect?`                                | Exit status              |
| `judge`  | `role`, `rubric`, `evidence[]`                      | Cited pass/fail          |
| `gate`   | `rule`, `options[]`, `defaultIfIgnored`, `deadline` | Operator, or the default |
| `fanout` | `over`, `step`, `after[]`                           | All children             |
| `join`   | `order`                                             | Merge is clean           |

Six kinds, no more (Complexity Tracking).

### Role

`id`, `prompt`, `reads[]`, `writes[]`, `tools[]`, `modelTier`, `allowResume` (bool). The verifier role sets `allowResume: false` structurally — that is how FR-032's fresh context is enforced rather than by convention (R12).

**Every field is enforced, and each by something.** `reads[]` decides what goes
into the brief (`line/brief.ts`); `writes[]` decides whether the read-only
policy is installed, and means **writes to the checkout** — the three
destinations `worktree`, `integration_branch` and `docs`, not "produces an
artefact", because the red team produces findings and the architect a plan
without touching a file; `tools[]` refuses a writing tool to a role that did
not declare `edit`; `modelTier` picks the model the agent launches with, so a
`fast` role runs on the small one; `allowResume` is refused structurally rather
than asked for in a prompt.

`outputSchema` was removed during implementation. It named nine shapes —
`plan`, `verdict`, `findings`, `schedule`, `integration`, `context`, `docs`,
`unit_result` — of which one is a real artefact (the architect's proposal,
validated by `ProposalSchema`) and the rest are a diff and an exit status. A
field nothing could enforce reads as a contract that holds.

**Step fields, and what honours each.** `after` and `over` build the graph;
`when` decides whether the step applies; `role` names the agent; `command` is
run verbatim; `expect` names what the step promises, and anything it names that
was not observed is `not_measured` rather than a pass; `rule`, `options` and
`defaultIfIgnored` shape the gate it raises; `deadlineMinutes` becomes that
gate's deadline, and a gate past its deadline takes its stated default **and
the default is acted on**, not only recorded — the alternative is a line that
waits for ever on a decision the record says was taken; `context: fresh`
refuses a resumable role a session to resume, read from the inner object on a
fan-out because that is where every built-in shape puts it.

### Rule

`id`, `scope` (`universal` \| `project`), `rung` (`L0`–`L6`), `asserts`, `appliesWhen`, `origin` (`built-in` \| `curator:<ledger ids>` \| `operator`). Project-scoped rules load only where the repository carries what they depend on (FR-042).

---

## 10. RunGraph and RunNode

Derived from `order + recipe`. Not authored, not persisted as truth — recomputable from the two inputs plus the node states.

### RunNode

| Field                   | Type             | Rules                                                                                              |
| ----------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| `id`                    | string           | Step id, or `step:unit` for a fan-out child.                                                       |
| `state`                 | enum             | `waiting` \| `ready` \| `running` \| `verifying` \| `passed` \| `failed` \| `blocked` \| `skipped` |
| `unit` / `lane`         | ref \| null      |                                                                                                    |
| `sessionId`             | string \| null   | The supervised session. What "Attach" targets (FR-027).                                            |
| `worktreePath`          | string \| null   | One per unit (FR-023).                                                                             |
| `attempts`              | int              | Two failures ⇒ the third is a gate (FR-041).                                                       |
| `startedAt` / `endedAt` | ISO 8601 \| null |                                                                                                    |

**Scheduler invariants**: a node is `ready` only when every `dependsOn` is `passed`; concurrent `running` + `verifying` never exceeds `budgets.agents`; a consuming lane never reaches `passed` on its join before its producing lane has (FR-066).

---

## 11. Verdict

| Field                    | Type                               | Rules                                                                           |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------------------------- |
| `nodeId` / `criterionId` | ref                                |                                                                                 |
| `result`                 | `pass` \| `fail` \| `not_measured` | **`not_measured` is never counted as `pass`** (FR-039).                         |
| `reason`                 | string                             | Required for `fail` and `not_measured`.                                         |
| `evidence`               | Evidence[]                         | ≥1 for `pass` and `fail`.                                                       |
| `producedBy`             | `{ role, sessionId }`              | **Must differ from the node's `sessionId`** (FR-032). Enforced, not documented. |
| `at`                     | ISO 8601                           |                                                                                 |

`Evidence`: `{ kind, path, excerpt?, exitCode? }` — retained under the order's directory and retrievable afterwards (FR-034).

---

## 12. Gate and LedgerEntry

### Gate

| Field                | Type                                                         | Rules                                          |
| -------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| `id`                 | string                                                       |                                                |
| `rule`               | GateRuleId                                                   | Always named (FR-047).                         |
| `orderId` / `nodeId` | ref                                                          |                                                |
| `evidence`           | Evidence[]                                                   |                                                |
| `options`            | `{ id, label, consequence }[]`                               |                                                |
| `defaultIfIgnored`   | option id                                                    | Usually `hold`.                                |
| `deadline`           | ISO 8601 \| null                                             | Null = holds forever.                          |
| `blockedUnits`       | int                                                          | Ranking input.                                 |
| `rank`               | number                                                       | `blockedUnits × riskWeight` (FR-048). Derived. |
| `decision`           | `{ option, by: 'operator' \| 'default', note?, at }` \| null |                                                |

**GateRuleId** ∈ `risk.p0`, `budget.exceeded`, `destructive`, `ready-for-review`, `verify.repeat-fail`, `critical-path`, `new-dependency`, `forge-defect`, `unit.boundary`, `run.interrupted`.

The first four are live at every autonomy setting (FR-050), and so is `run.interrupted`: every other rule asks about work, and that one says the work stopped — a dial that can silence "this run has no agents left" is a dial that lets a dead run look busy. `unit.boundary` is live only at the most cautious.

### LedgerEntry

Append-only JSONL. `at`, `orderId`, `actor` (`operator` \| `rule:<id>` \| `role:<id>`), `action`, `subject`, `reason`, `evidence[]`. Never rewritten; a reversal is a new entry (FR-078, FR-081).

---

## 13. CompileResult

The output of the six checks (FR-010). Pure function of the order.

| Check        | Fails when                                                                          |
| ------------ | ----------------------------------------------------------------------------------- |
| `questions`  | Any `openQuestions[].answer` is null.                                               |
| `verifiable` | Any criterion's `verify` is not executable and is not `unverifiable.accepted`.      |
| `coverage`   | Any criterion has no unit in `satisfies`, **or** any unit has an empty `satisfies`. |
| `risk`       | `risk.grade` unset, or the graded triggers have no derived gates.                   |
| `redTeam`    | Any finding is `open`, or `accepted` without a reason.                              |
| `budgets`    | `agents`, `wallClockMinutes` or `filesTouched` unset.                               |

`CompileResult` = `{ ok: boolean, failures: { check, detail, subjectIds[] }[] }`. `detail` names the specific offending criterion or unit — FR-011 requires the refusal to say which, not that it refused.

---

## 14. TrackerWriteBack

| Field                     | Type                                                                    | Rules                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `intent`                  | `started` \| `in_review` \| `done`                                      | Intent-based, not a state id: the operator owns which state each intent means (FR-060), and the published interface must not be Linear-shaped (R6). |
| `outcome`                 | `pending` \| `done` \| `failed` \| `unsupported` \| `no_matching_state` | Four terminal values, not two.                                                                                                                      |
| `attempted` / `succeeded` | ISO 8601 \| null                                                        |                                                                                                                                                     |
| `error`                   | string \| null                                                          | Recorded; never fails the work (FR-063).                                                                                                            |

`unsupported` and `failed` are different and are treated differently: a failure is retried, an unsupported capability is recorded once and never retried, and it is known when the order is agreed rather than when the write is due (FR-059a). `no_matching_state` is the operator's workflow having nothing that reads as the intent — recorded and skipped, not an error.

Workflow moves are implemented for Linear only (spec Assumptions). Comments and pull-request links work for every connected tracker.

---

## Cross-cutting invariants

1. An order may only be worked in `agreed` state. Every scheduler entry point asserts it.
2. `Verdict.producedBy.sessionId ≠ RunNode.sessionId`. The single most important invariant in the model.
3. `not_measured` is a third value everywhere a result is read. No boolean coercion.
4. Every gate carries a named rule; a gate with no rule cannot be constructed.
5. `blastRadius` and `criticalPaths` are operator-declared; nothing infers them.
6. All identifiers are stable for the life of an order; nothing is renumbered on amendment.
7. Nothing in this model is written into a target repository (FR-070) — it all lives under the data root.
