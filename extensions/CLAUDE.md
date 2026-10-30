# Extensions — the rules every extension follows

## Extension Isolation (MANDATORY)

Each extension is **fully isolated**. The core application knows nothing about an extension until you install it. A violation breaks the architecture (Constitution II, ADR 094).

### What every extension MAY do

- Import `@terminator/extension-sdk`, `@terminator/extension-ui` and its own dependencies. Import nothing from the core's `src/` and nothing from another extension (`npm run lint` rejects any other import).
- Call core IPC through `window.electronAPI.{terminal,workspace,project,git,shell,fs,settings,...}` for **core-owned channels only**.
- Call its own IPC through `window.electronAPI.extensionBridge.invoke('<extension>:...')`.
- Register its IPC handlers in `src/index.ts` with `api.ipc.registerHandler()`.

Each extension's own `CLAUDE.md` adds its specific rules.

## Typecheck

`tsconfig.json` checks `src/`. `tsconfig.test.json` extends it and checks `tests/`, with Vitest's globals and Node 24's library. `npm run typecheck` runs both for every extension (`scripts/typecheck.mjs`). Vitest strips types, so a spec that no longer matches the types it builds still runs green. Only the second check catches it. Fake part of an object in a spec with `partialFake` (`tests/support/fakes.ts`), never `as unknown as`.
