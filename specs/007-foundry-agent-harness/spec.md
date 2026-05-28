# Feature Specification: Foundry — Agentic Harness Extension

**Feature Branch**: `007-foundry-agent-harness`
**Created**: 2026-05-28
**Status**: Ready for Planning
**Input**: User description: "A personalized agentic harness extension for Terminator that supports spec-to-code loops, multi-agent orchestration, and interactive co-pilot mode — provider-agnostic (Claude, OpenAI, Gemini, Ollama), with best-practice harness engineering baked in."

---

## Background & Design Philosophy

Foundry is built around the **harness engineering** mental model: an agent harness is everything except the model itself — guides, sensors, approval gates, and feedback loops that steer the model toward correct, maintainable output.

Three principles shape every design decision:

1. **Feedforward before feedback.** Prevent bad output before it happens (AGENTS.md, architecture rules, type constraints) rather than correcting it after. Feedback sensors (lint, tests, build) are secondary reinforcement, not the primary control.
2. **Human steering, not human babysitting.** The developer defines the harness once and steers it when patterns fail — they are not approving every line. Gates are configurable per run mode and per project.
3. **Provider portability.** The harness (guides, sensors, approval config) is entirely separate from the model provider. Switching from Claude to Gemini requires changing one setting, not rewriting the harness.

### Isolation Principle (Non-Negotiable)

Foundry MUST be a fully self-contained Terminator extension. The core application must have **zero knowledge** of Foundry ahead of time — it registers itself at load time using the public ExtensionAPI and communicates exclusively via approved IPC channels. No internal imports of core application modules. No modifications to core code. Foundry is drop-in portable: it can be removed from the extensions directory and the rest of Terminator is completely unaffected.

---

## Clarifications

### Session 2026-05-28

- Q: Should Foundry replace or complement SpecKit Pilot? → A: Complement. SpecKit Pilot is opinionated about the speckit CLI workflow. Foundry is the general-purpose harness for any agent task — it does not depend on SpecKit.
- Q: How does the extension invoke agent runs without being locked to Claude Code? → A: Via a configurable runner interface. Each provider adapter translates a standard RunRequest into the appropriate CLI invocation or API call. The core never knows which provider is active.
- Q: Should multi-agent orchestration be visual (graph) or list-based? → A: Graph for visibility, list for interaction. The orchestration view shows a DAG for topology comprehension but all actions (run, gate, abort) are accessible from a collapsible list without needing to interact with the graph.
- Q: How does the extension handle AGENTS.md? → A: It manages one AGENTS.md per workspace root. A dedicated editor in the harness config panel lets users author and version-control it. Foundry never auto-modifies AGENTS.md without explicit user action.
- Q: Where should feedback sensors be invoked — before a gate, after, or both? → A: Before a gate. The gate panel shows sensor results alongside the agent's output diff. The user sees build status, lint output, and test coverage delta before deciding to approve.
- Q: Should co-pilot mode have gates at all? → A: No hard gates. Co-pilot is a continuous back-and-forth; blocking it would defeat the purpose. It has soft guardrails only: the user sees a real-time diff panel of files the agent has modified and can abort at any moment.
- Q: How does the History global tab aggregate runs across projects? → A: "Global" refers to the tab's position in the UI only. Each workspace shows exclusively its own `.foundry/history.jsonl`. No cross-workspace aggregation.
- Q: How is the Orchestrate DAG edited — SVG interactive or list-only? → A: The SVG is fully interactive. Users drag nodes to reposition, click and drag between node ports to draw dependency edges, and double-click a node to rename it. The list panel reflects changes but editing happens on the graph.
- Q: Do provider adapters stream output or return on completion? → A: API-based providers (Claude, OpenAI, Gemini) stream tokens to the run console in real time. CLI/process-based providers (Ollama, custom) are spawned as child processes and Foundry tails stdout — the console shows live output either way. Co-pilot requires streaming-capable (API) providers only.
- Q: Is `.foundry/history.jsonl` bounded or unbounded? → A: Unbounded — the file grows indefinitely and is never pruned. The History UI shows the 200 most recent entries by default with pagination controls to access older records.
- Q: When a provider error pauses a run mid-iteration, does switching providers resume from the last gate or restart fresh? → A: Resume from the last approved gate checkpoint. All approved iterations are preserved; only the current in-progress iteration restarts using the new provider. The run ID and history record are unchanged.

---

## User Scenarios & Testing

### User Story 1 — Harness Setup: Configure Guides & Sensors (Priority: P1)

