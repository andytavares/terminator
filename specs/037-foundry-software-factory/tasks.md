---
description: 'Task list for Foundry — a software factory'
---

# Tasks: Foundry — a software factory

**Input**: Design documents from `/specs/037-foundry-software-factory/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Test tasks are included and are **not optional**. Constitution VI makes TDD non-negotiable and sets an 80% per-file coverage gate; the plan's Constitution Check passes "by construction" on the basis that every new module is a pure function with a unit spec. Every test task must be written and **failing** before the implementation task that follows it.

**Organization**: Tasks are grouped by user story so each can be implemented, tested and delivered independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US8)
- Exact file paths are given in every task

## Path Conventions

Extension work lives under `extensions/foundry/` (renamed from `extensions/speckit-pilot` in T001). Extension specs live under `extensions/foundry/tests/`, already matched by `vitest.config.ts`. The one core change lives under `src/main/`, with specs under `tests/unit/main/`. End-to-end specs live under `tests/e2e/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Rename the extension and get a green build before any behaviour changes. Nothing here changes what the extension does.

- [x] T001 Rename the extension directory with `git mv extensions/speckit-pilot extensions/foundry` so the move is recorded as a rename rather than a delete plus an add
- [x] T002 Set `id` to `terminator.foundry`, `name` to `Foundry` and the workspace tab label to `Foundry` in `extensions/foundry/manifest.json`
- [x] T003 Rename the package to `@terminator/extension-foundry` and add the extension-owned dependencies `zod@3.23.8` and `js-yaml@4.3.1` in `extensions/foundry/package.json` (per research.md R2 and R8; `zod` corrects an existing Principle II gap where it was hoisted from the root manifest)
- [x] T004 [P] Point the `typecheck:extensions` script at `extensions/foundry/tsconfig.json` in `package.json`
- [x] T005 [P] Update the renderer entry paths in `extensions/foundry/vite.renderer.config.ts` and `extensions/foundry/index.html`
- [x] T006 [P] Rewrite `extensions/foundry/CLAUDE.md` for this extension: the `foundry:*` IPC prefix, the extension-owned dependency rule, and the constraint that nothing may be written into a target repository
- [x] T007 Delete the checked-in coverage report directory `extensions/foundry/coverage/` and confirm it is ignored, so a build artefact is not carried through the rename
- [x] T008 Rename every registered IPC channel prefix to `foundry:` and every settings key prefix to `terminator.foundry.` across `extensions/foundry/src/` and `extensions/foundry/tests/` (the live prefix was `speckit:`, not `speckit-pilot:` as this task originally recorded; 54 channels, 441 quoted occurrences, replaced only where quoted so prose was untouched)
- [x] T009 Run `npm run build:extensions` and confirm `extensions/foundry/src/index.js` is produced and remains gitignored
- [x] T010 Run `npx vitest run` and confirm the existing extension specs still pass unchanged after the rename — 83 spec files, 1426 tests, not the 62 this task originally recorded (that count missed `.spec.tsx`) — so the baseline is green before any behaviour changes

**Checkpoint**: The extension is renamed, builds, and behaves exactly as before.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The contract, the schemas, the data root and the toolchain probe. Every user story reads these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

**Note on placement**: the data root and the toolchain probe belong to User Story 4 by subject, but User Story 1 cannot produce a work order without them — an order carries `context.toolchain`, and it has to be written somewhere. They are therefore built here. What remains in the US4 phase is the behaviour that proves portability rather than the machinery that provides it.

### Tests (write first, must fail)

- [x] T011 [P] Spec for data-root resolution — empty setting resolves to `<workdir>/.foundry/`, an absolute setting wins for every repository, a relative setting is rejected — in `extensions/foundry/tests/data-root.spec.ts`
- [x] T012 [P] Spec for the toolchain probe — `package.json` scripts, then tool config, then CI workflow; an undiscoverable command resolves to `null` with a reason — in `extensions/foundry/tests/verify/toolchain-probe.spec.ts`
- [x] T013 [P] Spec for the work-order schema, including that an unknown higher `schemaVersion` is refused outright rather than partially read, in `extensions/foundry/tests/order/schema.spec.ts`
- [x] T014 [P] Spec for recipe, role and rule schema parsing, including a malformed file being reported by path and excluded rather than throwing, in `extensions/foundry/tests/recipe/parse.spec.ts`
- [x] T015 [P] Spec for append-only ledger writes — single-line whole-line appends, no read-modify-write, concurrent writers safe — in `extensions/foundry/tests/ledger/append.spec.ts`

### Implementation

