# ExtensionAPI Delta: SpecKit Pilot Extension

> **Superseded. Kept as history.** This contract records what was decided when the feature was
> specified, and is not edited. The code no longer has `sidebar.registerPanel`, `topBar.registerMenuItem`, `fs.watch` and `keyboard.register`. Do not build against it. The
> current contract lives in:
>
> - `packages/extension-sdk/types/api.d.ts`: the `ExtensionAPI`, which the core implements in `src/main/extensions/api.ts`
> - [ADR 094](../../../docs/adr/094-extensions-follow-the-vs-code-model.md)

**Feature**: `004-speckit-pilot-extension` | **Date**: 2026-05-10

This document records that the SpecKit Pilot extension uses **no new ExtensionAPI surface**. All interactions use ExtensionAPI v1.1.0 as published.

## API Surface Used

| API                                               | Usage                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `api.sidebar.registerPanel('right-sidebar', ...)` | Main lifecycle sidebar panel                                                      |
| `api.settings.register(...)`                      | SpecKit Pilot settings section                                                    |
| `api.settings.get(...)`                           | Read gate configuration and preferences                                           |
| `api.fs.watch(handler)`                           | Detect artifact file changes for phase transitions                                |
| `api.shell.exec({ command: 'git', ... })`         | Hash computation, checkpoint commit, dirty-tree check, git checkout for revert    |
| `api.terminal.onSessionCreate(handler)`           | Track active Claude Code terminal sessions                                        |
| `api.terminal.onSessionClose(handler)`            | Remove closed sessions from registry                                              |
| `api.keyboard.register(...)`                      | Approve (CmdOrCtrl+Shift+A), Reject (CmdOrCtrl+Shift+R), Stop (CmdOrCtrl+Shift+S) |
| `api.notifications.showToast(...)`                | Error and success feedback                                                        |
| `api.ipc.registerHandler(...)`                    | All `speckit:*` IPC channels                                                      |
| `api.nativeMenu.addViewMenuItem(...)`             | "SpecKit Pilot" item in View menu                                                 |
| `api.topBar.registerMenuItem(...)`                | Quick-run menu in project top bar                                                 |

## Terminal Injection (Renderer Path)

Command injection into Claude Code sessions uses the existing preload API from the renderer context:

```typescript
// In extension React component (renderer context)
window.electronAPI.terminal.input({ sessionId, data: '/speckit-specify ...\n' })
```

This is the published `terminal:input` preload channel — not a new API surface.

## No ExtensionAPI Changes Required

The extension is designed to be a net consumer of the existing API. No additions to `src/main/extensions/api.ts` are needed.
