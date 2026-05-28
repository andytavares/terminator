# Research: Foundry — Agentic Harness Extension

**Date**: 2026-05-28  
**Branch**: `007-foundry-agent-harness`

---

## Decision 1: Interactive DAG Library

**Decision**: `@xyflow/react` (React Flow) v12.x

**Rationale**: React Flow is the dominant React library for interactive node-edge graphs. It provides drag-to-reposition nodes, edge drawing via connection handles, and a full React component model — exactly matching the spec's requirement (clarification Q2: "users drag nodes to reposition, click and drag between node ports to draw dependency edges"). It is MIT-licensed, has multiple active maintainers (xyflow team), 25k+ GitHub stars, and 600k+ weekly npm downloads. The library handles SVG rendering, hit-testing, and zoom/pan internally, eliminating the need to build those primitives. It ships with TypeScript types included.

**Alternatives considered**:

- `vis-network`: Older graph library, primarily imperative API. Lacks native React integration and is maintained by a smaller team. Rejected per Constitution IV (prefer well-known, battle-tested alternative).
- `cytoscape.js` + React wrapper: Cytoscape is powerful for analysis but its React integration is via a thin third-party wrapper (`react-cytoscapejs`), adding a dependency with a single maintainer. Rejected per Constitution IV.
- `dagre` (layout only): Not an interactive library — pure layout engine. Could be used with custom SVG but would require building interaction primitives from scratch. Rejected: scope exceeds YAGNI when React Flow covers the requirement.
- Custom SVG with `d3`: Maximum flexibility, zero dependencies, but would require implementing node dragging, edge drawing, hit-testing, and zoom from scratch. Rejected: far exceeds the YAGNI constraint for this feature.