- [x] T016 [P] Implement data-root resolution, resolved once and handed to every writer as an absolute path, in `extensions/foundry/src/data-root.ts`
- [x] T017 [P] Implement the toolchain probe as manifest reads only, never executing the target project's code, generalising `scriptsOf()` and `runs()` from the retiring `runner/self-review-plan.ts`, in `extensions/foundry/src/verify/toolchain-probe.ts`
- [x] T018 Implement the zod work-order schema for every entity in data-model.md §1–§8 in `extensions/foundry/src/order/schema.ts`
- [x] T019 [P] Implement recipe, role and rule schemas and the YAML loader using `js-yaml`'s default safe `load` in `extensions/foundry/src/recipe/parse.ts`
- [x] T020 [P] Implement append-only JSONL ledger writes in `extensions/foundry/src/ledger/append.ts`
- [x] T021 Register the settings from contracts/ipc-channels.md — `dataDir`, `autoOpenDraftPr`, `autonomy`, the three budgets, `writeBack`, `criticalPaths` — in `extensions/foundry/src/index.ts`. Two shapes changed against the contract because `SettingDefinition` has no array or record type: `writeBack` became three booleans (each is independently worth turning off anyway), and `criticalPaths` became a newline-separated workspace-scoped string, with the per-repository map deferred to `config.yaml` under the data root where the contract already puts it
- [ ] T022 **Moved to Phase 4 (with T057–T061).** Deleting `extensions/foundry/src/schemas/speckit.schemas.ts` cannot happen here: `src/state/state-persistence.ts` imports it and is still the live phase state until the pipeline is retired. Deleting it now would break the build for the whole of Phase 3, so it is done alongside the rest of the removal, after the `speckit` recipe has proved the engine

**Checkpoint**: The contract, its storage and the project probe exist and are tested. User stories can begin.

---

## Phase 3: User Story 1 - Agree the work before any of it starts (Priority: P1) 🎯 MVP

**Goal**: An idea or tracker issue becomes an agreed work order that provably cannot hand off incomplete.

**Independent Test**: Seed an idea and a tracker issue; a complete draft appears in both cases without the operator answering anything first. Strike an assumption and only the affected part of the plan is redrawn. Leave a criterion with no matching work and the order refuses to be agreed, naming the gap.

### Tests for User Story 1 (write first, must fail)

- [x] T023 [P] [US1] Spec for the six compile checks, each failing in isolation and naming the specific offending id, plus a complete order returning `ok: true` with zero failures, in `extensions/foundry/tests/order/compile.spec.ts`
- [x] T024 [P] [US1] Spec for the bidirectional coverage matrix — an uncovered criterion and an orphan unit each fail, and an order failing both reports both — in `extensions/foundry/tests/order/coverage-matrix.spec.ts`
- [x] T025 [P] [US1] Spec for the question budget: at most three unanswered questions surfaced, ranked by how much of the plan each changes, in `extensions/foundry/tests/forge/interview.spec.ts`
- [x] T026 [P] [US1] Spec for striking an assumption redrawing exactly its `affects` set and nothing else, in `extensions/foundry/tests/forge/assumptions.spec.ts`
- [x] T027 [P] [US1] Spec for amendment returning an agreed order to draft, re-running all six checks and preserving every identifier, in `extensions/foundry/tests/order/amend.spec.ts`
- [x] T028 [P] [US1] Spec for intake sources — typed, tracker issue, failing run — including a second seed of the same issue key offering the existing order, in `extensions/foundry/tests/forge/intake-source.spec.ts`

### Implementation for User Story 1

- [x] T029 [P] [US1] Implement the six compile checks as a pure function returning `{ ok, failures[] }` with subject ids in `extensions/foundry/src/order/compile.ts`
- [x] T030 [P] [US1] Implement the criteria-by-units coverage matrix in both directions in `extensions/foundry/src/order/coverage-matrix.ts`
- [x] T031 [P] [US1] Implement intake source resolution, including reuse of the existing tracker connection for issue seeding, in `extensions/foundry/src/forge/intake-source.ts`
- [x] T032 [US1] Implement the interview protocol — Scout before any question, question budget of three, ranked with a recommended answer — in `extensions/foundry/src/forge/interview.ts`
- [x] T033 [US1] Implement assumptions and targeted redraft on strike in `extensions/foundry/src/forge/assumptions.ts`
- [x] T034 [US1] Implement the adversarial pass, started without the intake transcript and without a resumed session, in `extensions/foundry/src/forge/red-team.ts`
- [x] T035 [US1] Implement amendment returning the order to draft and recording what changed in `extensions/foundry/src/order/amend.ts`
- [x] T036 [P] [US1] Implement the human rendering of an order, regenerated on every change and never hand-edited, in `extensions/foundry/src/order/render.ts`
- [x] T037 [US1] Register `foundry:order.create`, `foundry:order.turn` and `foundry:order.compile` per contracts/ipc-channels.md in `extensions/foundry/src/index.ts`
- [x] T038 [US1] Build the Forge surface — live order document, convergence checklist, at most three questions, strikeable assumptions, coverage matrix — in `extensions/foundry/src/components/Forge.tsx`
- [x] T039 [US1] Style the Forge surface using only `--tm-*` tokens and flat `lucide-react` icons in `extensions/foundry/src/components/foundry.css`