A developer opens Foundry for the first time in a repository. The extension detects whether an AGENTS.md exists and presents a five-step setup wizard: choose a template, edit AGENTS.md, configure feedback sensors with inline health-checks, select a provider, and confirm. The harness configuration is saved to `.foundry/harness.json` alongside the project's AGENTS.md. The sidebar panel shows "Harness ready — N sensors active" on completion.

**Why this priority**: Without a harness, Foundry is just a run launcher. The harness is the entire value proposition. This story must ship before any run feature.

**Independent Test**: Open a fresh repo in Terminator. Open the Foundry panel. Complete the setup wizard: choose the TypeScript/Node template, edit the AGENTS.md, configure `npm run lint` as a feedback sensor (verify inline ✓ health-check), and select Claude as the provider. Verify `.foundry/harness.json` and `AGENTS.md` are written to disk with correct content and the sidebar shows "Harness ready — 1 sensor active."

**Acceptance Scenarios**:

1. **Given** no `AGENTS.md` exists in the workspace root, **When** the user opens the Foundry panel, **Then** a first-run setup banner is shown with "Set up harness" as the primary action and no other Foundry functionality is accessible.
2. **Given** the user clicks "Set up harness", **When** the wizard opens, **Then** a five-step progress indicator is shown: template → agents.md → sensors → provider → done.
3. **Given** the wizard is on the template step, **When** the user selects a template, **Then** the AGENTS.md editor step shows the template content with inline comments explaining each section. Available templates: General, TypeScript/Node, Python, Blank.
4. **Given** the wizard is on the sensors step, **When** the user enters a lint command, **Then** the wizard runs the command once as a health-check and shows a pass ✓ or fail ✗ badge inline next to the input field before they proceed.
5. **Given** the wizard is complete and the user clicks "Done", **When** the setup commits, **Then** `AGENTS.md` is written to the workspace root and `.foundry/harness.json` is created with sensor commands and provider preference. The sidebar harness status bar shows "Harness ready — N sensors active."
6. **Given** an AGENTS.md already exists, **When** the user opens Foundry, **Then** the file is detected and the setup banner is replaced with the normal dashboard — no forced re-setup.
7. **Given** a sensor health-check fails during setup, **When** the user attempts to advance past the sensors step, **Then** a warning is shown ("1 sensor failing — check command") but the user can choose to proceed anyway.

---

### User Story 2 — Provider Configuration (Priority: P1)

The developer configures AI providers in Foundry's settings. They can add multiple providers with API keys and model selections. Each workspace can override the default provider. Foundry stores keys in the OS keychain and never writes them to any file on disk.

**Why this priority**: Providers must be configured before any run can happen. Pure prerequisite.

**Independent Test**: Open Foundry settings. Add a Claude provider with an API key and verify the key is NOT visible in `.foundry/harness.json`. Add an Ollama provider pointed at `http://localhost:11434`. Click "Test connection" for each — verify pass/fail result within 5 seconds. Switch the active workspace to use Ollama. Start a test run and verify the run log shows "Ollama" as the provider, not Claude.

**Acceptance Scenarios**:

1. **Given** no providers are configured, **When** the user opens Foundry settings, **Then** a "No providers configured" empty state is shown with an "Add provider" button.
2. **Given** the user clicks "Add provider", **When** the provider picker opens, **Then** they can choose from: Claude (Anthropic), OpenAI, Gemini (Google), Ollama (local), or Custom (manual endpoint + model).
3. **Given** a provider requiring an API key is selected, **When** the user enters the key and saves, **Then** the key is stored in the OS keychain — not in `.foundry/harness.json`. The settings UI shows only a masked reference (e.g., "key stored in keychain ✓").
4. **Given** multiple providers are configured, **When** the user opens workspace settings, **Then** they can override the default provider for that workspace only, and the override is stored in `.foundry/harness.json` as a provider-type reference with no secrets.
5. **Given** a provider is configured, **When** the user clicks "Test connection", **Then** a quick ping call is made and a latency + pass/fail indicator is shown within 5 seconds.
6. **Given** the Ollama provider is configured with a localhost endpoint, **When** Ollama is not running, **Then** the connection test fails with "Ollama not reachable at localhost:11434" and a link to Ollama's installation guide is shown.

---

### User Story 3 — Spec-to-Code Run (Priority: P1)

The developer selects or creates a spec file and launches a Spec-to-Code run. Foundry bundles the spec and AGENTS.md as feedforward context and dispatches the run to the configured provider. After the agent writes code, Foundry runs all configured feedback sensors automatically. A gate panel opens showing file diffs and sensor results side-by-side. The developer approves, requests changes with a note (prepended to the next prompt), or rejects and resets (git checkout of all changed files). The gate decision is logged to run history.

