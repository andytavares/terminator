# Implementation Plan: SpecKit Pilot Extension

**Branch**: `004-speckit-pilot-extension` | **Date**: 2026-05-10 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/004-speckit-pilot-extension/spec.md`

---

## Summary

A Terminator extension (ExtensionAPI v1.1.0) that wraps the full Spec-Kit lifecycle (Constitution → Specify → Clarify → Plan → Checklist → Tasks → Analyze → Implement) with explicit human-in-the-loop approval gates between every phase. The extension provides a sidebar lifecycle view, run triggering via terminal command injection, artifact editing with diff display, per-file Implement review, an audit history panel, and a settings page. Phase state is persisted to `.specify/.pilot/state.json`; all gate decisions are appended to `.specify/.pilot/history.jsonl`.

---

## Technical Context

**Language/Version**: TypeScript 5.x (same as rest of Terminator)
**Primary Dependencies**: React, Zustand, Zod (host-provided); `diff@5.2.0` (extension-only)
**Storage**: File-based — `.specify/.pilot/state.json` (phase state), `.specify/.pilot/history.jsonl` (audit log), artifact files under `specs/<feature>/`
**Testing**: Vitest (same as rest of Terminator)
**Target Platform**: Electron (Node.js main process + Chromium renderer)
**Project Type**: Terminator extension
**Performance Goals**: Phase state updates within 2s of artifact write; sidebar loads in <3s on startup
**Constraints**: ExtensionAPI v1.1.0 surface only — no imports from `src/main/`, `src/renderer/`, or `src/shared/`. Constitution Principle II is non-negotiable.
**Scale/Scope**: Single developer, one active feature at a time in v1

---

## Constitution Check

| Principle                  | Gate                                                                                 | Status            |
| -------------------------- | ------------------------------------------------------------------------------------ | ----------------- |
| I. Source Integrity        | All API decisions reference official ExtensionAPI docs                               | ✓ Pass            |
| II. Extension Isolation    | No imports from core source; all deps in extension package.json                      | ✓ Pass — enforced |
| IV. Dependency Stewardship | `diff` only new dep; multi-maintainer, MIT, pinned version                           | ✓ Pass            |
| V. Minimalism              | No speculative features; full PRD scope is the explicit requirement                  | ✓ Pass            |
| VI. TDD                    | State machine transitions and IPC handlers are fully testable with Vitest            | ✓ Required        |
| VII. SOLID & YAGNI         | State machine separated from IPC from UI; no abstractions beyond current need        | ✓ Pass            |
| VIII. Documentation        | IPC channels doc, extension-api-delta.md, ARCHITECTURE.md, README.md update required | ✓ Required        |
| X. Code Cleanliness        | `npm run lint` must pass; compiled index.js must be gitignored                       | ✓ Required        |

---

## Project Structure

### Documentation (this feature)

```text
specs/004-speckit-pilot-extension/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   ├── ipc-channels-speckit.md    ← Phase 1 output
│   └── extension-api-delta.md     ← Phase 1 output
├── checklists/
│   └── requirements.md
└── tasks.md             ← Phase 2 output (/speckit-tasks)
```

### Source Code (extension directory)

```text
extensions/speckit-pilot/
├── manifest.json
├── package.json                      # diff@5.2.0 only
└── src/
    ├── index.ts                      # activate() / deactivate() — registers everything
    ├── renderer.tsx                  # React root for sidebar panel
    │
    ├── types/
    │   └── speckit.types.ts          # PhaseId, PhaseStatus, PhaseState, PilotState,
    │                                 #   HistoryEntry, RunRecord, PendingFileWrite, Feature
    │
    ├── schemas/
    │   └── speckit.schemas.ts        # Zod schemas for all IPC payloads and state.json
    │
    ├── state/
    │   ├── phase-state-machine.ts    # Pure functions: transition(), isUpstreamApproved(),
    │   │                             #   computeStalePhases(), applyHashVerification()
    │   ├── state-persistence.ts      # readState(), writeState(), appendHistory()
    │   └── artifact-hash.ts          # computeHash(filePath): Promise<string>
    │
    ├── ipc/
    │   └── speckit.ipc.ts            # All speckit:* IPC handlers (registerAll)
    │
    ├── stores/
    │   └── speckit.store.ts          # Zustand store — PilotState + RunRecord + Feature list
    │
    └── components/
        ├── LifecycleSidebar.tsx      # Top-level panel: feature picker + phase list
        ├── PhaseRow.tsx              # Single phase row with status glyph + CTA
        ├── PhaseDetail.tsx           # Detail panel for selected phase
        ├── ApprovalPanel.tsx         # Approve / Reject / Revoke gate
        ├── RunPromptDialog.tsx       # Prompt input + model selector + run CTA
        ├── RunConsole.tsx            # "Command injected — watching for artifacts" status
        ├── ArtifactDiff.tsx          # Diff view (approved vs current, using diff package)
        ├── ArtifactEditor.tsx        # Raw markdown editor with save / discard
        ├── ClarifyQA.tsx             # Q&A list for Clarify phase
        ├── AnalyzeFindings.tsx       # Findings table (HIGH/MED/LOW) for Analyze phase
        ├── ImplementDashboard.tsx    # Task list + progress bar for Implement phase
        ├── ImplementFileGate.tsx     # Per-file diff + approve/skip/stop
        ├── HistoryPanel.tsx          # Filterable audit timeline
        ├── SettingsPage.tsx          # All settings sections
        └── StatusBar.tsx             # Status bar item: active feature + phase glyph