**Checkpoint**: An order can be agreed, and cannot be agreed while incomplete. Useful on its own even if the work is then done by hand.

---

## Phase 4: User Story 2 - Run each job in the shape it deserves (Priority: P1)

**Goal**: The shape of work is chosen per order rather than fixed, and the old ten-phase pipeline is retired.

**Independent Test**: Run a one-line change and a new feature; they take visibly different routes. Run in a repository lacking `.specify/` and the `speckit` shape is not offered while the others still work.

### Tests for User Story 2 (write first, must fail)

- [ ] T040 [P] [US2] Spec for the six step kinds and their verdict sources, asserting no seventh kind exists, in `extensions/foundry/tests/recipe/step-kinds.spec.ts`
- [ ] T041 [P] [US2] Spec for name resolution across the three rungs — data root, target repository, built-in — including that a repository file is honoured when present and never created, in `extensions/foundry/tests/recipe/resolve.spec.ts`
- [ ] T042 [P] [US2] Spec for recipe requirements gating, including `path_exists: .specify/` making the `speckit` recipe unavailable with a stated reason, in `extensions/foundry/tests/recipe/requirements.spec.ts`
- [ ] T043 [P] [US2] Spec for the scheduler — independent units run together up to the agent budget, a dependent unit does not start until its dependency is verified, a dependency cycle is rejected — in `extensions/foundry/tests/line/scheduler.spec.ts`
- [ ] T044 [P] [US2] Spec for building a run graph from an order and a recipe, including fan-out over units, in `extensions/foundry/tests/line/run-graph.spec.ts`
- [ ] T045 [P] [US2] Spec for the role registry: tool allowlists, model tiers, output schemas, and `allowResume: false` on the verifier, in `extensions/foundry/tests/line/roles.spec.ts`

### Implementation for User Story 2

- [ ] T046 [P] [US2] Implement the six step kinds and the small expression surface for `over`, `when` and `expect` in `extensions/foundry/src/recipe/step-kinds.ts`
- [ ] T047 [P] [US2] Implement three-rung name resolution for recipes, roles and rules in `extensions/foundry/src/recipe/resolve.ts`
- [ ] T048 [P] [US2] Implement requirement evaluation — `path_exists`, `toolchain`, `repos` — in `extensions/foundry/src/recipe/requirements.ts`
- [ ] T049 [US2] Implement the DAG scheduler honouring dependencies and the agent budget in `extensions/foundry/src/line/scheduler.ts`
- [ ] T050 [US2] Implement run-graph construction from order plus recipe in `extensions/foundry/src/line/run-graph.ts`
- [ ] T051 [P] [US2] Implement the role registry in `extensions/foundry/src/line/roles.ts`
- [ ] T052 [P] [US2] Author the built-in role definitions — scout, architect, red-team, builder, verifier, inspector, integrator, scribe, foreman — in `extensions/foundry/roles/*.yaml`
- [ ] T053 [P] [US2] Author the `direct` and `bugfix` built-in recipes in `extensions/foundry/recipes/direct.yaml` and `extensions/foundry/recipes/bugfix.yaml`
- [ ] T054 [P] [US2] Author the `standard`, `refactor` and `spike` built-in recipes in `extensions/foundry/recipes/`
- [ ] T055 [US2] Author the `speckit` built-in recipe expressing all ten existing phases as `run` steps with `requires: path_exists: .specify/` in `extensions/foundry/recipes/speckit.yaml` — this is the proof the abstraction lost nothing
- [ ] T056 [US2] Register `foundry:run.start` and the `foundry:run.observe` broadcast in `extensions/foundry/src/index.ts`

### Retire the phase layer (only after T055 proves the engine)

