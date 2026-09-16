# Coverage baseline (T001)

Measured on `262c89a9` with `npx vitest run --coverage --coverage.reporter=json-summary`: 437 files, 8790 tests, exit 0. Figures are line % from `coverage/coverage-summary.json`.

| File                                                   | Lines %          |
| ------------------------------------------------------ | ---------------- |
| `src/renderer/stores/session.store.ts`                 | 98.85            |
| `src/renderer/components/terminal/TabBar.tsx`          | 96.49            |
| `src/renderer/components/terminal/TerminalSession.tsx` | 98.33            |
| `src/renderer/terminal/session-controller.ts`          | 100              |
| `src/renderer/sidebar/agent-state.ts`                  | 100              |
| `src/renderer/stores/integrations.store.ts`            | 92.72            |
| `src/renderer/extensions/registry.ts`                  | 100              |
| `src/renderer/components/sidebar/AppBand.tsx`          | 100              |
| `src/renderer/App.tsx`                                 | 100              |
| `src/main/ipc/terminal.ipc.ts`                         | 100              |
| `src/renderer/components/overview/OverviewScreen.tsx`  | 96.22            |
| `src/main/preload.ts`                                  | not instrumented |
| `src/main/index.ts`                                    | not instrumented |

No file is below 80%, so there is no pre-existing debt to pay down.
