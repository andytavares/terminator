# Extensions — the rules every extension follows

## Extension Isolation (MANDATORY)

Each extension here is **fully isolated**. The core application knows nothing about an extension until it is installed. Violations break the architecture (Constitution II, ADR 094).

### What every extension MAY do

- Import `@terminator/extension-sdk`, `@terminator/extension-ui` and its own dependencies — nothing from the core's `src/` and nothing from another extension (`npm run lint` rejects any other import)
- Call core IPC via `window.electronAPI.{terminal,workspace,project,git,shell,fs,settings,...}` for **core-owned channels only**
- Call its own IPC via `window.electronAPI.extensionBridge.invoke('<extension>:...')`
- Register its IPC handlers in `src/index.ts` via `api.ipc.registerHandler()`

Each extension's own `CLAUDE.md` adds what is specific to it.