- [ ] T057 [US2] Delete `PhaseId`, `PhaseStatus`, `PHASE_ORDER`, `PHASE_LABELS`, `QUICK_PHASES`, `DEFAULT_PHASE_GATE` and the phase-keyed settings from `extensions/foundry/src/types/speckit.types.ts`, keeping only what the new model still uses
- [ ] T058 [US2] Delete `PHASE_COMMANDS`, `QUICK_PHASE_COMMANDS` and `PLAIN_PHASE_COMMANDS` and their dispatcher from `extensions/foundry/src/index.ts`
- [ ] T059 [P] [US2] Delete `extensions/foundry/src/state/phase-state-machine.ts`, `derive-stage.ts`, `phase-progress.ts`, `run-queue.ts` and `skill-availability.ts`
- [ ] T060 [P] [US2] Delete `extensions/foundry/src/runner/self-review-plan.ts` once its probe helpers have been generalised into T017
- [ ] T061 [US2] Delete every spec whose subject was removed in T057–T060 rather than leaving it passing against a stub, in `extensions/foundry/tests/`
- [ ] T062 [US2] Run the removal sweep from quickstart.md scenario 9 and confirm every command prints nothing; a green suite is not evidence for this task

**Checkpoint**: Work takes a shape chosen per order; the fixed pipeline is gone and left nothing behind.

---

## Phase 5: User Story 3 - Nothing is trusted on its own say-so (Priority: P1)

**Goal**: Every completed unit is checked by a party other than its author, from evidence, with "not measured" as a first-class result.

**Independent Test**: Complete a unit whose tests pass but which does not meet its criterion; the check rejects it and cites what it looked at. Run in a repository with no lint step; the result reads "not measured" and does not count as a pass.

### Tests for User Story 3 (write first, must fail)

- [ ] T063 [P] [US3] Spec for the three-valued verdict, asserting `not_measured` is never coerced to a pass and requires a reason, in `extensions/foundry/tests/verify/verdict.spec.ts`
- [ ] T064 [P] [US3] Spec rejecting a verdict whose `producedBy.sessionId` equals its node's `sessionId` — the model's most important invariant — in `extensions/foundry/tests/verify/verdict.spec.ts`
- [ ] T065 [P] [US3] Spec for ladder placement L0–L6 and stopping at the first failing rung rather than continuing, in `extensions/foundry/tests/verify/ladder.spec.ts`
- [ ] T066 [P] [US3] Spec for verdicts derived from exit status rather than printed summary, including a command that prints passes and exits non-zero, in `extensions/foundry/tests/verify/ladder.spec.ts`
- [ ] T067 [P] [US3] Spec for rule scoping — universal rules always load, project rules load only where the repository carries what they depend on — in `extensions/foundry/tests/verify/rules.spec.ts`
- [ ] T068 [P] [US3] Spec for the second verification failure raising a gate on the third attempt instead of retrying, in `extensions/foundry/tests/line/scheduler.spec.ts`
- [ ] T069 [P] [US3] Spec for security inspection firing on a risk trigger, not firing without one, and recording that it did not, in `extensions/foundry/tests/verify/ladder.spec.ts`

### Implementation for User Story 3

- [ ] T070 [P] [US3] Implement the three-valued verdict with evidence and the different-producer invariant in `extensions/foundry/src/verify/verdict.ts`
- [ ] T071 [US3] Implement the ladder — rung placement, first-failure stop, per-step exit codes written beside the unit — in `extensions/foundry/src/verify/ladder.ts`
- [ ] T072 [P] [US3] Implement rule loading and scope resolution in `extensions/foundry/src/verify/rules.ts`
- [ ] T073 [P] [US3] Author the universal rule pack — `exit-code-not-count`, `patch-coverage`, `render-not-call`, `reachability`, `every-consumer`, `no-stubs` — in `extensions/foundry/rules/`
- [ ] T074 [P] [US3] Author the project-scoped rule pack — `screenshot-the-app`, `docs-in-pr`, `flat-icons`, `delete-unreachable` — in `extensions/foundry/rules/`
- [ ] T075 [US3] Wire inspection triggers to the existing `runtime/review/risk-grader.ts` output so inspection reads the accumulated change rather than a single unit, in `extensions/foundry/src/verify/ladder.ts`
- [ ] T076 [US3] Enforce `allowResume: false` in the runner so a verifier cannot be started with a `resumeSessionId`, in `extensions/foundry/src/line/roles.ts`

**Checkpoint**: No agent marks its own homework, and an unrunnable check never reports success.

---

## Phase 6: User Story 4 - Use it on any repository, with nothing installed (Priority: P1)

**Goal**: Foundry runs against an unfamiliar repository with no setup and leaves nothing behind.

**Independent Test**: Run a complete order in a repository in a different language with no prior setup. It produces an order and a draft pull request, and afterwards the repository contains nothing Foundry added but the change.

### Tests for User Story 4 (write first, must fail)

