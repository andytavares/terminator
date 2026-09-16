# Coverage baseline (T001)

Measured on `6f09e7e8` with `npx vitest run --coverage --coverage.reporter=json-summary`, exit 0. Line % from `coverage/coverage-summary.json`.

| File                                            | Lines %          |
| ----------------------------------------------- | ---------------- |
| `src/main/sessions/session-record-store.ts`     | 97.14            |
| `src/main/ipc/session-records.ipc.ts`           | 100              |
| `src/main/ipc/terminal.ipc.ts`                  | 100              |
| `src/renderer/sidebar/session-facts.ts`         | 100              |
| `src/renderer/terminal/start-session.ts`        | 100              |
| `src/renderer/stores/session-records.store.ts`  | 100              |
| `src/renderer/components/home/LedgerView.tsx`   | 100              |
| `src/renderer/components/home/LogbookView.tsx`  | 100              |
| `src/renderer/components/overview/WallTile.tsx` | 93.75            |
| `src/main/index.ts`                             | not instrumented |

No file is below 80%: no pre-existing debt to pay down.