**Why this priority**: Spec-to-code is the primary workflow and highest-value interaction.

**Independent Test**: Create a simple `feature.md` spec. Launch a Spec-to-Code run against it. Verify the agent generates files, that all configured sensors run automatically after agent completion, that the gate panel shows the diff alongside sensor results, and that approving the gate writes a complete record to `.foundry/history.jsonl` with gate decision, token counts, and timestamps.

**Acceptance Scenarios**:

1. **Given** the user clicks "New run" and selects Spec-to-Code mode, **When** the run wizard opens, **Then** they can select a spec file path or type inline spec text, choose the provider/model, and see auto-detected context (AGENTS.md, harness.json) listed as feedforward items.
2. **Given** the workspace has a dirty git working tree, **When** the user attempts to start a Spec-to-Code run, **Then** a warning is shown and the run is blocked by default. A "Stash changes and run" override option is available.
3. **Given** the run launches, **When** it begins, **Then** Foundry creates a git checkpoint commit (auto-squashable, message: `foundry: checkpoint before run <run-id>`) and the run console shows "git checkpoint <hash>".
4. **Given** a run is in progress, **When** the agent writes any file to disk, **Then** the file is detected and added to the run console's "Changed files" list with a new (+) or modified (~) badge and line count delta.
5. **Given** the agent signals completion, **When** all configured sensors have run, **Then** the gate panel opens showing: (left) the run console with agent output, (right) a file list with diff viewer + sensor results footer with Approve / Request Changes / Reject buttons.
6. **Given** the gate panel is open, **When** the developer clicks "Request Changes", **Then** a text note input is required before the next iteration begins. The note is prepended to the agent's next prompt with a `[FEEDBACK]:` prefix.
7. **Given** the developer clicks "Reject & Reset", **When** confirmed, **Then** all files modified during the current iteration are reverted via `git checkout --` and a "rejected" history entry is written.
8. **Given** the run iteration count reaches the configured maximum (default 3), **When** the gate opens, **Then** a "Iteration limit reached" warning is shown. The user can approve (completing the run) but cannot start another iteration without explicitly overriding the limit.
9. **Given** a run is approved, **When** the run completes, **Then** a structured entry is appended to `.foundry/history.jsonl` with: run ID, mode, provider, model, spec/prompt, token counts, sensor results, gate decisions with notes and timestamps, files changed, and final status.

---

### User Story 4 — Multi-Agent Orchestration Run (Priority: P2)

The developer has a complex task to decompose across specialized agents. They describe the task, and Foundry asks the active provider to propose a DAG of 2–8 sub-agents with roles, inputs, outputs, and dependency edges. The developer edits the plan (add/remove nodes and edges), then launches. Foundry manages execution order, runs parallel-eligible agents concurrently, passes outputs as inputs, and opens a gate for each sub-agent's output. The orchestration view shows the DAG with live node status.

**Why this priority**: Multi-agent is the second primary workflow. Depends on the run engine from Story 3 being solid.

**Independent Test**: Enter task: "Build a REST API with tests and OpenAPI docs." Verify Foundry proposes at least three sub-agents (schema, implementation, test). Edit the plan to add a docs agent. Launch. Verify agents execute in dependency order, parallel-eligible agents run simultaneously (both show "running" in the DAG), outputs chain correctly, and each sub-agent gate can be individually approved or rejected without affecting already-approved nodes.

**Acceptance Scenarios**:

1. **Given** the user selects "Orchestrate" mode and enters a task description, **When** they click "Plan", **Then** the provider decomposes the task and renders a DAG with 2–8 sub-agent nodes showing role, inputs, outputs, and dependency edges.
2. **Given** the DAG is shown, **When** the user drags between node ports to add an edge or double-clicks a node to rename it, **Then** the DAG SVG updates live and Foundry validates for cycles — if a cycle is detected, the affected edge is highlighted red and launch is blocked until resolved.
3. **Given** the plan is confirmed, **When** execution begins, **Then** sub-agents at the DAG root run first. Sub-agents with unfulfilled upstream dependencies show "waiting on [X, Y]" and are blocked from running.
4. **Given** parallel sub-agents have no mutual dependency, **When** their upstream dependencies are satisfied, **Then** both agents run concurrently. The orchestration DAG shows both in "running" state simultaneously with live token/time counters.
5. **Given** a sub-agent completes, **When** its gate opens, **Then** the orchestration DAG highlights the node in amber, the sub-agent list entry is selected, and a gate panel identical to the Spec-to-Code gate appears for that sub-agent's output.
6. **Given** a sub-agent is rejected and "Reject & replan" is chosen, **When** the reset executes, **Then** only that sub-agent and its transitive downstream dependencies revert to "pending". Previously approved sub-agents above it retain their outputs unchanged.
7. **Given** the full orchestration is approved, **When** all sub-agents complete, **Then** a single merged history entry is written that links all sub-agent run records and aggregates token counts.