- [ ] T077 [P] [US4] Spec asserting no write path targets a directory inside a target repository other than the change itself — including that `.gitignore` is never touched — in `extensions/foundry/tests/data-root.spec.ts`
- [ ] T078 [P] [US4] Spec for the unwritable records location failing at order start, naming the path, with no work begun, in `extensions/foundry/tests/data-root.spec.ts`
- [ ] T079 [P] [US4] Spec for unavailable checks being reported before work starts rather than at the end, in `extensions/foundry/tests/verify/toolchain-probe.spec.ts`
- [ ] T080 [P] [US4] End-to-end footprint spec: run an order in a scratch repository and assert `git status --porcelain` shows the change and at most the warned-about untracked directory, in `tests/e2e/foundry-footprint.spec.ts`

### Implementation for User Story 4

- [ ] T081 [US4] Implement the pre-flight writability check at order start in `extensions/foundry/src/line/scheduler.ts`
- [ ] T082 [US4] Surface the probed toolchain, including which checks will be unavailable, on the order before work starts in `extensions/foundry/src/components/Forge.tsx`
- [ ] T083 [US4] Emit the one-time untracked-directory notice when the default records location is used, without modifying any repository file, in `extensions/foundry/src/data-root.ts`
- [ ] T084 [P] [US4] Read whatever house documents the repository carries — constitution, `CLAUDE.md`, `AGENTS.md`, editor and lint config — and complete intake when it carries none, in `extensions/foundry/src/forge/intake-source.ts`

**Checkpoint**: The tool works in a repository it has never seen, and proves it in a repository that is not this one.

---

## Phase 7: User Story 5 - Be interrupted only when a rule fires (Priority: P2)

**Goal**: One ranked list of decisions, each raised by a named rule, and a way into any agent's live session.

**Independent Test**: Run three orders at once; the list contains only rule-raised items, ordered by how much each unblocks, far below one per stage. Reach a running agent's session in one action from any surface.

### Tests for User Story 5 (write first, must fail)

- [ ] T085 [P] [US5] Spec for each gate rule firing on its trigger and on nothing else, in `extensions/foundry/tests/gates/rules.spec.ts`
- [ ] T086 [P] [US5] Spec asserting the four unconditional rules stay live at every autonomy setting, including the most permissive, in `extensions/foundry/tests/gates/autonomy.spec.ts`
- [ ] T087 [P] [US5] Spec for ranking by blocked units weighted by risk, in `extensions/foundry/tests/gates/rank.spec.ts`
- [ ] T088 [P] [US5] Spec for an unanswered gate taking its default at its deadline and recording that it was automatic, in `extensions/foundry/tests/gates/rules.spec.ts`
- [ ] T089 [P] [US5] Spec asserting a gate cannot be constructed without a named rule, in `extensions/foundry/tests/gates/rules.spec.ts`
- [ ] T090 [P] [US5] Spec for budget breach pausing the unit and raising a gate rather than continuing or dying, in `extensions/foundry/tests/line/scheduler.spec.ts`

### Implementation for User Story 5

- [ ] T091 [P] [US5] Implement the named gate rules and their triggers in `extensions/foundry/src/gates/rules.ts`
- [ ] T092 [P] [US5] Implement the autonomy dial as rule selection rather than a chattiness level in `extensions/foundry/src/gates/autonomy.ts`
- [ ] T093 [P] [US5] Implement inbox ranking in `extensions/foundry/src/gates/rank.ts`
- [ ] T094 [US5] Implement budget enforcement — pause, preserve work in progress, raise a gate — in `extensions/foundry/src/line/scheduler.ts`
- [ ] T095 [US5] Register `foundry:inbox.list`, `foundry:inbox.decide` and `foundry:session.attach` in `extensions/foundry/src/index.ts`
- [ ] T096 [US5] Build the Inbox surface — ranked rows, each naming its rule, its evidence, its options and its default — plus the empty state in `extensions/foundry/src/components/Inbox.tsx`
- [ ] T097 [US5] Build the read-only Floor surface with per-lane units, live feed and an Attach control on every running agent in `extensions/foundry/src/components/Floor.tsx`
- [ ] T098 [US5] End-to-end spec addressing all four surfaces by role and accessible name, reading the overlaid view via `electronApp.evaluate` over `getAllWebContents` and capturing with `capturePage`, in `tests/e2e/foundry.spec.ts`

**Checkpoint**: The operator is interrupted by rules, not by phases, and can always take over.

---

## Phase 8: User Story 6 - Ship as a draft pull request, and keep the tracker in step (Priority: P2)

**Goal**: Work ends in a draft pull request without asking, and the source issue keeps itself current.

