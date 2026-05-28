# Foundry Extension — Development Quickstart

**Branch**: `007-foundry-agent-harness`  
**Date**: 2026-05-28

---

## Prerequisites

- Node.js ≥ 20 (same as the core Terminator requirement)
- npm ≥ 10
- Git available on `$PATH`
- The core Terminator repo checked out and its root `npm install` completed
- At least one AI provider configured (Claude API key, or Ollama running locally)

---

## Setup

From the repo root:

```bash
# Install all workspace deps (hoists extension deps automatically)
npm install

# Verify the extension is recognised
ls extensions/foundry/
# Expected: manifest.json  package.json  src/  tests/  CLAUDE.md
```

---

## Running the Extension in Development

The extension is loaded by the core app at startup. No separate build step is required during development — the TypeScript source is compiled by the root build pipeline.

```bash
# Start Terminator with hot-reload (loads all extensions including foundry)
npm run dev
```

To verify Foundry loaded:

1. Open Terminator
2. Click the flame icon (⊙) in the sidebar rail
3. The Foundry panel should open — showing either the harness setup wizard (no AGENTS.md) or the active runs dashboard

---

## Building the Extension

```bash
# Build all extensions (compiles TypeScript → index.js)
npm run build:extensions

# Verify compiled output
ls extensions/foundry/src/index.js
```

The compiled `extensions/foundry/src/index.js` is gitignored. Never edit it directly.

---

## Running Tests

```bash
# Run all extension tests with coverage
npx vitest run --coverage --project=foundry

# Run only foundry unit tests (fast)
npx vitest run extensions/foundry/tests/unit

# Run only foundry integration tests
npx vitest run extensions/foundry/tests/integration

# Watch mode during development
npx vitest --project=foundry
```

Coverage gate: **80% minimum** on statements, branches, functions, lines.  
A threshold failure is a hard blocker — do not report done until it passes.

---

## First-Run Harness Setup (Manual Test)

1. Open a project workspace that has **no** `AGENTS.md` in its root
2. Click the Foundry rail icon → setup wizard should appear
3. Select "TypeScript / Node" template
4. Edit AGENTS.md content as desired
5. Add a sensor: name=`lint`, command=`npm run lint`
6. Click "run" next to lint — verify health check shows ✓ or ✗
7. Select "Claude" as provider
8. Click "Next" → "Done"
9. Verify `.foundry/harness.json` written (no API key visible)
10. Verify `AGENTS.md` written to workspace root
11. Harness status bar should show "Harness ready — 1 sensor active"

---

## Starting a Spec-to-Code Run (Manual Test)

1. Complete harness setup (above)
2. Configure a provider with a valid API key in Foundry settings
3. Click "New run" → Select "Spec-to-code"
4. Browse to a spec file (e.g., any `specs/*/spec.md`)
5. Confirm provider and model, click "Next" → "Launch"
6. Observe run console: git checkpoint commit logged, agent output streaming
7. When agent completes, sensors run automatically
8. Gate panel opens: review diff + sensor results
9. Click "Approve" — verify run marked "done" in sidebar
10. Check `.foundry/history.jsonl` — verify a new JSON line was appended

---

## Key Files

| File                                                        | Purpose                                            |
| ----------------------------------------------------------- | -------------------------------------------------- |
| `extensions/foundry/src/index.ts`                           | Main process entry — all IPC handler registrations |
| `extensions/foundry/src/renderer.tsx`                       | Renderer entry — panel/tab/topbar registrations    |
| `extensions/foundry/src/types/foundry.types.ts`             | All domain types                                   |
| `extensions/foundry/src/core/run-engine.ts`                 | Run lifecycle state machine                        |
| `extensions/foundry/src/core/dag.ts`                        | DAG cycle detection + topological sort             |
| `extensions/foundry/src/providers/adapter.ts`               | Provider adapter interface                         |
| `extensions/foundry/src/components/DagGraph.tsx`            | React Flow interactive DAG                         |
| `extensions/foundry/src/components/GatePanel.tsx`           | Gate review UI                                     |
| `extensions/foundry/src/state/foundry.store.ts`             | Zustand run/harness state                          |
| `specs/007-foundry-agent-harness/contracts/ipc-channels.md` | All IPC channel definitions                        |

---

## Adding a New Provider

1. Create `extensions/foundry/src/providers/<name>.ts`
2. Implement the `ProviderAdapter` interface from `adapter.ts`
3. Set `supportsStreaming: true` for API providers, `false` for CLI-process providers
4. Register the adapter in `index.ts` provider registry
5. Add the provider type to the `ProviderType` union in `foundry.types.ts`
6. Add a test file at `extensions/foundry/tests/unit/providers/<name>.spec.ts`
7. Add the provider pill to `NewRunWizard.tsx` and `HarnessSetupWizard.tsx`

---

## IPC Pattern (Renderer → Main)

All Foundry IPC calls from the renderer use the extension bridge:

```typescript
// In renderer component
const result = await window.electronAPI.extensionBridge.invoke('foundry:harness-read', {
  workspaceRoot: '/path/to/workspace',
})
if ('error' in result) {
  addToast({ type: 'error', message: result.error })
  return
}
// use result.harness
```

Never call `window.electronAPI.foundry.*` directly — Foundry does not modify the core preload.

---

## Listening for Push Events

```typescript
// Subscribe to run events from main process
const unsub = window.electronAPI.extensionBridge.on('foundry:run-event', (data) => {
  const { runId, event } = data as { runId: string; event: RunEvent }
  // update Zustand store
})

// Cleanup in useEffect return
return () => unsub()
```