---

### User Story 5 — Co-pilot Mode (Priority: P2)

The developer activates Co-pilot mode. A split-panel view shows a conversation pane (left) and a live diff pane (right). The developer types instructions; the agent responds and modifies files. The diff panel shows all agent-modified files since the last "Accept all" or session start, with per-file revert buttons. No blocking gates — the developer can abort at any time to revert all unsaved agent changes.

**Why this priority**: Co-pilot serves shorter, iterative tasks where gates would break flow. Critical second mode that expands utility beyond spec-driven work.

**Independent Test**: Open Co-pilot. Type "Add error handling to the auth middleware." Verify the agent responds, modifies a file, and the diff panel updates live showing the change against the last committed version. Click "Revert" on one file and verify only that file is restored. Type a follow-up instruction and verify the agent receives the full conversation history as context.

**Acceptance Scenarios**:

1. **Given** Co-pilot mode is active, **When** the developer types an instruction and sends it, **Then** the message is dispatched to the configured provider with AGENTS.md as system context and full conversation history as prior context.
2. **Given** the agent modifies a file, **When** the write is detected, **Then** the diff panel adds the file with a live diff against the last committed version. The panel shows "+N added / -M removed" counts.
3. **Given** the diff panel shows a file, **When** the developer clicks "Revert" on that specific file, **Then** `git checkout -- <file>` is executed for that file only and it is removed from the diff panel. The conversation is not interrupted.
4. **Given** the developer clicks "Accept all", **When** confirmed, **Then** all agent-modified files are left in place, the diff panel clears, and the session state resets — the next agent instruction starts from the new working tree state.
5. **Given** the developer clicks "Abort", **When** confirmed, **Then** all files modified during the current conversation turn are reverted via `git checkout --` and the conversation records the abort event.
6. **Given** the diff panel shows files, **When** the developer types a follow-up instruction, **Then** the agent receives the full conversation history plus current file states as context — it is aware of what it has already changed.
7. **Given** co-pilot mode is active and the workspace has no git repository, **When** the developer attempts to use "Revert" or "Abort", **Then** those actions are disabled with a clear message: "Revert requires a git repository."

---

### User Story 6 — Run History & Audit (Priority: P3)

The developer views a full chronological history of all Foundry runs in the current workspace. Each record shows mode, provider, model, token counts, duration, gate decisions, sensor results, and final outcome. The developer can view gate timelines and compare two runs of the same spec side-by-side.

**Why this priority**: History is important for retrospective analysis but does not block primary workflows.

**Independent Test**: Complete three runs of different modes. Open the History global tab. Verify all three are listed with accurate metadata in reverse chronological order. Click into one run and verify gate decisions and sensor output are viewable. Filter by mode "spec-to-code" and verify only matching entries show.

**Acceptance Scenarios**:

1. **Given** any run completes, is rejected, or is aborted, **When** the event is recorded, **Then** a structured JSON entry is appended to `.foundry/history.jsonl` with: run ID, mode, provider, model, spec/prompt, token counts (input + output), sensor results, gate decisions with notes and timestamps, and final status.
2. **Given** the History global tab is open, **When** the developer views the list, **Then** entries are shown in reverse chronological order with columns: run/spec name, mode chip (spec→code / orchestrate / co-pilot), model, token count, duration, status badge. The list loads up to 200 entries.
3. **Given** a history entry is selected, **When** the detail panel opens, **Then** the developer sees: run metadata, a gate timeline with decisions/notes/timestamps, and sensor output per gate.
4. **Given** the history list is populated, **When** the developer applies a filter, **Then** they can filter by: run mode, status (done / rejected / aborted), provider, and a text search over the run/spec name.
5. **Given** the developer selects two runs of the same spec, **When** they click "Compare", **Then** a side-by-side diff shows how the outputs diverged between the two runs.
6. **Given** a run entry is selected, **When** the developer clicks "Re-run", **Then** the New Run wizard opens pre-filled with the same mode, spec, provider, and model from the history record.

---