**Source**: [React Flow docs](https://reactflow.dev/), [xyflow GitHub](https://github.com/xyflow/xyflow) (MIT, xyflow GmbH team, 25k+ stars)

---

## Decision 2: Provider Adapter Pattern

**Decision**: Typed `ProviderAdapter` interface with two execution modes: streaming (API) and process-tail (CLI)

**Rationale**: The spec (clarification Q3) established that API providers stream tokens while CLI/process providers tail stdout. The adapter interface must abstract both. The clean pattern is a discriminated union on execution mode:

```typescript
type ProviderAdapter =
  | StreamingAdapter // Claude, OpenAI, Gemini — yields token events
  | ProcessAdapter // Ollama, custom — spawns child process, yields stdout chunks
```

Both adapter types implement a common `run(request: RunRequest): AsyncIterable<RunEvent>` signature, allowing the run engine to consume output uniformly without knowing the provider type. This is the Interface Segregation Principle from SOLID applied correctly.

**Alternatives considered**:

- Single unified streaming interface that CLI adapters must fake by buffering and emitting all at once: Simplifies run-engine but degrades UX for CLI providers (no live output). Rejected.
- Inheritance hierarchy (BaseAdapter → StreamingAdapter → ClaudeAdapter): Inheritance in TypeScript is discouraged when composition works. The `run()` method signature covers the contract fully. Rejected.
- Plugin registry with dynamic loading: Over-engineered for 4 known adapters. Rejected per YAGNI.

**Source**: [Anthropic SDK streaming](https://docs.anthropic.com/en/api/streaming), [OpenAI SDK streaming](https://platform.openai.com/docs/api-reference/streaming), [Gemini SDK streaming](https://ai.google.dev/gemini-api/docs/text-generation?lang=node#generate-a-text-stream), [Ollama local API](https://github.com/ollama/ollama/blob/main/docs/api.md)

---

## Decision 3: Secrets / Keychain Storage

**Decision**: `electron.safeStorage` with encrypted values stored in a separate `.foundry/keychain.enc` file

**Rationale**: Electron's `safeStorage` API encrypts arbitrary strings using the OS credential store (macOS Keychain, Windows DPAPI, Linux Secret Service / kwallet). The `safeStorage.encryptString(plaintext)` call returns a `Buffer` of encrypted bytes; `safeStorage.decryptString(buffer)` reverses it. The encrypted buffer is stored as a base64 string in `.foundry/keychain.enc` (JSON map of keyId → base64) alongside `harness.json`. The plaintext never touches disk. The `harness.json` stores only the key ID reference (e.g., `foundry.provider.claude.apikey`).

This approach is preferred over `electron-store` with `encryptionKey` because `electron-store`'s encryption key must itself be stored somewhere, creating a bootstrap problem. `safeStorage` delegates that problem to the OS.

**Alternatives considered**:

- `electron-store` with encryption: Requires a static encryption key, which either goes on disk (defeats purpose) or must be hardcoded in source (security anti-pattern). Rejected.
- System keychain via `keytar` npm package: `keytar` provides a clean keychain API but is a native module requiring compilation, adds a `node-gyp` dependency, and has had maintenance gaps. `safeStorage` is built into Electron and requires no additional native compilation. Rejected per Constitution IV (prefer stdlib-equivalent when available).
- Store keys in user's OS keychain via Electron shell: There is no cross-platform Electron API for directly reading/writing named keychain entries other than `safeStorage`. Rejected: no viable alternative.

**Source**: [Electron safeStorage docs](https://www.electronjs.org/docs/latest/api/safe-storage), [Electron safeStorage availability](https://www.electronjs.org/docs/latest/api/safe-storage#safestorageisencryptionavailable)

---

## Decision 4: Diff Computation

**Decision**: `diff` v5.x (already a dependency of `speckit-pilot`)

**Rationale**: The `diff` package is already present in the workspace (`extensions/speckit-pilot/package.json`). npm workspaces hoist it. It provides `createPatch()` for generating unified diffs between two strings — exactly what the gate panel needs to display file diffs against the git-committed baseline. No new dependency.

**Alternatives considered**:

- `jsdiff`: Alias for the same package. Same thing.
- `fast-diff`: Faster for pure text edit distance but does not produce unified patch format. Rejected: we need the `@@ -X,Y +A,B @@` hunk format for the diff viewer UI.
- Custom diff: Rejected (YAGNI, stdlib does not cover this).

**Source**: [diff npm](https://www.npmjs.com/package/diff) (MIT, multiple maintainers, 60M+ weekly downloads)

---

## Decision 5: Sensor & Git Process Execution

**Decision**: Node.js built-in `node:child_process` (`spawn` for streaming, `execFile` for one-shot)

**Rationale**: Sensor commands and git operations are shell commands with bounded output. `child_process.spawn()` with piped stdio handles streaming (for provider CLI mode, sensor health-checks). `child_process.execFile()` with a timeout handles one-shot operations (git checkpoint commit, git checkout revert). Both are Node.js stdlib — no additional dependency required (Constitution IV: use stdlib when it fully satisfies the requirement).

**Key patterns**:

- Sensors: `spawn(cmd, args, { cwd: workspaceRoot })` — capture stdout/stderr, wait for exit, return `SensorResult`
- Git checkpoint: `execFile('git', ['commit', '--allow-empty', '-m', msg], { cwd })`
- Git revert: `execFile('git', ['checkout', '--', ...files], { cwd })`
- Dirty-tree check: `execFile('git', ['status', '--porcelain'], { cwd })` — non-empty = dirty

**Alternatives considered**:

- `execa`: Ergonomic wrapper around `child_process` with async/await. Well-maintained, MIT. However, `node:child_process` with `util.promisify` covers all cases without adding a dependency. Rejected per Constitution IV (stdlib covers the need).
- `simple-git`: Higher-level git abstraction. Adds a dependency for operations we can do with 3 `execFile` calls. Rejected per YAGNI.

**Source**: [Node.js child_process docs](https://nodejs.org/api/child_process.html)

---

## Decision 6: React State Management

**Decision**: Zustand 4.x (already used by `task-vault`)

**Rationale**: Zustand is already hoisted into the workspace via `task-vault`'s `package.json`. It is the lightest-weight React state manager with a clean TypeScript API and supports the slice pattern needed for Foundry's two stores (foundry.store for run state, copilot.store for conversation state). Multiple maintainers, MIT, 45k+ stars.

**Alternatives considered**:

- React Context + useReducer: For cross-component state of this complexity (run list, active gate, diff accumulator), Context would require many nested providers or a single fat context. Zustand is cleaner. Rejected.
- Jotai: Similar to Zustand but atom-based. Zustand is already in the workspace. Rejected: prefer consistency.
- Redux: Way over-engineered for an extension. Rejected.

**Source**: [Zustand GitHub](https://github.com/pmndrs/zustand) (MIT, pmndrs team, 45k+ stars, 4M+ weekly downloads)

---

## Decision 7: Provider SDK Versions

**Decision**: Pin to current stable at implementation time; use exact versions

| Provider | Package                 | Version (pin at impl)   |
| -------- | ----------------------- | ----------------------- |
| Claude   | `@anthropic-ai/sdk`     | latest stable (≥0.38.0) |
| OpenAI   | `openai`                | latest stable (≥4.0.0)  |
| Gemini   | `@google/generative-ai` | latest stable (≥0.24.0) |
| Ollama   | Stdlib fetch + spawn    | N/A (no package)        |

Ollama uses the local HTTP API (`POST /api/generate` with `"stream": true`) via `fetch()` + `ReadableStream` — no SDK required. This is the official Ollama API.

**Source**: [Anthropic SDK npm](https://www.npmjs.com/package/@anthropic-ai/sdk), [OpenAI npm](https://www.npmjs.com/package/openai), [Google AI npm](https://www.npmjs.com/package/@google/generative-ai), [Ollama API reference](https://github.com/ollama/ollama/blob/main/docs/api.md)

---

## ADR-001: React Flow for Interactive DAG

**Decision**: Use `@xyflow/react` (React Flow) for the Orchestrate DAG editor.  
**Motivation**: Spec explicitly requires fully interactive SVG DAG (clarification Q2). React Flow is the dominant React graph library and provides all required interaction primitives out of the box.  
**Alternatives**: vis-network, cytoscape.js, custom SVG — all rejected (see Decision 1 above).  
**Tradeoffs**: React Flow adds ~180kb gzipped to the renderer bundle for this extension. Acceptable given the feature requirement; this bundle is extension-local and does not affect core app load.

---

## ADR-002: Provider Adapter Contract

**Decision**: `run(request: RunRequest): AsyncIterable<RunEvent>` as the unified adapter interface, implemented by both streaming (API) and process-tail (CLI) adapters.  
**Motivation**: Two fundamentally different execution modes (SSE streaming vs stdout piping) must be hidden behind a uniform interface so the run engine is provider-agnostic.  
**Alternatives**: Single streaming interface with CLI buffering — rejected (breaks live output for CLI providers).  
**Tradeoffs**: Each adapter must implement the AsyncIterable protocol. Minor implementation overhead per adapter, but clean separation.

---

## ADR-003: safeStorage for Secret Storage

**Decision**: Use Electron's built-in `safeStorage` API to encrypt API keys. Store encrypted blobs (base64) in `.foundry/keychain.enc`. Store only key-ID references in `harness.json`.  
**Motivation**: FR-008 is non-negotiable: keys must never appear on disk in plaintext. `safeStorage` delegates encryption to the OS credential store.  
**Alternatives**: `keytar` (native module, maintenance gap), `electron-store` with key (bootstrap problem) — both rejected.  
**Tradeoffs**: `safeStorage` encryption is not available in all Electron environments (e.g., headless CI). The extension must handle `safeStorage.isEncryptionAvailable() === false` gracefully by refusing to store keys and warning the user.