**Independent Test**: Complete an order; a draft pull request exists without approval, and the linked issue shows the order summary, a moved state and the pull request link. Turn the setting off and nothing is pushed until the operator says so.

**Note**: This phase contains the only change to core in the feature, approved by the operator on 2026-09-06. See contracts/extension-api-issues.md.

### Tests for User Story 6 (write first, must fail)

- [ ] T099 [P] [US6] Spec for Linear intent resolution by state `type` and never by name, with `issueUpdate` receiving the resolved `stateId`, in `tests/unit/main/integrations/linear-transition.spec.ts`
- [ ] T100 [P] [US6] Spec asserting `supportsTransitions('jira')` is false and a Jira transition rejects with a distinguishable `unsupported` error rather than a generic failure, in `tests/unit/main/integrations/issue-service-transition.spec.ts`
- [ ] T101 [P] [US6] Spec asserting a successful transition invalidates that issue's cache entry, in `tests/unit/main/integrations/issue-service-transition.spec.ts`
- [ ] T102 [P] [US6] Spec asserting the existing Jira provider specs still pass unmodified, confirming this feature does not touch that file, in `tests/unit/main/integrations/`
- [ ] T103 [P] [US6] Spec for the draft-pull-request command line — `--draft`, `--head`, `--base`, `--title`, `--body-file` — and for `gh pr ready` on mark-ready, in `extensions/foundry/tests/line/integrate.spec.ts`
- [ ] T104 [P] [US6] Spec for risk-ordered shipping: the top two grades take the operator's decision before any push, lower grades open the draft first, in `extensions/foundry/tests/line/integrate.spec.ts`
- [ ] T105 [P] [US6] Spec for an unsupported write-back being reported when the order is agreed rather than when the write is due, and recorded once without retry, in `extensions/foundry/tests/trackers/write-back.spec.ts`
- [ ] T106 [P] [US6] Spec for a failed tracker write leaving the work unaffected, being recorded and being retried, in `extensions/foundry/tests/trackers/write-back.spec.ts`

### Implementation for User Story 6 — core

- [ ] T107 [US6] Add the optional `states()` and `transition()` methods and the `TransitionIntent` and `TrackerStateOption` types to `src/main/integrations/providers/provider.ts`
- [ ] T108 [US6] Implement both methods for Linear, resolving intent by state `type` and applying `issueUpdate` with the resolved `stateId`, in `src/main/integrations/providers/linear.provider.ts`
- [ ] T109 [US6] Add `states()`, `transition()` and `supportsTransitions()` to `src/main/integrations/issue-service.ts`, reusing the existing credential resolution and rate-limit retry, and invalidating the cached issue on success
- [ ] T110 [US6] Expose the three methods on `ExtensionAPI.issues` and rewrite the restriction comment at `src/main/extensions/api.ts:332` to state the new boundary, bumping the published API to v2.3.0
- [ ] T111 [US6] Confirm `src/main/integrations/providers/jira.provider.ts` is unchanged by this feature and omits both optional methods

### Implementation for User Story 6 — extension

- [ ] T112 [US6] Implement the integrator: push each lane, write the pull-request body to the order directory, and call `gh pr create --draft` through `ExtensionAPI.shell.exec` in `extensions/foundry/src/line/integrate.ts`
- [ ] T113 [US6] Implement risk-ordered shipping so the top two grades gate before any push and lower grades open the draft first, in `extensions/foundry/src/line/integrate.ts`
- [ ] T114 [US6] Implement the `ready-for-review` gate calling `gh pr ready`, replacing "create the pull request?" with "mark it ready?", in `extensions/foundry/src/gates/rules.ts`
- [ ] T115 [US6] Implement all three write-backs — order summary comment on agreement and amendment, state move on start, draft and merge, pull-request link per lane — in `extensions/foundry/src/trackers/write-back.ts`
- [ ] T116 [US6] Check `supportsTransitions` at order agreement and record the capability as unsupported there rather than at write time, in `extensions/foundry/src/trackers/write-back.ts`
- [ ] T117 [US6] Present the discovered intent-to-state mapping for the operator to adjust, storing the override in Foundry rather than in core, in `extensions/foundry/src/components/Forge.tsx`

**Checkpoint**: Work ships as a reviewable draft and the board stays right without the operator typing.

---

## Phase 9: User Story 7 - One order across several repositories (Priority: P3)

**Goal**: One agreed order spanning several repositories, merged in a declared order, with collisions predicted rather than discovered.

**Independent Test**: Agree one order changing a shared contract in one repository and adopting it in another. Two streams appear, the consumer is held until the producer merges, and the shared file is named before either starts.

### Tests for User Story 7 (write first, must fail)