### User Story 7 — Harness Health & Drift Detection (Priority: P3)

Foundry monitors the workspace for harness drift — conditions where the harness has become inconsistent with the codebase. It alerts when sensors are failing consistently, when agent runs are being rejected repeatedly (feedforward gap), or when AGENTS.md references files that no longer exist. The developer can take corrective action directly from the alert.

**Why this priority**: Harness health is the steering loop — without it, the harness degrades silently. Important for long-term value but not needed at initial launch.

**Independent Test**: Break a sensor command (reference a non-existent script). Open Foundry. Verify "Sensor failing" warning appears with the broken command and an "Edit sensor" quick action. Reject the same run gate three consecutive times. Verify "Feedforward gap detected" advisory appears with a link to the AGENTS.md editor.

**Acceptance Scenarios**:

1. **Given** a configured sensor fails with a non-zero exit on three consecutive runs, **When** Foundry detects the pattern, **Then** the harness status bar shows a "Sensor failing" warning with the failing sensor name, its last error output, and an "Edit sensor" quick action.
2. **Given** three consecutive runs on the same spec are rejected at the same gate, **When** Foundry detects the pattern, **Then** a "Feedforward gap detected" advisory is shown with a link to open the AGENTS.md editor to add a correction rule.
3. **Given** AGENTS.md references a file path that no longer exists on disk, **When** Foundry scans on workspace open, **Then** a "Stale reference" warning is shown with the specific line number in AGENTS.md and a "Remove reference" one-click fix.
4. **Given** a harness health alert is shown, **When** the developer takes the suggested corrective action, **Then** the alert resolves automatically and the harness status bar returns to "Harness ready — N sensors active."

---

### Edge Cases

- **No git repository**: Foundry requires git for diff tracking and file revert operations. If the workspace has no `.git`, a clear warning is shown and "Reject & Reset", per-file "Revert", and "Abort" operations that rely on git are disabled — the developer must revert manually.
- **Provider API key expires or hits rate limit**: The run pauses, the run console shows a "Provider error" state with the raw error message and a "Switch provider" action. Switching provider resumes from the last approved gate checkpoint — all approved iterations are preserved and only the current in-progress iteration restarts with the new provider. The run ID is unchanged.
- **Agent produces no file changes**: The gate still opens but shows an empty diff with a note "No files changed." The developer can approve (accepting no changes as the intended outcome) or request clarification via a change note.
- **Concurrent runs in the same workspace**: Foundry allows at most one Spec-to-Code or Orchestrate run per workspace at a time to prevent conflicting file writes. Co-pilot is exempt from this limit. Attempting to start a second blocked run shows "A run is already active in this workspace."
- **Workspace folder deleted mid-run**: The run is paused, a "Workspace unavailable" error is shown, and the in-progress diff is preserved in memory until the folder is restored or the run is explicitly aborted.
- **AGENTS.md exceeds 200 lines**: The AGENTS.md editor shows an advisory banner: "Consider splitting AGENTS.md into subdirectory-level files per the AGENTS.md specification," with a documentation link.
- **Sub-agent output exceeds the next agent's context window**: Foundry truncates the output to the configured max tokens, annotates the truncation in the run log as `[TRUNCATED: N tokens removed]`, and proceeds — it does not abort silently.
- **DAG cycle detected**: If the user creates a circular dependency in an Orchestrate plan, the offending edge is highlighted red and a clear error is shown: "Dependency cycle detected between [A] and [B]." Launch is blocked until the cycle is resolved.

---

## UI / Visual Design

Foundry MUST use the existing Terminator design language without modification. The screen renderings in `screens.html` define the exact visual target. Key constraints:

- **Color tokens**: Use the same CSS custom properties the core app defines (`--bg`, `--surface`, `--surface2`, `--surface3`, `--border`, `--border2`, `--accent`, `--green`, `--amber`, `--red`, `--teal`, `--blue`, `--text-primary`, `--text-secondary`, `--text-muted`, `--text-dim`, `--text-faint`). Do not introduce new colors.
- **Typography**: Use `var(--tm-font-mono)` and `var(--tm-font-ui)` — the same CSS custom properties the core app defines. Never hardcode a font-family stack. No new font faces.
- **Component atoms**: Reuse existing shared component patterns: the icon rail, sidebar panel, tabbar, status badges, run cards, diff viewer, buttons (standard / accent / green / amber / red variants), toggle switches, and input fields exactly as rendered in the screens.
- **Panel layout**: Foundry's sidebar panel follows the same right-panel layout pattern as other extensions: header bar → status bar → scrollable content list → action footer.
- **Status badges**: Use the app's existing badge system: `running` (accent), `gate` (amber), `done` (green), `aborted` (muted), `waiting` (faint border).
- **Icons**: Tabler Icons only. No other icon libraries. Flat, inheriting text color — no colored icons.
- **No core app modifications**: Foundry MUST NOT modify any stylesheet, component, or layout of the core application. All UI lives within Foundry's own extension panel and tab contributions.

