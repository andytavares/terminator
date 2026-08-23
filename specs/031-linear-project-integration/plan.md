# Implementation Plan: Tracker issues attached to projects

**Branch**: `031-linear-project-integration` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/031-linear-project-integration/spec.md`

## Summary

Attach one tracker issue to a project, read it in the app with its markdown rendered, and have
every agent session started in that project already know it — all behind a single core-owned
issue-tracker service that replaces the two clients and two credentials currently living inside
`extensions/speckit-pilot`.

The technical approach, established in [research.md](./research.md):

- **One core module** `src/main/integrations/`, provider-shaped, with Linear (`@linear/sdk` 91.0.0)
  and Jira (REST v3) behind one facade that owns caching, single-flight, and the error taxonomy.
- **Credentials** encrypted with `safeStorage` in core, migrated once from the extension's file.
- **One issue shape, markdown always** — Jira's ADF is converted to markdown inside its provider,
  so there is exactly one renderer and one sanitisation story.
- **Rendering** with `react-markdown` + `remark-gfm`, `skipHtml`, no `rehype-raw`, image `src`
  dropped, links opened externally. Issue text renders but never acts.
- **Agent context** through a `SessionStart` hook merged into the project's
  `.claude/settings.local.json`, so a `claude` the operator starts by hand gets it too.
- **Extensions** consume `api.issues` (Extension API v2.2.0) and stop holding credentials.

## Technical Context

**Language/Version**: TypeScript 5.x, ES modules, Node 22 (Electron 42.4.1 runtime)

**Primary Dependencies**: Electron 42.4.1 · React 18.3.1 · Zod 3.23.8 · electron-store ^8.2.0 ·
**new**: `@linear/sdk` 91.0.0, `react-markdown` 10.1.0, `remark-gfm` 4.0.1 (all pinned exactly,
per Constitution IV; Jira uses `fetch` — no client library)

**Storage**: `safeStorage`-encrypted JSON under `userData` for credentials · plain JSON under
`userData` for links and per-project agent context · no database (`ExtensionDB` is for
extensions, and this is core)

**Testing**: Vitest with v8 coverage (≥80% gate) · jsdom + `electronAPI` mock for renderer
components · recorded response fixtures at the network boundary · Playwright e2e only where an
app-boot path is genuinely at stake. **Tests live under `tests/unit/**`, not beside their
source** — `vitest.config.ts`collects only from`tests/unit`, `tests/integration`,
`extensions/\*/tests`, and three pre-existing `**tests**` directories; a spec placed anywhere else
silently never runs.

**Target Platform**: macOS desktop (Electron), plus the authenticated `/app/` remote renderer

**Project Type**: Desktop application — Electron main + preload + React renderer, with a
first-party extension host

**Performance Goals**: A sidebar badge must never cost a network request — served from a TTL
cache (5 minutes, a constant — not a setting). Five surfaces asking for one issue at once produce one request (SC-008).
The link picker opens on already-fetched "my issues"; search is caller-debounced.

**Constraints**: Agent context is capped at **10,000 characters** by the runtime's documented
hook-output limit — enforced visibly by us rather than silently by it. Credentials never leave
the main process. Anything written into a project directory must be removable without trace.
Core must not name or reach into any extension (Constitution II).

**Scale/Scope**: 2 trackers · exactly 1 issue per project · 10 new main-process modules, 4 new
renderer components, 1 new settings section, 11 IPC channels and 3 events, 1 extension-API
namespace, 2 extension migrations.

## Constitution Check

_GATE: evaluated before Phase 0 and re-evaluated after Phase 1 design._

| Principle                       | Assessment                                                                                                                                                                                                                                                                                                                                                                                                           | Verdict  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **I. Source Integrity**         | Every external behaviour is cited to vendor docs in research.md — Linear SDK, Jira REST v3 (including the documented deprecation of `/search`), Claude Code hooks, react-markdown security. Five items that could **not** be confirmed from docs are labelled UNVERIFIED with a verification task each, rather than assumed.                                                                                         | **PASS** |
| **II. Extension Isolation**     | Direction of dependency is corrected, not added to: core gains the service; extensions consume `api.issues`. Core names no extension. The credential migration reads a file path, not extension code. Deleting `extensions/` leaves core building and running.                                                                                                                                                       | **PASS** |
| **IV. Dependency Stewardship**  | 3 new deps, all pinned exactly. `@linear/sdk` — vendor-published. `react-markdown`/`remark-gfm` — remark/unified, 3 maintainers each, already proven in this codebase. **`adf-to-md` rejected outright as single-maintainer**; `@atlaskit/editor-markdown-transformer` rejected on weight; `dompurify` avoided by choosing a renderer that never produces raw HTML. Jira needs no client library — `fetch` suffices. | **PASS** |
| **V. Readability & Minimalism** | The provider seam exists because there are genuinely two trackers, not one plus a hypothesis. The ADF mapper covers exactly the node set FR-014 names and no more.                                                                                                                                                                                                                                                   | **PASS** |
| **VI. TDD (non-negotiable)**    | Red → Green → Refactor throughout. Pure functions (ADF mapper, context builder, settings merge, key/branch derivation) are unit-tested directly; providers against fixtures; IPC extends the existing `<name>.ipc.spec.ts` pattern under `tests/unit/ipc/`. Every new file ships at ≥80%. **Pre-existing file coverage is checked before editing**, since the patch gate measures whole files.                       | **PASS** |
| **VII. SOLID & YAGNI**          | No third provider. No issue creation, editing, or state changes. No multi-issue links. `api.issues` exposes what the spec's requirements need and nothing else.                                                                                                                                                                                                                                                      | **PASS** |
| **VIII. Documentation**         | ADR + `ARCHITECTURE.md` + `EXTENSION-DEVELOPMENT.md` (v2.2.0) + user guide ship in the same PRs, phase by phase — not batched at the end.                                                                                                                                                                                                                                                                            | **PASS** |
| **IX. ADRs**                    | Two decisions warrant records, written when taken: **ADR-029** one core issue-tracker service (why core, not an extension; why one shape for two trackers; ADF→markdown and the alternatives rejected). **ADR-030** SessionStart injection (why `settings.local.json` over `--settings`; the accepted cost of writing into a repo; the verified hook contract).                                                      | **PASS** |
| **X. Code Cleanliness**         | The migration is a **deletion**, not a duplication: the extension's tracker clients, credential halves, settings UI, `@linear/sdk` entry and the dead `transitionStatus()` all go. The `.catch(() => {})` around the PR-open comment is removed. `npm run build:extensions` after every extension source change.                                                                                                     | **PASS** |
| **XI. Purity & Immutability**   | ADF mapping, context building, truncation, settings-block merge/unmerge and branch derivation are pure functions over data. I/O (network, keychain, filesystem) is confined to the provider and store layers.                                                                                                                                                                                                        | **PASS** |
| **XII. UI Icons**               | Every new icon is `lucide-react`, flat, `currentColor`, sized by CSS. The mockups' state indicator is a shape-and-text badge, not colour alone — which also satisfies WCAG 1.4.1.                                                                                                                                                                                                                                    | **PASS** |
| **Workflow**                    | Feature branch `031-linear-project-integration`, ratified spec, phase-per-PR.                                                                                                                                                                                                                                                                                                                                        | **PASS** |

**Gate result: PASS.** No violations to justify; the Complexity Tracking table below is empty by
design.

**Re-evaluated after Phase 1 design**: still PASS. The design added no dependency, no
abstraction, and no surface beyond what the requirements name. The one judgement call worth
naming — writing an in-house ADF→markdown mapper rather than taking a dependency — is a direct
consequence of Constitution IV forbidding the single-maintainer package that would otherwise fit,
and is bounded by FR-014's explicit node list.

## Project Structure

### Documentation (this feature)

```text
specs/031-linear-project-integration/
├── plan.md                        # This file
├── spec.md                        # Ratified specification
├── research.md                    # Phase 0 — decisions, alternatives, unverified facts
├── data-model.md                  # Phase 1 — entities, errors, lifecycles
├── quickstart.md                  # Phase 1 — S1–S6 manual validation
├── contracts/
│   ├── ipc-channels.md            #   integrations:* over the channel manifest
│   ├── extension-api.md           #   api.issues, Extension API v2.2.0, migrations
│   ├── agent-context.md           #   SessionStart hook, owned settings block, budget
│   └── tracker-provider.md        #   the two-implementation seam
├── checklists/
│   └── requirements.md            # Spec quality — 16/16
└── tasks.md                       # Phase 2 — /speckit-tasks, NOT created here
```

### Source code (repository root)

```text
src/
├── main/
│   ├── integrations/                     # NEW — the whole service
│   │   ├── tracker-store.ts              #   safeStorage creds + config + migration
│   │   ├── tracker-error.ts              #   the error taxonomy
│   │   ├── issue-service.ts              #   facade: TTL cache, single-flight, errors
│   │   ├── issue-link-store.ts           #   projectId → link; GC on project delete
│   │   ├── agent-context.ts              #   context markdown + budget + file
│   │   ├── session-hook.ts               #   hook source, install, settings merge/unmerge
│   │   ├── adf-to-markdown.ts            #   pure ADF → markdown mapper
│   │   └── providers/
│   │       ├── provider.ts               #   the TrackerProvider interface
│   │       ├── linear.provider.ts
│   │       └── jira.provider.ts
│   ├── ipc/
│   │   └── integrations.ipc.ts           # NEW — invoke table for integrations:*
│   ├── extensions/api.ts                 # EDIT — api.issues; createProject.issue (v2.2.0)
│   ├── terminal/pty-manager.ts           # EDIT — per-session env additions
│   └── index.ts                          # EDIT — register handlers, install hook script
├── shared/
│   ├── types/index.ts                    # EDIT — Issue, IssueLink, TrackerConnection, …
│   ├── schemas/integrations.schema.ts    # NEW — Zod for every payload
│   ├── integrations/branch-from-issue.ts # NEW — pure name/branch derivation
│   └── electron-api/manifest.ts          # EDIT — 11 channels + 3 events, remote behaviour
└── renderer/
    ├── components/
    │   ├── integrations/                 # NEW
    │   │   ├── IssueBadge.tsx            #   sidebar badge + state indicator
    │   │   ├── LinkIssueDialog.tsx       #   picker: mine + search, both trackers
    │   │   ├── IssueDrawer.tsx           #   detail + context preview + actions
    │   │   └── IssueMarkdown.tsx         #   the one safe renderer
    │   ├── settings/IntegrationsSettings.tsx  # NEW — the Integrations section
    │   ├── settings/SettingsPanel.tsx    # EDIT — nav entry
    │   └── sidebar/
    │       ├── SessionGroup.tsx          # EDIT — render the badge
    │       ├── ScopeMenu.tsx             # EDIT — link/open/copy/unlink
    │       └── CreateProjectDialog.tsx   # EDIT — "From issue" mode
    └── stores/integrations.store.ts      # NEW — connections, links, cached issues