- [ ] T118 [P] [US7] Spec for lanes sourced from the validated order rather than from an agent-written file, in `extensions/foundry/tests/runtime/workitem.spec.ts`
- [ ] T119 [P] [US7] Spec for shared-file detection at compile time, promoting the producing work ahead of the consuming work, in `extensions/foundry/tests/order/compile.spec.ts`
- [ ] T120 [P] [US7] Spec asserting a consuming lane never merges before its producing lane, in `extensions/foundry/tests/line/integrate.spec.ts`
- [ ] T121 [P] [US7] Spec asserting a single-lane order behaves as one stream with no lane machinery visible, in `extensions/foundry/tests/line/run-graph.spec.ts`

### Implementation for User Story 7

- [ ] T122 [US7] Source lanes from `order.plan.lanes` and delete the `workitem.json` read path in `extensions/foundry/src/runtime/workitem.ts`
- [ ] T123 [US7] Derive `sharedFiles` from unit `touches` across lanes and fail compile when a collision has no producing unit, in `extensions/foundry/src/order/compile.ts`
- [ ] T124 [US7] Open one draft pull request per lane, cross-linked to the others and to the order, holding lane N until lane N−1 is open and green, in `extensions/foundry/src/line/integrate.ts`
- [ ] T125 [US7] Render lanes, their merge order and their blocked reasons on the Floor in `extensions/foundry/src/components/Floor.tsx`

**Checkpoint**: A multi-repository order merges in the right order and a single-repository order is unaffected.

---

## Phase 10: User Story 8 - The factory stops repeating what you reject (Priority: P3)

**Goal**: Recorded decisions become proposed checks, on request.

**Independent Test**: Reject three changes for the same stated reason, ask for proposals, and receive one rule citing those three rejections. Accept it, and the next change that would repeat the mistake is caught before reaching the operator.

### Tests for User Story 8 (write first, must fail)

- [ ] T126 [P] [US8] Spec asserting every operator and rule decision is appended with actor, action, subject and reason, in `extensions/foundry/tests/ledger/append.spec.ts`
- [ ] T127 [P] [US8] Spec for the curator detecting repeated rejections and citing the specific ledger entries each proposal derives from, in `extensions/foundry/tests/ledger/curator.spec.ts`
- [ ] T128 [P] [US8] Spec asserting no proposal is produced unprompted, in `extensions/foundry/tests/ledger/curator.spec.ts`
- [ ] T129 [P] [US8] Spec asserting an accepted rule applies to later work with `origin: curator:<ids>`, a rejected one is never proposed again, and removal is recorded, in `extensions/foundry/tests/verify/rules.spec.ts`

### Implementation for User Story 8

- [ ] T130 [US8] Implement repetition detection and proposal generation with citations in `extensions/foundry/src/ledger/curator.ts`
- [ ] T131 [US8] Write accepted rules to the data root with their derivation recorded, and honour removal, in `extensions/foundry/src/verify/rules.ts`
- [ ] T132 [US8] Register `foundry:ledger.query` and `foundry:rules.propose` in `extensions/foundry/src/index.ts`
- [ ] T133 [US8] Build the Ledger surface with filtering by order, actor and action in `extensions/foundry/src/components/Ledger.tsx`
- [ ] T134 [US8] Supply past decisions affecting the same files as prior art when a new order's context is gathered, in `extensions/foundry/src/forge/intake-source.ts`

**Checkpoint**: The factory learns from rejections instead of repeating them.

---

## Phase 11: Polish & Cross-Cutting Concerns