The screens define **8 key views** that implementation must match:

| Screen | Description                                                                      |
| ------ | -------------------------------------------------------------------------------- |
| 1      | Foundry sidebar panel — active runs view with harness status bar                 |
| 2      | New run wizard — configure step (mode cards, provider pills, spec file input)    |
| 3      | Run console + gate review — agent output left, diff + sensor results right       |
| 4      | Multi-agent orchestration DAG — SVG graph left, sub-agent list right             |
| 5      | Co-pilot mode — conversation pane left, live diff pane right                     |
| 6      | Harness settings — sensors list with pass/fail badges, gate toggles              |
| 7      | Run history — filterable table left, gate timeline detail right                  |
| 8      | First-run harness setup wizard — AGENTS.md editor left, sensors + provider right |

---

## Requirements

### Functional Requirements

**Extension Isolation (Non-Negotiable)**

- **FR-001**: The extension MUST be entirely self-contained within its own directory and MUST NOT import any internal module from the core Terminator application. All communication with the core MUST go through the public ExtensionAPI and registered IPC channels.
- **FR-002**: The extension MUST register all its UI contributions (sidebar panel, global tab, project tab, command palette entries, keyboard shortcuts, top-bar button) via ExtensionAPI v1.2.0 at load time. No contribution may be hardcoded in the core application.
- **FR-003**: Removing the Foundry extension directory MUST leave the core Terminator application and all other extensions fully functional, with zero residual effects.
- **FR-004**: The extension MUST expose and consume only documented IPC channels. Any new IPC channel needed MUST be requested via the ExtensionAPI channel registration mechanism — never by reaching into core internals.

**Harness Management**

- **FR-005**: The extension MUST detect the presence or absence of `AGENTS.md` at the workspace root when the Foundry panel opens and show a first-run setup banner if absent.
- **FR-006**: The extension MUST provide an AGENTS.md editor with three starter templates (General, TypeScript/Node, Python) and a blank option.
- **FR-007**: Harness configuration — sensor commands, gate defaults, provider preference, iteration limits — MUST be stored in `.foundry/harness.json` at the workspace root. This file MUST NOT contain API keys or any secrets.
- **FR-008**: API keys and secrets MUST be stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) via Electron's `safeStorage` API. They MUST NOT appear in any file on disk or in any log.
- **FR-009**: The extension MUST provide a sensor health-check runner that executes each configured sensor command on demand and displays pass/fail with exit code and the last 20 lines of stderr.

**Provider Abstraction**

- **FR-010**: The extension MUST support at minimum four provider adapters at launch: Claude (Anthropic API), OpenAI (OpenAI API), Gemini (Google API), and Ollama (local HTTP).
- **FR-011**: Each workspace MUST be able to override the global default provider and model. The override is stored in `.foundry/harness.json` as a provider-type reference — never as a key.
- **FR-012**: The provider interface MUST be defined as a typed adapter contract so that adding a new provider requires only implementing the adapter — no changes to core run logic. The contract MUST support two execution modes: (a) streaming token output for API-based providers (Claude, OpenAI, Gemini), and (b) child-process stdout tailing for CLI/process-based providers (Ollama, custom). The run console displays live output in both cases.
- **FR-013**: The extension MUST expose a "Test connection" action per provider that makes a minimal ping call and reports latency and pass/fail within 5 seconds.

**Run Engine**

- **FR-014**: The extension MUST support three run modes: Spec-to-Code, Orchestrate, and Co-pilot.
- **FR-015**: Every run MUST be assigned a stable UUID. Its metadata MUST be written to `.foundry/history.jsonl` on completion or abort.
- **FR-016**: The extension MUST detect agent-written file changes using the filesystem watch capability exposed by the ExtensionAPI (`api.fs.watch` or equivalent) and accumulate them into a per-run diff set in real time.
- **FR-017**: In Spec-to-Code and Orchestrate modes, the extension MUST enforce a configurable gate after each run iteration before the next iteration or dependent sub-agent can begin.
- **FR-018**: All configured feedback sensors MUST run to completion before the gate panel opens. Sensor results MUST be displayed in the gate panel alongside the file diff.
- **FR-019**: The gate panel MUST offer three actions: Approve (advance or complete), Request Changes (mandatory note, prepended to next prompt with `[FEEDBACK]:` prefix), and Reject & Reset (reverts all changed files via git checkout).
- **FR-020**: The extension MUST enforce a configurable maximum iteration count per run (default: 3). Exceeding this count locks the gate — the developer must explicitly override to continue.
- **FR-021**: A run in progress MUST be abortable at any time. Aborting reverts all file changes made during the current un-gated iteration and writes an "aborted" history entry.

