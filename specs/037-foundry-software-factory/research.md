# Phase 0 Research: Foundry

**Feature**: 037-foundry-software-factory | **Date**: 2026-09-06

Every unknown in the plan's Technical Context is resolved below. Facts about external systems were read from vendor documentation and are cited; facts about this repository were read from the tree at `511de53b` and cite the file.

---

## R1 — Where the new code lives

**Decision**: Rename `extensions/speckit-pilot` to `extensions/foundry` with `git mv`, keep `src/runtime/` verbatim, and replace the layer above it. One extension, no parallel copy, no new workspace package.

**Rationale**: The substrate to keep — `runtime/supervised-runner.ts`, `runtime/review/*`, `runtime/run-registry.ts`, `runtime/feed/*`, `runtime/stall-watcher.ts`, `runtime/lane-coordination.ts`, `runtime/diff-metrics.ts` and the transcript readers — is roughly 70% of the extension's non-UI source and none of it references `PhaseId`. The layer being deleted is `types/speckit.types.ts`, the three prompt tables at `index.ts:50`, `:66` and `:83`, `state/phase-state-machine.ts`, `state/derive-stage.ts`, `state/phase-progress.ts` and `runner/self-review-plan.ts`. A rename touches the substrate not at all.

A partial practical bonus, read from `scripts/check-patch-coverage.cjs:53`: staged files are filtered with `git diff --cached --name-only --diff-filter=ACM`, and git reports a detected rename as `R`. Files that move substantially unchanged are therefore not re-gated at 80%. This is not a licence to assume the gate is off: below git's rename-similarity threshold a move is scored as a delete plus an add, and `A` is in the filter, so a file that moves _and_ changes materially is gated — correctly. Plan for the gate applying to anything genuinely rewritten.

**Alternatives considered**:

- _A new `extensions/foundry` beside the old one._ Rejected: it means two copies of a 60-file runtime kept in step by hand through a five-stage migration, which is the same failure mode as the three parallel prompt tables this feature exists to delete.
- _Promote the runtime into `packages/agent-runtime`._ Genuinely tempting, and it would clear Constitution VII's "two concrete consumers" bar during the migration window. Rejected because the second consumer is temporary by design — once the old extension is gone there is one consumer again, and the package would be an abstraction maintained for nobody. Worth revisiting if a second extension ever wants supervised runs.

---

## R2 — Authoring format for recipes, roles and rules

**Decision**: YAML, parsed with `js-yaml` 4.3.1, validated with `zod`. Add `js-yaml` to `extensions/foundry/package.json`.

**Rationale**: Constitution IV requires the standard library where it fully satisfies the requirement, and `JSON.parse` does parse a recipe. It does not satisfy the requirement, though, because these files are the extension point (FR-021, FR-022): the operator hand-authors them, and rule files in particular exist to encode _why_ a check is enforced. JSON has no comments. Constitution V reserves comments for non-obvious why — a format that cannot carry one is the wrong format for a rules file.

`js-yaml` clears Principle IV on every count: it is the de-facto YAML implementation for Node, it is already a direct dependency of `extensions/notepad` in this workspace, and the root `overrides` block already pins the tree to `^4.3.0` — so the version is settled and the maintenance question is already answered in this repository's favour. It is pure JavaScript, so `scripts/build-extensions.cjs` bundles it without an `external` entry.

`js-yaml`'s default `load` is the safe schema — it does not construct arbitrary types — so no additional hardening is needed beyond schema validation, which zod performs regardless.

**Alternatives considered**:

- _JSON._ Zero dependencies, no comments. Rejected above.
- _TypeScript modules as recipes._ Rejected twice over: it makes an extension point require a rebuild (contradicting FR-021's "without changing the application"), and it would execute operator-authored code in the main process.

---

## R3 — Where verification commands actually run

**Decision**: Verification commands run as steps inside the supervised terminal session that is already executing the unit, writing each step's exit code to a file, exactly as `runner/self-review-plan.ts` does today. Not through `ExtensionAPI.shell.exec`, and not as hidden child processes.

**Rationale**: Three constraints converge on one answer.

`ExtensionAPI.shell.exec` cannot run them: `src/main/shell/shell-executor.ts:4` defines `ALLOWED_COMMANDS = new Set(['git', 'gh'])` and `assertCommandAllowed` throws for anything else. A hidden `child_process.spawn` would work — `runner/agent-runner.ts` already spawns `claude` that way — but it puts the most important evidence in the feature out of the operator's sight, and FR-027 says every agent runs in a session the operator can enter.

The existing self-review already solved the hard parts and its comment explains why: four checks used to be one `&&` chain, so a single exit code answered four questions and everything after the first failure never ran. Each step now runs independently and records its own exit code to `<step>.code`, and where a tool has a documented machine-readable output — eslint's `json` formatter, vitest's `json-summary` coverage reporter — it is asked for that rather than having numbers scraped from console text. That is precisely FR-037 (verdict from exit status, not printed summary) and FR-034 (evidence retained and retrievable) already working. The ladder generalises it from four hardcoded steps to a probed set.

**Alternatives considered**:

- _Extend the shell allowlist._ Rejected: the allowlist is a deliberate core safety property and widening it to "any command" for one extension's benefit removes it for everyone.
- _Hidden child processes._ Rejected on FR-027 and because the transcript is where the evidence belongs.

---

## R4 — Discovering a project's toolchain

**Decision**: A probe that reads manifests only — no execution — and records a command or `null` per check. It generalises the two helpers already in `runner/self-review-plan.ts`: `scriptsOf()`, which parses `package.json` scripts and returns `{}` on any failure, and `runs(scripts, name, tool)`, which checks that a script actually invokes the tool whose flags would be appended.

**Rationale**: FR-071 needs test, lint, format, coverage, e2e and build commands for an unknown project; FR-072 needs "absent" to be a first-class answer. The existing code already models absence correctly — `skipped(reason)` emits `echo '⚠ …' && false`, with the comment "A step that does nothing and says why, so 'not run' never reads as 'passed'." That is FR-039 already implemented, and it is the semantic the whole ladder inherits.

Sources read, in order, first match wins per check: `package.json` scripts; then the tool's own config presence (`vitest.config.*`, `jest.config.*`, `pyproject.toml`, `Cargo.toml`, `Makefile`); then the CI workflow under `.github/workflows/` as a last resort, since what CI runs is by definition what the project considers its gate.

Reading only, never executing, matters for two reasons: FR-070 forbids side effects in the target repository, and probing a repository the operator has just pointed at should not run that repository's code before they have agreed anything.

**Alternatives considered**:

- _Ask the operator for the commands._ Rejected: it is derivable from the repository, and FR-005 forbids asking what is derivable. It becomes a stated assumption they can strike instead, which is FR-004.
- _Run each candidate command to see if it works._ Rejected: executing an unknown repository's scripts during intake is exactly the surprise this design is meant not to spring.

---

## R5 — Where an order's records are stored

**Decision**: Plain files under a resolved data root. JSON for the order and each verdict, JSONL for the append-only ledger, raw patches and evidence files alongside. `ExtensionAPI.db` is available and is not used.

**Rationale**: FR-076 wants every record for an order under one location, and the spec's Overview and the existing `runtime/workitem.ts` comment both make the same argument for files: a record you can read in a bare terminal, diff, and recover after the application is gone is worth more than one inside an application store. For a single operator with a few concurrent orders there is no query the filesystem cannot answer — the inbox ranks a list that is already in memory.

Not using the database is a YAGNI call under Principle VII, and it is reversible: an index can be added later without changing where the truth lives.

**Alternatives considered**:

- _`ExtensionAPI.db` as the store._ Rejected on FR-076's readability requirement and on the absence of any query that needs it.
- _Files plus a database index from the start._ Rejected as speculative; nothing in the P1–P3 stories is slow without it.

---

## R6 — Tracker write-back, and the Linear/Jira model mismatch

**Decision**: Add an intent-based workflow-move capability to core — `states()` and `transition(intent)` on `TrackerProvider`, `IssueService` and `ExtensionAPI.issues`, where intent is `started | in_review | done`. **The two provider methods are optional, and only Linear implements them**; Jira omits them and the service reports the capability as unsupported (FR-059a). Record it as ADR-041, superseding the write restriction adopted in feature 031. Comments (FR-058) need no change; pull-request links (FR-061) ship as comments first and become native attachments only if that proves insufficient.

**Scope note (operator decision, 2026-09-06)**: write-back beyond comments is wanted for Linear only. Jira stays connected, readable and commentable; it simply does not gain a move. That removes a Jira transition path nobody would exercise, which Principle V would otherwise count as dead weight.

**Rationale**: The capability does not exist today. `src/main/integrations/providers/provider.ts:47` defines `TrackerProvider` as `verify / listMine / search / get / comment`, `issue-service.ts:42` mirrors it, and `src/main/extensions/api.ts:332` states the restriction outright: "There is deliberately no way to create or edit an issue, or to change any field of one: `comment` is the only write, and FR-034 says so." FR-059 cannot be met without changing that, and the operator asked for all three write-backs.

The interface is intent-based rather than `setState(stateId)` for two independent reasons, and the first survives the decision to build Linear only:

**FR-060 requires the operator to adjust which state each intent means.** "In review" is not a fact about a tracker, it is a mapping the operator owns. A `setState(stateId)` signature puts the caller in charge of resolving that mapping every time, which means every caller re-implements it; an intent puts it in one place. That reasoning holds with one tracker as firmly as with two.

**And `ExtensionAPI` is a published interface.** Baking Linear's model into it would make it permanently unimplementable for a tracker the application already ships support for, because the two do not share a model:

- **Linear** sets the target state directly. `issueUpdate(id, input: { stateId })` changes an issue's state, and workflow states carry a `type`; Linear's own agent guidance queries `team(id) { states(filter: { type: { eq: "started" } }) }` to find the right status rather than matching on a name. (Linear developer documentation, GraphQL and agent best-practices pages.)
- **Jira** cannot set a status at all. `GET /rest/api/3/issue/{issueIdOrKey}/transitions` returns only the transitions valid _from the issue's current status_, and `POST` to the same endpoint performs one; the documentation is explicit that a requested transition that does not exist or cannot be performed returns an empty list. (Jira Cloud platform REST v3, issues API group.)

Matching on state _name_ is wrong for both — Linear's own guidance says to use `type`, and Jira workflows are renamed freely. Hence FR-060: read what the tracker offers, map by type where the tracker exposes one, and present the mapping for the operator to adjust.

Two consequences worth planning for. An intent may have no matching state at all — the operator's Linear workflow may have nothing that reads as review — which is an FR-063 case: record once, continue, never fail the work over a tracker write. And a tracker with no move capability at all must say so **when the order is agreed**, not when the write is attempted (FR-059a), so that "this issue will not move" is something the operator knows before the run rather than discovers in the ledger afterwards.

**Alternatives considered**:

- _Comment-only write-back._ Rejected by the operator's "all three", and on merit: a comment saying the issue is in review does not put it in review, so the board — the thing the operator actually looks at — stays wrong.
- _Implementing the Jira transition path anyway._ Rejected on the operator's instruction and on Principle V: it is a provider path, a resolution rule and a test suite for a tracker they do not use. The optional-method shape means adding it later is additive, not a breaking change.
- _Required methods that throw `not supported` on Jira._ Rejected as the worst option: the interface would claim a capability half its implementations lack, and the only way to discover the truth would be to call it and catch.
- _The extension calling Linear and Jira itself._ Rejected outright. It requires the extension to hold a credential, which Principle II forbids and which `ExtensionAPI.issues` was built to prevent.
- _A generic `updateIssue(fields)` on the API._ Rejected as too broad: it reopens every field of every issue to every extension to solve one requirement. Intent-based transition is the narrowest thing that satisfies FR-059.

---

## R7 — Opening and marking pull requests

**Decision**: `gh` through `ExtensionAPI.shell.exec`. Create with `gh pr create --draft --head <branch> --base <base> --title <t> --body-file <path>`; mark ready with `gh pr ready <branch>`.

**Rationale**: `gh` is one of the two allowed commands (`shell-executor.ts:4`), so no core change is needed and `cwd` is already asserted inside the workspace root. The flags are confirmed against the official manual: `gh pr create` documents `-d, --draft`, `-H, --head <branch>`, `-B, --base <branch>`, `-t, --title` and `-F, --body-file <file>`; `gh pr ready [<number> | <url> | <branch>]` marks a pull request ready for review and takes `--undo` to convert it back to draft. (GitHub CLI manual, `gh_pr_create` and `gh_pr_ready`.)

`--body-file` rather than `--body` is not a detail: a Foundry pull-request body carries the narrative, a verdict per criterion and any inspection findings, and passing that through argv is fragile at best and lossy at worst. The body is written into the order's directory and passed by path, which also leaves it as retained evidence for free.

`gh pr create` prompts when the branch is not fully pushed; `--head` is documented as skipping the forking and pushing behaviour, so the push is performed explicitly by the integrator before the call and the command never becomes interactive.

**Alternatives considered**:

- _The GitHub REST API directly._ Rejected: it needs a credential the extension must not hold, and `gh` is already sanctioned and already authenticated on the operator's machine.
- _`--fill` from commit messages._ Rejected: the body is the verification record, not a restatement of the commits.

---

## R8 — Schema validation

**Decision**: `zod` 3.23.8, and add it to `extensions/foundry/package.json`.

**Rationale**: The extension already uses it — `src/schemas/speckit.schemas.ts:1` imports `z` — and `scripts/build-extensions.cjs:27` lists `zod` in esbuild's `external` array, so it is resolved at runtime rather than bundled. It is currently satisfied by hoisting from the root manifest, which is the gap Principle II calls a defect: "All npm packages an extension needs MUST be declared in that extension's own `package.json`." Declaring it there corrects an existing violation at no cost, since npm workspaces hoist it to the same place.

Every boundary gets a schema: the work order, each recipe, role and rule file, and each verdict. All four are either operator-authored or agent-authored, which is to say none of them is trustworthy on read — the same reasoning `runtime/workitem.ts` already applies to `workitem.json`: "Nothing here trusts the file: it is written by an agent, and a lane list that throws on read would take the card's whole drawer with it."

**Alternatives considered**: hand-written type guards (more code, no better), and trusting the files (the failure mode is a corrupt order taking the whole surface down).

---

## R9 — Resolving the data root

**Decision**: One setting, `terminator.foundry.dataDir`, registered through `ExtensionAPI.settings.register`. Resolved once at activation by a single module; every writer receives an absolute path and never resolves it again. Empty means `<workdir>/.foundry/`.

**Rationale**: FR-074 gives two behaviours and FR-075 requires a specific failure. Resolving in one place makes both testable as pure functions and makes it impossible for two writers to disagree about where the record is — a real hazard once an order spans repositories, since the working directory is then ambiguous by definition.

The unwritable case (FR-075) is checked at order start, not at first write: an order that fails half way through because a directory could not be created has already spent agent time, and the message would arrive attached to the wrong thing.

Foundry never writes an ignore entry for the default location (FR-070 includes `.gitignore`). The operator is told once, and told that configuring a single location avoids the problem entirely.

**Alternatives considered**:

- _Always beside the repository._ Rejected: a multi-repository order has no single repository to live beside, which is the same argument that made FR-065 and FR-074 interact.
- _Always a single global location._ Better in practice and the recommended configuration, but it cannot be the default because the tool has to work before anything is configured.

---

## R10 — Lanes

**Decision**: Keep `runtime/lane-coordination.ts` as it is. Change only where a lane list comes from: today `runtime/workitem.ts` reads `workitem.json`, a file an agent may or may not have written; under Foundry lanes are a validated field of the agreed order.

**Rationale**: The coordination logic is already correct and already tested — merge order by `ord`, `blocks` / `blocked_by`, producer/consumer roles, predicted collisions from `contract.shared_files`, and a documented collapse to a no-op for a single lane, which is FR-068 verbatim. What is wrong today is provenance: an agent writes a JSON file, the console watches for it, and nothing validates it before it decides merge order. Moving it into the order means the compile checks see it, so a lane that cannot be ordered, named or checked out fails before any work starts rather than producing a half-lane in the strip.

**Alternatives considered**: rewriting the coordination logic (no reason — it is not the broken part), and keeping `workitem.json` as the source (rejected: it is unvalidated, and FR-026 requires collisions to be identified when the order is agreed, not when a file happens to appear).

---

## R11 — When the draft pull request opens, relative to the risk gate

**Decision**: For orders graded P0 or P1, the operator's risk decision is taken before anything is pushed. For P2 and P3, the draft pull request opens first and the decision is taken on it. Setting `terminator.foundry.autoOpenDraftPr`, default on; off restores a gate before any push.

**Rationale**: This is the operator's choice, recorded in the spec's Assumptions, and the cost is stated there: it is two behaviours rather than one predictable rule. The technical consequence for this plan is that the integrator has two orderings to implement and the risk grade must be known before the push decision — which it is, since `runtime/review/risk-grader.ts` grades from the change and the order carries `blast_radius` and `critical_paths` from the moment it is agreed.

The mitigation is display, not logic: the grade is shown on the order before work starts, so the operator knows which of the two behaviours this order will take.

**Alternatives considered**: both single-rule options, each rejected by the operator and on merit — always-gate-first discards the benefit of reviewing a real diff, always-push-first puts unreviewed authentication and migration changes on a remote.

---

## R12 — How "fresh context" is achieved for verification

**Decision**: A verifier runs as a separate supervised session with its own conversation, started from the unit's diff and the text of the criteria it claims to satisfy. It is never a continuation of the builder's session, and the builder's transcript is not among its inputs.

**Rationale**: FR-032 requires the checking party to have no access to the producer's reasoning, and `runtime/supervised-runner.ts` already gives every run its own session id and transcript with `--resume` as the only way to continue one — so "fresh" is achieved by not passing `resumeSessionId`, which is a property of how a run is started rather than a new mechanism. The temptation to resume is real, because resuming is cheaper; it is precisely what must not happen, so the verifier role definition forbids `resumeSessionId` structurally rather than by convention.

**Alternatives considered**:

- _Same session, different prompt._ Rejected: the builder's justification is in the context window, and asking a model to ignore what it can see is not a control.
- _A non-agent verifier — commands only._ Insufficient. Commands cover L0–L2; FR-032 and FR-040 need a judgement about whether the criterion was actually met, which is what L3 is for.

---

## R13 — Removing the phase layer without leaving debris

**Decision**: Removal is its own task with its own acceptance criterion, run after the recipe engine is proven by the `speckit` recipe, and gated by an explicit sweep rather than by the test suite going green.

**Rationale**: Constitution X makes dead code a defect, and this deletion orphans a lot: `PhaseId`, `PHASE_ORDER`, `PHASE_LABELS`, `QUICK_PHASES`, `PHASE_COMMANDS`, `QUICK_PHASE_COMMANDS`, `PLAIN_PHASE_COMMANDS`, `DEFAULT_PHASE_GATE`, the phase state machine, `derive-stage`, `phase-progress`, `skill-availability` and roughly twenty of the sixty-two existing specs. A passing suite proves nothing here — a spec for a deleted module passes right up until it is deleted with it.

The sweep is mechanical and is the acceptance criterion: for every symbol removed, `grep -rn "<symbol>" extensions/foundry/src src/ | grep -v test` returns nothing; for every module removed, no import of it remains; every spec whose subject is gone is deleted with it rather than left passing against a stub.

**Alternatives considered**: deprecating in place (rejected — Principle X, and dead code with a comment is still dead code), and deleting first (rejected — the `speckit` recipe is what proves the recipe engine can express the old pipeline, so the old pipeline has to still work when it is written).

---

## R14 — The four surfaces

**Decision**: Four components — Inbox, Forge, Floor, Ledger — replacing eleven, rendered in the extension's existing webview, built on `@terminator/extension-ui`, styled with the `--tm-*` tokens.

**Rationale**: `packages/extension-ui` is the published interface floor for exactly this (`api.ts:298`): dialogs, confirmations, toasts, empty states and icon buttons ship as a React package because components cannot cross a `contextBridge`. `EXTENSION_BASE_CSS` is the only place `--tm-*` tokens are defined, and it carries both themes — so a surface that styles against them is theme-correct for free, and one that invents a token name renders unstyled.

The count matters. `PhaseRail`, `GatePanel`, `SelfReviewGate`, `OpenPrGate`, `BatchCheckIn`, `BoardView`, `LaneStrip`, `CardDetail`, `CardTile`, `ArtifactsPanel` and `PermissionQueue` are eleven components that each show part of one card's state, which is why the answer to "what needs me?" is currently spread across all of them. FR-048 requires a single ordered list, and that is a different information architecture, not a rearrangement of these.

Two constraints inherited from this repository's history, both already paid for once: the extension's UI is an overlaid `WebContentsView`, so Playwright's page cannot see it — e2e reads it through `electronApp.evaluate` over `getAllWebContents` and screenshots with `capturePage`; and e2e must address elements by role and accessible name rather than by CSS class.

**Alternatives considered**: keeping the board and adding an inbox beside it (rejected — two places to look is the problem, not the solution), and rendering surfaces in core (rejected — Principle II).

---

## Resolved unknowns

| Unknown from Technical Context                                   | Resolution                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Whether verification commands can run through the sanctioned API | No — allowlist is `git`/`gh`. They run in the supervised session (R3).                                         |
| Whether tracker status write-back is possible today              | No. Requires a generic, intent-based core API addition and an ADR (R6).                                        |
| Whether Linear and Jira share a state model                      | They do not — which is why the published signature is intent-based even though only Linear implements it (R6). |
| Whether to build the Jira move path                              | No. Operator decision, 2026-09-06. Optional provider methods; Jira reports unsupported (R6).                   |
| Which pull-request flags are correct                             | `gh pr create --draft --head --base --title --body-file`; `gh pr ready` (R7).                                  |
| Whether a YAML dependency is justified                           | Yes, with precedent in-tree and a stated stdlib-first test (R2).                                               |
| Whether a database is needed                                     | No (R5).                                                                                                       |
| How "fresh context" is enforced                                  | By not resuming a session; structural in the role definition (R12).                                            |
| Whether the rename re-triggers the coverage gate                 | No — the gate filters to `ACM` and git reports a move as `R` (R1).                                             |