- [ ] T135 [P] Write ADR-040 recording the work order as the only contract between intake and execution, superseding ADR-010 and ADR-012, in `docs/adr/040-the-work-order-is-the-contract.md`
- [ ] T136 [P] Write ADR-041 recording tracker writes beyond comments, superseding the restriction adopted in feature 031, in `docs/adr/041-tracker-writes-beyond-comments.md`
- [ ] T137 [P] Write ADR-042 recording that Foundry installs nothing into a target repository and where its data lives, in `docs/adr/042-foundry-installs-nothing.md`
- [ ] T138 [P] Replace the SpecKit tab section with Foundry in `README.md`
- [ ] T139 [P] Retake and rename the user-guide screenshots that show the SpecKit tab in `docs/user-guide/screenshots/`
- [ ] T140 [P] Add the Foundry entry to `CHANGELOG.md`
- [ ] T141 Run the four-check audit over `extensions/foundry/src/` and `src/main/integrations/` — every new component reachable from a mounted parent, every new module imported by production code, no stubs, no permanently-empty wiring, and every collection feeding an allocator or gate proven to be written to
- [ ] T142 Run every scenario in `specs/037-foundry-software-factory/quickstart.md`, including scenario 3 in a repository that is not this one
- [ ] T143 Run the gate in order and confirm each command's exit status: `npm run format`, `npm run lint` with 0 errors, `npx vitest run --coverage`, then `node scripts/check-patch-coverage.cjs`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies. T001 blocks everything else in the phase.
- **Foundational (Phase 2)**: depends on Setup. **Blocks every user story.**
- **US1 (Phase 3)**: depends on Foundational.
- **US2 (Phase 4)**: depends on Foundational. T057–T062 additionally depend on T055 — the `speckit` recipe must run before the pipeline it replaces is deleted.
- **US3 (Phase 5)**: depends on Foundational; T075 depends on T050.
- **US4 (Phase 6)**: mechanisms land in Foundational; T080 additionally needs US1, US2 and US6 to run a complete order.
- **US5 (Phase 7)**: depends on US2 for a run graph to raise gates against.
- **US6 (Phase 8)**: depends on US2. Core tasks T107–T111 are independent of every extension task and can be done first.
- **US7 (Phase 9)**: depends on US2 and US6.
- **US8 (Phase 10)**: depends on the ledger from Foundational and on decisions existing, so in practice on US5.
- **Polish (Phase 11)**: depends on everything shipped.

### Within Each User Story

- Tests are written and **failing** before the implementation they cover.
- Schemas before the logic that reads them; logic before the surfaces that render it.
- Story complete and independently testable before moving to the next priority.

### Parallel Opportunities

- Phase 2: T011–T015 in parallel, then T016–T020 in parallel.
- Phase 3: T023–T028 in parallel; T029, T030, T031 and T036 in parallel afterwards.
- Phase 4: T040–T045 in parallel; T046–T048 and T051–T054 in parallel; T059 and T060 in parallel.
- Phase 5: T063–T069 in parallel; T070, T072, T073 and T074 in parallel.
- Phase 8: the core group T107–T111 runs in parallel with the extension group T112–T117, since they share no file.
- Phase 11: T135–T140 all in parallel.

---

## Parallel Example: User Story 1

```bash
# Write the failing specs together:
Task: "Spec for the six compile checks in extensions/foundry/tests/order/compile.spec.ts"
Task: "Spec for the coverage matrix in extensions/foundry/tests/order/coverage-matrix.spec.ts"
Task: "Spec for the question budget in extensions/foundry/tests/forge/interview.spec.ts"
Task: "Spec for striking an assumption in extensions/foundry/tests/forge/assumptions.spec.ts"

# Then the pure functions together:
Task: "Implement compile checks in extensions/foundry/src/order/compile.ts"
Task: "Implement coverage matrix in extensions/foundry/src/order/coverage-matrix.ts"
Task: "Implement intake sources in extensions/foundry/src/forge/intake-source.ts"
Task: "Implement order rendering in extensions/foundry/src/order/render.ts"
```

---

## Implementation Strategy

### MVP first (Setup + Foundational + User Story 1)

1. Phase 1 — rename, green build, green suite.
2. Phase 2 — the contract, the schemas, the data root, the probe.
3. Phase 3 — the Forge and the six compile checks.
4. **Stop and validate**: seed an idea and a tracker issue, and confirm an incomplete plan cannot be agreed.

At that point specs stop being prose nobody can check, even though execution still runs the old way.

### Incremental delivery

1. **+ US2** — work takes a shape chosen per order, and the fixed pipeline is gone.
2. **+ US3** — nothing is trusted on its own say-so. This is what makes unattended runs defensible.
3. **+ US4** — proven in a repository that is not this one.
4. **+ US5, US6** — the operator drops to nought-to-two decisions per order, and work ships as a reviewable draft.
5. **+ US7, US8** — several repositories at once, and a factory that stops repeating rejections.

### Sequencing risk

The load-bearing tasks are T018 (the order schema) and T049 (the scheduler): every later phase reads them. Before starting Phase 4, exercise the schema against four real cases — a one-line bug fix, feature 031, feature 034, and **one repository that is not this one**. If any needs a special case, the schema is wrong, and an afternoon is a cheap place to discover that.

The most dangerous task is T057–T062, the removal. A green suite is not evidence there; the sweep in T062 is.

---

## Notes

- `[P]` means a different file with no dependency on incomplete work.
- Every task names an exact path; none is a direction to go and think about something.
- Commit per logical group, not per file and not per phase.
- Tests must be seen to fail before the implementation that makes them pass — for bug-shaped work this is Constitution VI without exception.
- Stop at any checkpoint and validate that story on its own.