**Spec-to-Code Mode Specifics**

- **FR-022**: Spec-to-Code runs MUST accept a spec file path OR inline spec text as input.
- **FR-023**: The extension MUST create an auto-squashable git checkpoint commit before each Spec-to-Code run begins (commit message: `foundry: checkpoint before run <run-id>`).
- **FR-024**: The extension MUST refuse to start a Spec-to-Code run on a dirty git working tree by default. A "Stash changes and run" override option MUST be available.

**Orchestrate Mode Specifics**

- **FR-025**: Orchestrate mode MUST use the active provider to decompose a task description into a DAG of 2–8 sub-agents before the developer confirms the plan.
- **FR-026**: The DAG MUST be fully interactive: developers drag nodes to reposition them, draw dependency edges by clicking and dragging between node ports, and double-click a node to rename it. The list panel reflects all graph changes in real time but is not the editing surface.
- **FR-027**: The extension MUST validate the DAG for cycles before allowing launch and display a clear error identifying the cycle if one is detected.
- **FR-028**: Parallel-eligible sub-agents (no mutual dependency, all upstreams satisfied) MUST run concurrently, each in their own run context.
- **FR-029**: Rejecting a sub-agent MUST reset only that sub-agent and its transitive downstream dependencies — approved sub-agents above it retain their outputs and status.

**Co-pilot Mode Specifics**

- **FR-030**: Co-pilot mode MUST display a live diff panel beside the conversation pane showing all files modified by the agent since the last "Accept all" or session start.
- **FR-031**: The developer MUST be able to revert individual files from the diff panel without aborting the entire conversation.
- **FR-032**: Co-pilot mode MUST NOT have blocking gates. All interaction is non-blocking and advisory.
- **FR-033**: Co-pilot conversation history MUST be preserved for the duration of the Terminator session and cleared on project close or explicit "New conversation" action.

**Harness Health**

- **FR-034**: The extension MUST track sensor failure patterns across runs and surface a warning after three consecutive failures of the same sensor.
- **FR-035**: The extension MUST scan AGENTS.md for file path references on workspace open and warn on any reference that does not resolve to an existing path.
- **FR-036**: The extension MUST track gate rejection patterns across runs and surface a "feedforward gap" advisory after three consecutive rejections at the same gate for the same spec.

**History**

- **FR-037**: The History global tab MUST display runs from the current workspace's `.foundry/history.jsonl` in reverse chronological order, showing the 200 most recent entries by default with pagination controls to access older records. Filtering by mode, status, provider, and text search applies across all loaded entries. History is scoped to the active workspace — no cross-workspace aggregation. The `.foundry/history.jsonl` file is unbounded and never pruned automatically.
- **FR-038**: Each history record MUST store: run ID, mode, provider, model, spec/prompt, token counts (input + output separately), sensor results, gate decisions with notes and timestamps, files changed count, duration, and final status.
- **FR-039**: The extension MUST allow side-by-side comparison of any two run outputs for the same spec file.

**Extension API Contributions**

- **FR-040**: The extension MUST register a right-sidebar panel for harness status and active runs via `api.panels.registerPanel('right-sidebar', ...)`.
- **FR-041**: The extension MUST register a "History" global tab via `api.panels.registerGlobalTab(...)`.
- **FR-042**: The extension MUST contribute a "Start Foundry Run" item to the project top bar via `api.topBar.addItem(...)`.
- **FR-043**: The extension MUST register keyboard shortcuts: `⌘⇧A` to open the Foundry panel, `⌘⇧R` to start a new run in the current project, via `api.commands.register`.
- **FR-044**: The extension MUST register all Foundry actions in the command palette with a `foundry:` prefix namespace.

---

### Key Entities