```

### Docs to Update

```text
docs/ARCHITECTURE.md                  # SpecKit Pilot extension section
docs/EXTENSION-DEVELOPMENT.md         # No changes needed (uses existing API)
specs/001-extension-first-terminal/contracts/ipc-channels.md
                                      # Reference to speckit: namespace
README.md                             # Add SpecKit Pilot to features list
```

---

## Architecture Decisions

### AD-1: Extension-only — no core changes

The extension uses ExtensionAPI v1.1.0 surface exclusively. This was explicitly validated in `contracts/extension-api-delta.md`. No changes to `src/main/extensions/api.ts` are needed.

### AD-2: Terminal injection from renderer via window.electronAPI

Spec-Kit command injection uses `window.electronAPI.terminal.input({ sessionId, data })` from the extension's React renderer context. This is the published preload API, not an internal import. The extension's main-process side tracks session IDs via `api.terminal.onSessionCreate` and exposes them to the renderer via `speckit:session-list`.

### AD-3: Post-write per-file gate for Implement

The per-file Implement gate is a post-write review-and-revert model. File changes are detected via `api.fs.watch`. Rejected files are reverted via `api.shell.exec({ command: 'git', args: ['checkout', '--', filePath] })`. A pre-run checkpoint commit ensures full rollback is always available.

### AD-4: Phase state machine as pure functions

All phase transition logic lives in `state/phase-state-machine.ts` as pure functions with no I/O. This makes the state machine fully unit-testable without mocking. IPC handlers in `ipc/speckit.ipc.ts` call these functions and then perform I/O (read/write state.json, append history.jsonl).

### AD-5: `diff` package for artifact diff display

Monaco editor (from Terminator core) is not available to extensions without violating Principle II. The `diff` npm package (MIT, 5.2.0, pinned) computes line-level unified diffs. The extension renders them as styled `<pre>` blocks using `+`/`-` line coloring.

---

## Complexity Tracking

| Deviation                                                                                    | Why Needed                                                                                                                           | PRD Expectation                                   | Simpler Alternative Chosen Because                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No real-time PTY output streaming in sidebar (FR-004)                                        | PTY output belongs to PtyManager internals; intercepting it requires importing from `src/main/` — violates Constitution Principle II | PRD shows a live run console with streamed output | File-system watcher detects artifact completion. User watches live output in the Terminator terminal tab. Net result is equivalent: phase transitions automatically when done. |
| Per-file Implement gate is post-write review-and-revert, not pre-write interception (FR-011) | Pre-write interception requires a Claude Code hook or named-pipe callback — out of scope and couples to Claude Code internals        | PRD says "pause before each proposed file write"  | Post-write gate with `git checkout --` revert and pre-run checkpoint commit provides equivalent safety guarantee. SC-004 updated to reflect this model.                        |

---

## Phase Ordering and Upstream Dependencies

```
constitution   (no upstream)
    └── specify
            └── clarify
                    └── plan
                            ├── checklist
                            └── tasks
                                    └── analyze
                                            └── implement
