# ADR 093: Stay on Electron and TypeScript

**Status**: Accepted
**Date**: 2026-10-12

## Decision

Terminator stays on Electron, React and TypeScript. The measured costs are fixed in that stack: the embedded database is replaced (ADR 099), the window is created before anything else starts, extension backends leave the main process (ADR 094), and the terminal output path is batched. A native daemon in Rust that owns the terminals is considered again only if measurements taken after that work still show a need.

## Context

The 2026-10-11 architecture audit asked whether to port the app to Rust or Go for performance. The costs it measured are not language costs:

| Measured                        | Cause                                                                       |
| ------------------------------- | --------------------------------------------------------------------------- |
| Main process 288 MB, bare 42 MB | About 250 MB is PGlite, a Postgres compiled to WASM, used by two extensions |
| 1.2 s before the window exists  | Database boot and five extensions activated in series before the window     |
| Up to 195 IPC calls a minute    | Foundry's views poll because nothing pushes                                 |

Rewriting any of these in Rust reproduces them in Rust. A port also cannot remove JavaScript: every extension backend and view needs it, so a Rust core would run Node beside it and need the same process contract that ADR 094 builds inside Electron.

## Alternatives considered

| Alternative     | Why rejected                                                                                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tauri 2         | Several web views in one window are still behind the `unstable` flag ([docs](https://v2.tauri.app/reference/javascript/api/namespacewebview/)); no first-party macOS e2e driver ([docs](https://v2.tauri.app/develop/tests/webdriver/)); Node must ship anyway |
| Wails 3         | Still beta ([releases](https://github.com/wailsapp/wails/releases)); no multiple web views in one window                                                                                                                                                       |
| Native Rust UI  | Rewrites about 100,000 lines and replaces xterm.js, CodeMirror, Excalidraw and mermaid; the phone client stays web, so two UIs forever                                                                                                                         |
| Go for a daemon | No maintained, tagged terminal core outside cgo bindings                                                                                                                                                                                                       |

## Consequences

- The work is ordered by measured effect, not rewritten. Each change records a before and after with the scripts that will live in `scripts/perf/`.
- Electron is upgraded to 44 first. Electron supports only the latest three stable majors ([policy](https://github.com/electron/electron/blob/main/docs/tutorial/electron-timelines.md#version-support-policy)); 42 leaves support when 45 ships, scheduled for 2026-10-20, and 43 leaves when 46 ships.