- **Harness**: The full configuration bundle for a workspace. Attributes: `AGENTS.md` path (feedforward guides), sensor commands, gate defaults (require gate, require clean tree, auto-checkpoint), provider preference, iteration limit. Stored in `.foundry/harness.json` (no secrets).
- **Provider**: An AI backend adapter. Attributes: type (claude / openai / gemini / ollama / custom), model, endpoint, API key reference (keychain key name — never the key itself), status (connected / error). API key stored separately in OS keychain.
- **Run**: A single agent execution session. Attributes: UUID, mode (spec-to-code / orchestrate / co-pilot), provider, model, spec path or inline prompt, status (running / gate / paused-error / done / rejected / aborted), created timestamp, iterations, file change set, sensor results. A run in `paused-error` state retains all approved gate checkpoints and can be resumed with a different provider without losing progress.
- **Iteration**: One prompt-dispatch-through-sensor cycle within a run. Attributes: iteration number, prompt text (including any prepended feedback notes), list of file changes, sensor results, gate decision.
- **Gate**: A human checkpoint within a run. Attributes: gate ID, iteration number, file diffs, sensor results, decision (approve / request-changes / reject), note (for request-changes), actor, timestamp.
- **SubAgent**: One node in an Orchestrate run's DAG. Attributes: agent ID, role description, input source references, output artifact paths, upstream dependency agent IDs, status (pending / running / gate / done / rejected), run reference.
- **SensorResult**: Output from one feedback sensor execution. Attributes: sensor name, command string, exit code, stdout/stderr excerpt (last 20 lines), pass/fail, duration.
- **HistoryEntry**: One completed or aborted run record. Written to `.foundry/history.jsonl` as a single JSON line per run.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: A developer can configure a harness (AGENTS.md + 2 sensors + 1 provider), start a Spec-to-Code run, review the gate, and approve in under 5 minutes from a cold workspace.
- **SC-002**: No run iteration begins without an explicit user gate decision in Spec-to-Code and Orchestrate modes — verified by the history log showing no `iteration_start` event without a preceding `gate_approved` event.
- **SC-003**: Feedback sensors run and display results in the gate panel within 30 seconds of the agent signaling completion (for sensor commands that typically complete in under 10 seconds).
- **SC-004**: A developer can switch the active provider from Claude to Ollama and launch the same spec as a new run without modifying the spec, AGENTS.md, or harness.json.
- **SC-005**: Files changed by an aborted run are fully reverted via git within 2 seconds of the abort being confirmed.
- **SC-006**: An Orchestrate run with three sequential sub-agents completes end-to-end (all gates approved) without any manual prompt engineering beyond the initial task description.
- **SC-007**: The History tab loads and renders up to 200 run records without UI lag — target under 500ms render time from tab open.
- **SC-008**: Developers using Foundry's feedforward setup (AGENTS.md + sensors) see gate-approval rates improve by ≥30% compared to baseline runs with no harness, measured via `.foundry/history.jsonl` gate decision ratios over a 10-run sample.
- **SC-009**: The extension loads and registers all its UI contributions within 1 second of Terminator startup on standard developer hardware.
- **SC-010**: Removing the Foundry extension directory results in zero errors, warnings, or missing functionality in the core Terminator application or any other loaded extension.

---

## Assumptions

- The workspace is a git repository. Git is assumed available at the system level. Non-git workspaces are supported in a degraded mode: diff tracking and revert operations are disabled with clear user-facing warnings.
- The AGENTS.md format follows the open standard stewarded by the Agentic AI Foundation (Linux Foundation). Foundry does not define its own AGENTS.md format — it uses and manages the community standard file.
- Each provider's CLI or API is assumed to be installed and accessible by the user prior to configuring it. Foundry does not install providers; it provides configuration and connection-testing only.
- Co-pilot mode requires a streaming-capable API provider (Claude, OpenAI, or Gemini). CLI/process-based providers (Ollama, custom) are not supported in Co-pilot mode. Spec-to-Code and Orchestrate modes support all provider types.
- Run history is local only (`.foundry/history.jsonl`). Remote run history sync and team sharing are out of scope for v1.
- The extension manages at most one active Spec-to-Code or Orchestrate run per workspace at a time. Concurrent runs across different workspaces are fully supported.
- v1 ships all three run modes, harness setup, provider configuration, run history, and harness health monitoring as a single release. No phased delivery within v1.
- Foundry does not depend on SpecKit or any other Terminator extension. Foundry is a standalone harness for any agent workflow.
- Token cost tracking reports raw token counts from provider API responses. USD cost conversion is out of scope for v1.
- The extension targets ExtensionAPI v1.2.0. If any required capability is missing from the current ExtensionAPI, a minimal extension to the API surface (new IPC channel registration) is required before implementation can begin — this is a prerequisite dependency.
