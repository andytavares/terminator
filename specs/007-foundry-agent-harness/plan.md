# Implementation Plan: Foundry — Agentic Harness Extension

**Branch**: `007-foundry-agent-harness` | **Date**: 2026-05-28 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/007-foundry-agent-harness/spec.md`

---

## Summary

Foundry is a fully isolated Terminator extension that wraps any AI provider in a structured **agent harness**: AGENTS.md feedforward guides + configurable feedback sensors + human-in-the-loop approval gates. It provides three run modes (Spec-to-Code, Orchestrate, Co-pilot), stores API keys in the OS keychain, tracks run history in a per-workspace JSONL file, and monitors harness drift. It communicates with the core application exclusively via ExtensionAPI v1.2.0 and registered IPC channels — zero core modifications.

---

## Technical Context

**Language/Version**: TypeScript 5.x (main process + renderer, same as all existing extensions)  
**Primary Dependencies**: React 18.x, Zustand 4.x, `@xyflow/react` 12.x (DAG), `diff` 5.x, `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, Zod 3.x  
**Storage**: `.foundry/harness.json` (workspace config), `.foundry/history.jsonl` (run audit log), OS keychain via `electron.safeStorage` (API keys)  
**Testing**: Vitest + jsdom (unit), Electron mocks (IPC integration) — 80% coverage gate enforced  
**Target Platform**: Electron desktop (macOS / Windows / Linux), same targets as core app  
**Project Type**: Terminator extension (isolated, ExtensionAPI v1.2.0)  
**Performance Goals**: Extension load < 1s (SC-009), history render < 500ms for 200 entries (SC-007), sensor display < 30s after agent completion (SC-003), abort revert < 2s (SC-005)  
**Constraints**: No core app imports, no root package.json deps, all secrets via `safeStorage`, single concurrent Spec-to-Code/Orchestrate run per workspace, Co-pilot restricted to API streaming providers  
**Scale/Scope**: 3 run modes, 4+ provider adapters, 44 functional requirements, 8 UI views, ~40 source files

---

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                        | Status     | Notes                                                                                                                                         |
| -------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Source Integrity              | ✅ PASS    | All provider SDK choices reference official docs (see research.md)                                                                            |
| II. Extension Isolation          | ✅ PASS    | All communication via ExtensionAPI v1.2.0 + IPC. Zero core imports. Deletion test: removing `extensions/foundry/` leaves core intact.         |
| IV. Dependency Stewardship       | ✅ PASS    | React Flow (MIT, 25k+ stars, multiple maintainers), Anthropic/OpenAI/Google SDKs (vendor-official), Zod (MIT, 30k+ stars). All pinned.        |
| V. Code Readability & Minimalism | ✅ PASS    | Provider adapters use a typed contract pattern (not inheritance hierarchy). DAG logic isolated in `dag.ts`.                                   |
| VI. TDD                          | ✅ PASS    | Every production file has a companion spec file in the plan. Red→Green→Refactor enforced.                                                     |
| VII. SOLID & YAGNI               | ⚠️ TRACKED | Interactive SVG DAG (React Flow) is complex, but is required by the spec (clarification Q2 answer: A). Recorded in Complexity Tracking below. |
| VIII. Documentation              | ✅ PASS    | IPC channels in `contracts/ipc-channels.md`. Extension API surface in `contracts/extension-api.md`. README updated in tasks.                  |
| IX. ADRs                         | ✅ PASS    | Three ADRs required: DAG library choice, provider adapter pattern, keychain storage strategy (see research.md).                               |
| X. Code Cleanliness              | ✅ PASS    | Lint passes enforced in task done criteria. No compiled JS committed.                                                                         |
| XI. Functional Purity            | ✅ PASS    | Core domain logic (dag.ts, run-engine.ts, sensors.ts) is pure. Side effects (IPC, fs, child_process) isolated to adapter/IPC layers.          |

---

## Project Structure

### Documentation (this feature)

