# Implementation Plan: Foundry — a software factory

**Branch**: `037-foundry-software-factory` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/037-foundry-software-factory/spec.md`

## Summary

Replace the fixed ten-phase SpecKit pipeline in `extensions/speckit-pilot` with two loops over one contract: a **Forge** that converges an idea or tracker issue into a compilable work order, and a **Line** that compiles that order into a run graph and executes it with typed agent roles, independent verification and risk-priced human gates, finishing with a draft pull request.

The technical shape of the work is a **layer replacement, not a rewrite**. Everything below the pipeline in `extensions/speckit-pilot/src/runtime/` is already phase-agnostic and stays: supervised terminal execution with `PreToolUse` holding, the permission bridge, hunk-level review with revert, the P0–P3 risk grader, lane coordination, the run registry, feed log, stall watcher and diff metrics. What is deleted is the `PhaseId` union and its three parallel prompt tables, the phase state machine, and the eleven UI components arguing over a card. What replaces them is a work-order schema with a compile check, a recipe/role/rule resolver, a DAG scheduler and four surfaces.

Two findings from Phase 0 change the shape of the work and are carried into the gates below:

1. **Tracker status write-back is not possible through today's Extension API.** `TrackerProvider` and `ExtensionAPI.issues` expose `verify / listMine / search / get / comment` and nothing else; feature 031 excluded writes deliberately. FR-059 and FR-060 therefore require a versioned addition to the core Extension API plus an ADR superseding that decision. This is core gaining a generic capability, not core learning about Foundry, so extension isolation holds — but it is a core change and is planned as one.
2. **The capability is built for Linear only, and is still expressed as an intent.** The operator does not need Jira write-back, so `TrackerProvider` gains the two methods as _optional_, Linear implements them and Jira does not — reporting the capability as unsupported rather than carrying a half-built implementation. The signature stays intent-based (`started` / `in_review` / `done`) rather than `setState(stateId)` for two independent reasons: FR-060 requires the operator to adjust which state each intent means, which needs the indirection with one tracker as much as with two; and `setState` would bake Linear's model into a _published_ interface that Jira could never satisfy, since Jira cannot set a status at all — it performs a transition valid from the current status.

## Technical Context

**Language/Version**: TypeScript 5.5.4. Repository is ESM (`"type": "module"`); extension entry points are bundled to CJS targeting Node 20 by `scripts/build-extensions.cjs`.

**Primary Dependencies**: Electron 42.4.1, React 18.3.1, `zod` 3.23.8 (schema validation; already used by this extension and marked `external` in the extension build), `js-yaml` 4.3.1 (new to this extension; already a direct dependency of `extensions/notepad`, so version and maintenance are established in-tree), `lucide-react` 0.475.x, `@terminator/extension-ui` (workspace), `diff` 5.2.2 (retained, used by the review layer).

**Storage**: Plain files under a resolved data root — one directory per work order, JSON for the order and verdicts, JSONL for the append-only ledger, raw patches and evidence files alongside. No database. `ExtensionAPI.db` exists but is not used: nothing in the P1–P3 stories needs a query the filesystem cannot answer for a single operator, and FR-076 wants the record readable outside the application.

**Testing**: Vitest 4.1.9 with v8 coverage (80% thresholds on lines, statements, branches, functions; enforced per staged file by `scripts/check-patch-coverage.cjs`). Playwright 1.61.0 for end-to-end. Extension specs live in `extensions/foundry/tests/**/*.spec.ts` and are already picked up by `vitest.config.ts`.

**Target Platform**: Electron desktop application on macOS (darwin) primarily; the extension runs in the main process with full Node access and contributes a webview renderer.

**Project Type**: Desktop-application extension — a main-process module plus a webview renderer bundle — with one small, generic addition to the core Extension API.

**Performance Goals**: First complete draft work order visible within one agent turn of seeding (no progress-bar-only state). Toolchain probe completes in under two seconds on a cold repository, since it is manifest reads only. The Floor keeps up with three concurrent runs without dropping feed events. The inbox orders and renders 200 outstanding gates in under 100 ms.

**Constraints**:

- **Nothing may be written into a target repository** other than the change the order asked for (FR-070). This forbids any scaffolding, init step or committed configuration, and it forbids editing `.gitignore`.
- **Extension isolation** (Constitution II): the extension may not import core internals; anything it needs from core comes through `ExtensionAPI`.
- **A capability a tracker lacks is reported, never emulated.** Foundry does not work around a missing provider method by, say, posting a comment that says the issue moved.
- **`ExtensionAPI.shell.exec` allows only `git` and `gh`**, with `cwd` asserted inside the workspace root. Verification commands (`npm test`, `pytest`, …) therefore do not run through it — they run as steps inside the supervised terminal session, which is also what makes them visible and hook-gated.
- Extension-only dependencies must be declared in the extension's own `package.json`, not the root manifest.
- All icons `lucide-react`, flat, `currentColor` (Constitution XII).

**Scale/Scope**: One operator. Default three concurrent agents, forty-five minutes wall clock, twenty-five files touched per order. Orders spanning one to a handful of repositories. 84 functional requirements across five delivery stages; stages 1–2 are load-bearing for the rest.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design._

The constitution has no Principle III; numbering runs I, II, IV–XII. Each binding principle is evaluated below.

| Principle                                        | Gate                                                                                              | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Source Integrity**                          | Every external behaviour relied on is verified against vendor documentation before it is planned. | **PASS.** Linear `issueUpdate(input: { stateId })` and workflow-state listing by `type`, Jira `GET`/`POST /rest/api/3/issue/{key}/transitions`, and `gh pr create --draft --head --base --body-file` / `gh pr ready` were each read from official documentation during Phase 0 and are cited in [research.md](./research.md). No behaviour in this plan rests on inference.                                                                                                                                                                                |
| **II. Extension Isolation (NON-NEGOTIABLE)**     | Deleting the extension directory must leave core building and running unmodified.                 | **PASS, with one planned core change.** All Foundry logic, schemas, stores and components live under `extensions/foundry/`. The one core change — an optional workflow-move capability on `ExtensionAPI.issues`, implemented for Linear — is _generic_: core gains no knowledge of Foundry, no `foundry:*` channel appears in core, and any extension can use it. Deleting `extensions/foundry/` still leaves core building. Recorded in Complexity Tracking.                                                                                              |
| **IV. Dependency Stewardship**                   | Justify every addition; prefer stdlib; pin versions; active community.                            | **PASS.** One new dependency for this extension: `js-yaml` 4.3.1 — pinned, the de-facto YAML implementation for Node, already a direct dependency of `extensions/notepad` in this workspace and already resolved at 4.3.1 by a root `overrides` entry. `zod` 3.23.8 is added to the extension's own `package.json`, correcting an existing gap where the extension imports it from the hoisted root manifest. Nothing else is added. The stdlib-first test is applied to YAML explicitly in [research.md](./research.md) R2 and the trade-off is recorded. |
| **V. Code Readability & Minimalism**             | No speculative code; abstraction must be earned.                                                  | **PASS.** The recipe engine has exactly six step kinds and exists because there are already six concrete recipes to express. Roles are data because there are nine concrete roles. `ExtensionAPI.db` is deliberately not used. Stacked pull requests, scheduled rule proposals and multi-user support are all excluded by the spec's Out of Scope and are not built.                                                                                                                                                                                       |
| **VI. Test-Driven Development (NON-NEGOTIABLE)** | Red → Green → Refactor; ≥80% per file; no new file ships untested.                                | **PASS by construction.** Every new module is a pure function over data — the compile checker, the coverage matrix, the resolver, the scheduler, the probe, the risk-to-gate mapping, the inbox ranking — so each has a unit spec with no host required. UI components are excluded from coverage by `vitest.config.ts` and are covered by e2e instead. The gate command is `npx vitest run --coverage` followed by `node scripts/check-patch-coverage.cjs`.                                                                                               |
| **VII. SOLID Design & YAGNI**                    | Simplest design that implements the spec; deviations recorded.                                    | **PASS.** One deviation is recorded in Complexity Tracking (the core API addition). The directory move is chosen over a parallel extension precisely to avoid maintaining two copies of a runtime.                                                                                                                                                                                                                                                                                                                                                         |
| **VIII. Documentation as First-Class**           | Docs ship in the same change.                                                                     | **PLANNED.** `README.md` (the SpecKit tab is documented there today), `extensions/foundry/CLAUDE.md`, the user guide screenshots naming the SpecKit tab, and `CHANGELOG.md` all change in the same pull requests. Tracked as tasks, not as follow-up.                                                                                                                                                                                                                                                                                                      |
| **IX. Architectural Decision Records**           | Significant decisions recorded at the time, immutable, superseding rather than editing.           | **PLANNED.** Three ADRs, next number 040: **ADR-040** the work order as the only contract between intake and execution (superseding ADR-010 speckit-card-model and ADR-012 speckit-run-modes); **ADR-041** tracker writes beyond comments — supersedes the decision recorded in feature 031 that `comment` is the only write; **ADR-042** Foundry installs nothing into a target repository, and where its data lives.                                                                                                                                     |
| **X. Code Cleanliness (NON-NEGOTIABLE)**         | No dead code, no unused exports, lint 0 errors, compiled extension output gitignored.             | **PASS, with a specific hazard.** Deleting the phase layer orphans a large number of exports and roughly 20 of the 62 existing extension specs. The removal is a task in its own right, not a side effect, and the "does anything still import this?" sweep is an explicit acceptance criterion on it. `extensions/foundry/src/index.js` remains a build artefact and stays gitignored.                                                                                                                                                                    |
| **XI. Functional Purity & Immutability**         | Pure, deterministic domain logic; side effects at the boundary.                                   | **PASS.** The order, its compile checks, the run graph, the ranking and the resolver are pure functions over immutable data. Every side effect — spawning a session, writing the data root, calling a tracker, running `gh` — sits in a named boundary module.                                                                                                                                                                                                                                                                                             |
| **XII. UI Icons (NON-NEGOTIABLE)**               | `lucide-react` only, flat, `currentColor`, sized by CSS.                                          | **PASS.** The four new surfaces use `lucide-react` exclusively; state is carried by shape and position, and by the semantic tokens already defined in `src/renderer/styles.css`, never by colouring an icon.                                                                                                                                                                                                                                                                                                                                               |
| **Development Environment & Workflow**           | Feature branch only; spec ratified before implementation.                                         | **PASS.** On `037-foundry-software-factory`; spec ratified and its quality checklist passing before this plan.                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Post-design re-check

Re-evaluated after Phase 1. No verdict changed. Two things were tightened by the design work:

- The tracker contract in `contracts/extension-api-issues.md` is intent-based rather than state-id-based, which is what keeps the core addition generic enough to satisfy Principle II. A `setState(stateId)` signature would have leaked Linear's model into a shared interface and been unimplementable for Jira.
- The verification ladder runs its commands inside the supervised session rather than through hidden child processes. That was originally a convenience decision; it is now load-bearing for Principle XI (the side effect is at a named boundary that already exists) and for FR-034 (evidence is in a transcript the operator can read).

## Project Structure

### Documentation (this feature)

```text
specs/037-foundry-software-factory/
├── plan.md              # This file
├── spec.md              # Ratified specification
├── research.md          # Phase 0 output — decisions with rationale and alternatives
├── data-model.md        # Phase 1 output — entities, fields, states, invariants
├── quickstart.md        # Phase 1 output — how to prove it works
├── contracts/
│   ├── work-order.md            # The contract between the two loops
│   ├── recipe-role-rule.md      # Authoring format and name resolution
│   ├── ipc-channels.md          # foundry:* channels
│   ├── extension-api-issues.md  # The core Extension API addition
│   └── data-root.md             # On-disk layout and the location setting
├── checklists/
│   └── requirements.md  # Specification quality checklist (passing)
└── tasks.md             # Phase 2 output — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
extensions/foundry/                     # git mv from extensions/speckit-pilot
├── manifest.json                       # id terminator.foundry, tab "Foundry"
├── package.json                        # + zod, + js-yaml (extension-owned)
├── CLAUDE.md                           # rewritten for this extension
├── recipes/                            # built-in, shipped in the bundle
│   ├── direct.yaml  bugfix.yaml  standard.yaml
│   └── speckit.yaml refactor.yaml spike.yaml
├── roles/                              # built-in role definitions
├── rules/                              # built-in universal checks
└── src/
    ├── index.ts                        # activation, IPC registration, settings
    ├── order/                          # THE CONTRACT — all new
    │   ├── schema.ts                   # zod schema for a work order
    │   ├── compile.ts                  # the six checks, pure
    │   ├── coverage-matrix.ts          # criteria × units, both directions
    │   ├── amend.ts                    # agreed → draft on amendment
    │   └── render.ts                   # order → human-readable rendering
    ├── forge/                          # INTAKE — all new
    │   ├── intake-source.ts            # typed | tracker issue | failing run
    │   ├── interview.ts                # question budget, ranking, assumptions
    │   ├── assumptions.ts              # strike → targeted redraft
    │   └── red-team.ts                 # adversarial pass, fresh context
    ├── recipe/                         # SHAPES OF WORK — all new
    │   ├── step-kinds.ts               # agent | run | judge | gate | fanout | join
    │   ├── parse.ts                    # YAML → validated Recipe
    │   ├── resolve.ts                  # data root → repo → built-in
    │   └── requirements.ts             # a recipe declares what a repo must have
    ├── line/                           # EXECUTION — all new
    │   ├── scheduler.ts                # DAG over units, honours budgets
    │   ├── run-graph.ts                # order + recipe → graph
    │   ├── roles.ts                    # role registry, tool allowlists, tiers
    │   └── integrate.ts                # lane merge order, draft PR per lane
    ├── verify/                         # THE LADDER — all new
    │   ├── ladder.ts                   # L0–L6 placement and stop-at-first-fail
    │   ├── toolchain-probe.ts          # generalises self-review-plan's scriptsOf
    │   ├── verdict.ts                  # pass | fail | not-measured, + evidence
    │   └── rules.ts                    # universal vs project scope
    ├── gates/                          # INTERRUPTIONS — all new
    │   ├── rules.ts                    # named gate rules and their triggers
    │   ├── autonomy.ts                 # which rules are live at each setting
    │   └── rank.ts                     # blocked units × risk weight
    ├── ledger/                         # RECORDS — all new
    │   ├── append.ts                   # JSONL, append-only
    │   └── curator.ts                  # on-request rule proposals
    ├── data-root.ts                    # setting → absolute path, resolved once
    ├── trackers/
    │   └── write-back.ts               # comment, transition, PR link
    ├── runtime/                        # KEPT — moved, not rewritten
    │   ├── supervised-runner.ts  claude-launch.ts  hook-script.ts
    │   ├── control-server.ts  permission-bridge.ts  pending-permissions.ts
    │   ├── review/*  run-registry.ts  feed/*  stall-watcher.ts
    │   ├── evaluate-stall.ts  diff-metrics.ts  transcript-*.ts
    │   └── lane-coordination.ts        # generalised: lanes come from the order
    ├── components/                     # FOUR SURFACES — replaces eleven
    │   ├── Inbox.tsx  Forge.tsx  Floor.tsx  Ledger.tsx
    │   └── foundry.css
    └── renderer/App.tsx

extensions/foundry/tests/               # mirrors src/, one spec per module

src/main/integrations/                  # CORE — the one generic addition
├── providers/provider.ts               # + optional states(), transition()
├── providers/linear.provider.ts        # implements both; states typed by `type`
└── issue-service.ts                     # + states(), transition(), supportsTransitions()
#   jira.provider.ts is UNCHANGED — the methods are optional and it omits them

src/main/extensions/api.ts              # + issues.states(), issues.transition()

docs/adr/040-*.md  041-*.md  042-*.md   # three ADRs
```

**Structure Decision**: `extensions/speckit-pilot` is renamed to `extensions/foundry` with `git mv` rather than a new extension being created beside it. The runtime substrate is roughly 70% of the extension's non-UI source and is kept verbatim; maintaining a second copy of it through a multi-stage migration would cost more than the rename does, and the old extension is being replaced rather than retained. A note on the patch-coverage gate: `scripts/check-patch-coverage.cjs` filters staged files with `--diff-filter=ACM`, and git reports a detected rename as `R`, so a file that moves _substantially unchanged_ is not re-gated. That relief is partial and must not be relied on — below git's rename-similarity threshold a move is scored as a delete plus an add, and `A` is in the filter. Files that move **and** change significantly will be gated at 80%, which is correct; the plan simply does not assume otherwise.

The core addition is confined to the tracker integration and the API surface. No `foundry:*` channel and no reference to the extension appears anywhere in `src/`.

## Complexity Tracking

| Violation                                                                                                                 | Why Needed                                                                                                                                                                                                                                                                                     | Simpler Alternative Rejected Because                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A change to core (`src/main/integrations/*`, `src/main/extensions/api.ts`) inside an extension feature                    | FR-059 and FR-060 require moving a tracker issue's workflow state. `ExtensionAPI.issues` exposes `comment` as its only write, by an explicit decision in feature 031. An extension cannot satisfy the requirement without core gaining the capability. Approved by the operator on 2026-09-06. | **Comment-only write-back** was rejected because the operator asked for all three write-backs, and a comment saying "this is now in review" is not the issue being in review — the board stays wrong, which is the cost the feature exists to remove. **The extension calling the tracker directly** was rejected outright: it would require the extension to hold a credential, which Principle II and the design of `ExtensionAPI.issues` both forbid. The chosen addition is generic — intent-based, provider-resolved, usable by any extension — so core learns a capability, not a consumer.                                                                           |
| Two new `TrackerProvider` methods that only one of the two providers implements                                           | The operator does not use Jira and does not want write-back built for it. Optional methods let Linear ship the capability while Jira honestly reports it as unsupported (FR-059a).                                                                                                             | **Implementing both** was rejected by the operator, and would mean writing and testing a Jira transition path nobody exercises — dead weight by Principle V. **A Linear-shaped `setState(stateId)` signature** was rejected because `ExtensionAPI` is a published interface: it would be unimplementable for Jira for good, and it would put the intent-to-state mapping in the wrong place, since FR-060 needs the operator to adjust that mapping. **Throwing `Error('not supported')` from a required method** was rejected as the worst of both — the interface would claim a capability every provider lacks half of, and the only way to discover it would be to try. |
| Two behaviours for when the draft pull request opens (before the gate for the top two risk grades, after it for the rest) | The operator chose this trade-off knowingly: review on a real diff for ordinary work, nothing on the remote before a decision for the risky work.                                                                                                                                              | **One rule either way** was rejected by the operator. Always-gate-first loses the whole benefit of draft-first shipping; always-push-first puts unreviewed authentication and migration changes on the remote. The cost — the operator cannot predict the behaviour from the rule alone — is mitigated by showing the risk grade on the order before work starts.                                                                                                                                                                                                                                                                                                           |
| Six step kinds in the recipe engine rather than a fixed step list                                                         | There are already six concrete recipes to express and they genuinely differ in shape: fan-out over units, a barrier for lane merge order, a human gate, an agent role, a shell command and a rubric judgement. Five of the six are used by more than one recipe.                               | **A fixed list of named steps** is what exists today and is the thing being removed. **Fewer kinds** was tested against the six recipes: dropping `join` makes lane merge order unexpressible, and dropping `judge` makes any non-command criterion unverifiable. Nothing beyond the six is added — there is no conditional kind, no loop kind and no sub-recipe kind, because no recipe needs one.                                                                                                                                                                                                                                                                         |