```

Each phase's `isUpstreamApproved()` check traverses this DAG. `checklist` is optional (gate config `required: false`, `autoApprove: true` by default).

---

## IPC Handler Map

| Channel                           | Handler                                                 | Side Effects                        |
| --------------------------------- | ------------------------------------------------------- | ----------------------------------- |
| `speckit:initialize`              | Load state.json, verify hashes, return PilotState       | Writes state.json if hashes diverge |
| `speckit:feature-list`            | Scan specs/ for spec.md                                 | None                                |
| `speckit:feature-create`          | mkdir + optionally shell create-new-feature.sh          | Disk write + git branch             |
| `speckit:session-list`            | Return tracked sessions from in-memory registry         | None                                |
| `speckit:phase-approve`           | Compute artifact hash, write state.json, append history | Disk write ×2                       |
| `speckit:phase-reject`            | Delete artifacts, reset phase, append history           | Disk delete + write                 |
| `speckit:phase-revoke`            | Remove approval, mark downstream stale, append history  | Disk write ×2                       |
| `speckit:artifact-read`           | Read file + git show for approved version               | None (read-only)                    |
| `speckit:artifact-save`           | Write file, update phase to modified/approved           | Disk write                          |
| `speckit:history-load`            | Read + parse history.jsonl                              | None (read-only)                    |
| `speckit:implement-file-decision` | git checkout (skip) or no-op (approve), append history  | Disk write                          |
| `speckit:implement-stop`          | Clear active run from registry                          | None                                |
| `speckit:checkpoint-create`       | git add -A && git commit --allow-empty                  | git commit                          |

---

## File Watcher Logic

On every `api.fs.watch` event:

1. Compute SHA-256 of changed file.
2. Find all phases whose `artifactPaths` include this file.
3. For each matched phase:
   - If `status === 'running'` → transition to `awaiting_review`, set `approvedHash` to new hash, emit `speckit:state-changed`.
   - If `status === 'approved'` and hash ≠ `approvedHash` → transition to `modified`, emit `speckit:state-changed`.
   - If a run is active for Implement and the file is under the repo root → emit `speckit:implement-file-proposal`.

---

## Settings Registration

Settings key prefix: `terminator.speckit-pilot.*`

Keys registered via `api.settings.register`:

- `terminator.speckit-pilot.enabled` (boolean)
- `terminator.speckit-pilot.defaultModel` (string)
- `terminator.speckit-pilot.openSidebarOnStart` (boolean)
- `terminator.speckit-pilot.requireCleanTree` (boolean)
- `terminator.speckit-pilot.createCheckpoint` (boolean)
- `terminator.speckit-pilot.maxFilesPerRun` (number)
- `terminator.speckit-pilot.commandTimeoutMs` (number)
- `terminator.speckit-pilot.autoApprove.clarify` (boolean)
- `terminator.speckit-pilot.autoApprove.checklist` (boolean)

---

## Keyboard Shortcuts

| Shortcut            | Action                |
| ------------------- | --------------------- |
| `CmdOrCtrl+Shift+A` | Approve current phase |
| `CmdOrCtrl+Shift+R` | Reject current phase  |
| `CmdOrCtrl+Shift+S` | Stop current run      |

Registered via `api.keyboard.register`. Checked against reserved shortcuts before registration.

---

## Test Strategy

All tests use Vitest. No mocking of the file system or IPC — tests use in-memory state objects.

| Area                      | Test Type                  | Key Scenarios                                                                                |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| `phase-state-machine.ts`  | Unit                       | All 12 valid transitions; invalid transitions throw; `computeStalePhases` DAG traversal      |
| `state-persistence.ts`    | Unit (with tmp dir)        | readState round-trip; appendHistory idempotency; corrupt file recovery                       |
| `artifact-hash.ts`        | Unit                       | Known content → known SHA-256                                                                |
| `speckit.ipc.ts` handlers | Unit                       | approve → state update + history entry; reject → artifact deleted; revoke → downstream stale |
| `speckit.schemas.ts`      | Unit                       | Valid and invalid payloads for each channel                                                  |
| `ArtifactDiff.tsx`        | Component (Vitest + jsdom) | Diff renders added/removed lines correctly                                                   |
| `LifecycleSidebar.tsx`    | Component                  | Phase glyphs match PhaseStatus; locked phases show lock icon                                 |
| `ApprovalPanel.tsx`       | Component                  | Approve button calls onApprove; note field required for reject                               |