extensions/
├── speckit-pilot/                        # DELETIONS — api/linear.ts, api/jira.ts,
│                                         #   credential halves, settings UI, @linear/sdk,
│                                         #   transitionStatus(); ticket-list → api.issues
└── git-integration/                      # EDIT — enrich scraped PR refs via api.issues.get()

docs/
├── adr/029-core-issue-tracker-service.md # NEW
├── adr/030-session-start-issue-context.md# NEW
├── ARCHITECTURE.md                       # EDIT
├── EXTENSION-DEVELOPMENT.md              # EDIT — api.issues (v2.2.0)
└── user-guide/USER-GUIDE.md              # EDIT
```

**Structure Decision**: The existing `src/main` (services + `ipc/` handlers) ⇄ `src/shared`
(types, schemas, channel manifest) ⇄ `src/renderer` (components + stores) layering is followed
exactly. The service is one new directory under `src/main` because it is a main-process
capability with a network boundary and a credential; the renderer only ever sees it through the
channel manifest, which is also what makes it reachable from the remote surface for free.
`src/main/integrations/providers/` is the only nesting introduced, and only because there are two
concrete providers.

## Delivery phases

One PR each. Every PR carries its own tests and its own documentation (Constitution VIII);
none is "docs to follow".

| #      | Scope                                                                                                                                                   | Requirements                         | Done when                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **P0** | Credential store + migration; both providers; ADF→markdown mapper; facade with cache and single-flight; IPC table and manifest entries. No UI. ADR-029. | FR-001→006a, 027, 028, 031, 032, 035 | Channels answer for both trackers; a bad credential is rejected before storage; the extension's credentials are adopted |
| **P1** | Link store + GC; sidebar badge; context menu; link dialog.                                                                                              | FR-007→010, 033                      | A project shows its key; the link survives restart; relinking warns and replaces; removing the project cleans up        |
| **P2** | Issue drawer; the safe markdown renderer; comment action.                                                                                               | FR-013→018, 034, 034a                | Both trackers' issues render identically; S4's security case passes; a failed comment reaches the operator              |
| **P3** | Agent context: builder, budget, hook script, settings merge/unmerge, per-project toggle, notification, session env. ADR-030.                            | FR-019→026                           | a hand-started `claude` receives the context, and unlinking leaves the directory untouched                              |
| **P4** | `api.issues` (v2.2.0); `createProject.issue`; "From issue" project creation; speckit-pilot migration; git-integration enrichment.                       | FR-011, 012, 029, 030                | No tracker credential or client remains in any extension; board behaviour unchanged                                     |
| **P5** | Reconcile the per-phase doc additions into one narrative; final full-suite run including e2e.                                                           | Constitution VIII, IX                | Docs read as one document, not six PRs                                                                                  |

P0–P3 deliver what the operator asked for. P4 is the unification.

**Documentation is not a phase.** ADR-029 and `ARCHITECTURE.md` ship in P0, ADR-030 and the
agent-context user guide in P3, the extension API reference in P4, and each story's user-guide
slice with that story — because Constitution IX forbids retroactive ADRs and Constitution VIII
requires docs in the implementing PR. P5 only reconciles what six PRs wrote into the same files.

**Every phase is a PR, so every phase runs the gate itself**: `npm run format` → `npm run lint`
(0 errors) → `npx vitest run --coverage` (≥80%). A gate at the end only would mean P0–P4 ship
ungated.

**Phase mapping to `tasks.md`**: P0 → Phase 2 · P1 → Phases 3–4 · P2 → Phase 6 · P3 → Phase 5 ·
P4 → Phases 7–8 · P5 → Phase 9. The two documents number differently because one is delivery
and the other is execution order; this is the mapping between them.

## Risks

| Risk                                                                               | Mitigation                                                                                                                                                                        |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core writes into the operator's repository directory                               | Merge-only inside an owned block; `settings.local.json` only; complete removal on unlink, proven by test; loud failure when unwritable                                            |
| `@linear/sdk` 27 → 91 is 64 majors                                                 | P0 is a fresh integration behind a facade; only two extension call sites move, in P4, against a stable interface                                                                  |
| Jira's `/search` is being removed                                                  | Already handled — P0 targets `/search/jql` from the start. Left alone, the current extension breaks on Atlassian's timetable, not ours                                            |
| ADF node outside the mapped set                                                    | Degrades to text content — visible, bounded, and stated in ADR-029                                                                                                                |
| Untrusted issue content in the renderer                                            | `skipHtml`, no `rehype-raw`, image `src` dropped, external links only — with S4 step 5 as an explicit release-blocking test                                                       |
| Patch-coverage gate on pre-existing sub-80% files                                  | Check each file's baseline before editing it; `SettingsPanel.tsx`, `SessionGroup.tsx`, `ScopeMenu.tsx`, `CreateProjectDialog.tsx` and `pty-manager.ts` are all pre-existing edits |
| Extension API version series is inconsistent (docs v2.x, code annotations v1.x)    | Follow the documented series (v2.2.0), note the discrepancy in the PR, and do not silently reconcile it inside this feature                                                       |
| Turning the PR-open comment off by default changes behaviour operators may rely on | Stated plainly in the release notes and the user guide, not slipped in                                                                                                            |

## Deviations from this plan, as built

Recorded rather than silently absorbed (Constitution VII / workflow rules). None required a
Complexity Tracking entry — no constitution violation, no added abstraction.

| Deviation                                                                         | Why                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/integrations/index.ts` added — a composition root not in the tree above | Something has to assemble providers + store + facade into the one service both the IPC layer and `api.issues` share. Tested; 100% covered.                                         |
| `src/main/integrations/context-sync.ts` added                                     | Three things must move together on a link change — the link, the context file, the hook registration. Splitting that across the store and the IPC layer would have let them drift. |
| `branch-from-issue.ts` lives in `src/shared/`, not `src/main/`                    | Only the renderer needs it. A pure string function does not warrant an IPC round trip to reach the process that has no use for it.                                                 |
| `src/renderer/components/integrations/IssuePicker.tsx` added                      | The new-project dialog cannot open a second modal over itself to pick one row; the link dialog's list needed an embeddable sibling.                                                |
| T022 built the real channels rather than a skeleton returning `not-connected`     | A skeleton is placeholder code Constitution X forbids leaving around, and it would have been rewritten three times across three phases.                                            |
| `integrations:set-inject-context` channel added (12th, not 11)                    | The per-project injection toggle (FR-021) needs a way in; the contract named the state but no channel to change it.                                                                |
| `integrations:issue-updated` event removed from the contract                      | Nothing in this design polls, so it had no producer. An event nothing emits is a promise nothing keeps.                                                                            |
| `link-get`'s error field renamed `issueError`                                     | With both branches carrying `error`, no caller could narrow the envelope — a readable link looked like a failed channel.                                                           |
| Zod email validation relaxed to `min(1)`                                          | The credential is proved against the tracker before storage, so verification is the real gate; a regex only adds false rejections (short TLDs, plus-addressing, IDN).              |
| `settings.linear` / `settings.jira` deleted from SpecKit Pilot                    | Nothing read them once the credentials moved. Dead config is dead code (Constitution X).                                                                                           |
| Jira URLs added to the PR-body scraper                                            | It found Linear links and GitHub numbers but not Jira ones, so half the trackers this feature supports were invisible in a review.                                                 |

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified.

No violations. The Constitution Check passed before Phase 0 and again after Phase 1 design, so
this table is intentionally empty.