```text
specs/007-foundry-agent-harness/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   ├── ipc-channels.md       ← all foundry:* IPC channels
│   └── extension-api.md      ← ExtensionAPI contributions registered
├── checklists/
│   └── requirements.md
└── tasks.md             ← Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
extensions/foundry/
├── manifest.json                  # Extension metadata
├── package.json                   # Extension-scoped deps (react-flow, SDKs, etc.)
├── CLAUDE.md                      # Extension dev rules (isolation, IPC patterns)
├── src/
│   ├── index.ts                   # Main process: activate/deactivate, IPC registration
│   ├── renderer.tsx               # Renderer entry: registers panels/tabs/topbar
│   ├── types/
│   │   ├── foundry.types.ts       # Domain types: Run, Gate, Provider, Harness, etc.
│   │   └── ipc.types.ts           # Typed IPC payload/response shapes
│   ├── core/
│   │   ├── harness.ts             # Read/write .foundry/harness.json
│   │   ├── history.ts             # Append/read/paginate .foundry/history.jsonl
│   │   ├── git.ts                 # Checkpoint commit, dirty-tree check, git checkout
│   │   ├── sensors.ts             # Spawn sensor commands, capture exit + last-20-lines
│   │   ├── run-engine.ts          # Run state machine: create→iterate→gate→complete/abort
│   │   ├── dag.ts                 # Cycle detection, topological sort, parallel tier compute
│   │   └── keychain.ts            # safeStorage encrypt/decrypt; keychain key naming
│   ├── providers/
│   │   ├── adapter.ts             # ProviderAdapter interface + RunRequest/RunEvent types
│   │   ├── claude.ts              # Anthropic SDK streaming adapter
│   │   ├── openai.ts              # OpenAI SDK streaming adapter
│   │   ├── gemini.ts              # Google Generative AI streaming adapter
│   │   └── ollama.ts              # Ollama local HTTP + stdout-tail process adapter
│   ├── components/
│   │   ├── FoundryPanel.tsx       # Root right-sidebar panel (harness bar + run list)
│   │   ├── HarnessSetupWizard.tsx # First-run 5-step wizard
│   │   ├── NewRunWizard.tsx       # New run 3-step wizard (mode → configure → launch)
│   │   ├── RunConsole.tsx         # Live agent output console
│   │   ├── GatePanel.tsx          # Gate review: file list + diff viewer + sensor footer
│   │   ├── DiffViewer.tsx         # Reusable unified diff renderer
│   │   ├── OrchestrationView.tsx  # Orchestrate mode container (DAG + list)
│   │   ├── DagGraph.tsx           # React Flow interactive DAG editor
│   │   ├── CopilotView.tsx        # Co-pilot conversation + live diff panel
│   │   ├── HistoryView.tsx        # Global history tab (table + detail)
│   │   ├── HarnessSettings.tsx    # Settings view (sensors, gates, providers)
│   │   └── foundry.css            # Extension-scoped styles (CSS tokens from core)
│   └── state/
│       ├── foundry.store.ts       # Zustand: runs, harness state, active workspace
│       └── copilot.store.ts       # Zustand: co-pilot conversation + diff accumulator
├── tests/
│   ├── unit/
│   │   ├── core/
│   │   │   ├── harness.spec.ts
│   │   │   ├── history.spec.ts
│   │   │   ├── git.spec.ts
│   │   │   ├── sensors.spec.ts
│   │   │   ├── run-engine.spec.ts
│   │   │   ├── dag.spec.ts
│   │   │   └── copilot-ipc.spec.ts
│   │   ├── providers/
│   │   │   ├── adapter.spec.ts
│   │   │   ├── claude.spec.ts
│   │   │   ├── openai.spec.ts
│   │   │   ├── gemini.spec.ts
│   │   │   └── ollama.spec.ts
│   │   ├── state/
│   │   │   ├── foundry.store.spec.ts
│   │   │   ├── copilot.store.spec.ts
│   │   │   └── health.spec.ts
│   │   └── components/
│   │       ├── HarnessSetupWizard.spec.tsx
│   │       ├── NewRunWizard.spec.tsx
│   │       ├── DiffViewer.spec.tsx
│   │       ├── GatePanel.spec.tsx
│   │       ├── DagGraph.spec.tsx
│   │       ├── OrchestrationView.spec.tsx
│   │       ├── CopilotView.spec.tsx
│   │       └── HistoryView.spec.tsx
│   └── integration/
│       └── run-lifecycle.spec.ts
└── coverage/
```

**Structure Decision**: Isolated extension under `extensions/foundry/`. Follows the same directory contract as `speckit-pilot` and `task-vault`. Main process logic lives in `src/index.ts` + `src/core/` + `src/providers/`. React UI lives in `src/components/`. All state in `src/state/` (Zustand). Tests mirror `src/` structure under `tests/unit/`.

---

## Complexity Tracking

| Deviation                     | Why Needed                                                                                               | Simpler Alternative Rejected Because                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| React Flow interactive DAG    | Spec clarification Q2 answer A: "SVG is fully interactive — drag nodes, draw edges." FR-026 is explicit. | List-only editing is simpler but the spec unambiguously requires SVG interaction. Recorded per Constitution VII.                     |
| 4 provider adapters at launch | FR-010 requires Claude, OpenAI, Gemini, Ollama at launch.                                                | Single adapter would not meet provider portability goal (SC-004). Four adapters is the stated minimum, not a future-proofing choice. |
| OS keychain via safeStorage   | FR-008: API keys MUST be in OS keychain, never on disk.                                                  | File-based encryption simpler but explicitly rejected in spec — security requirement is non-negotiable.                              |
