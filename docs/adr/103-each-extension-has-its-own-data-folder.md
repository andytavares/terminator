# ADR-103: Each Extension Has Its Own Data Folder (Supersedes root 3 of ADR-102)

**Status**: Accepted
**Date**: 2026-10-12
**Supersedes**: ADR-102's third shell root, `api.paths.userData`. The rest of ADR-102 stands.

## Decision

`api.paths.globalStorage` is the extension's own data folder, `<userData>/extensions/<id>` (`src/main/extensions/extension-paths.ts`). It replaces `api.paths.userData` in the SDK, and it replaces userData as ADR-102's third shell root: an extension's git and gh may run in its own folder and below it, and nowhere else in userData.

The name and the contract are VS Code's `ExtensionContext.globalStorageUri` ([API reference](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext)): "a directory in which the extension can store global state. The directory might not exist on disk and creation is up to the extension." VS Code's `storageUri` is per workspace; this folder is not, so it takes the global name. Inside `paths` the SDK names a directory by what it is (`app`), without VS Code's `Uri` suffix.

The core creates nothing: an extension creates the folder when it first writes. `moveFromUserData` (`@terminator/extension-sdk/node`) moves what an earlier build kept in userData into the folder at activation, each path only while its new location does not exist. When both exist neither is touched and `api.log.warn` names the old copy.

| Extension       | Moved from userData                                                                         | To, under `globalStorage` |
| --------------- | ------------------------------------------------------------------------------------------- | ------------------------- |
| Foundry         | `foundry/` (fallback records), `foundry-runtime/`                                           | `records/`, `runtime/`    |
| git-integration | `config.json`, `pr-review-sessions.json`, `pr-active-reviews.json`, `pr-agent-reviews.json` | the same names            |

A Foundry lane worktree can sit under the fallback records. Its repository records the worktree's path, so after the move Foundry runs `git worktree repair` inside each lane; otherwise `git worktree prune` would delete the lane's metadata.

## Context

ADR-102 made userData a root because no per-extension folder existed, and recorded the cost: any extension could run git or gh anywhere in it, including in another extension's records. `tests/unit/extensions/shell-scope.spec.ts` now refuses one extension's `shell.exec` in another extension's folder and in userData outside its own.

No extension needs the shared folder once its own data has moved, so `paths.userData` is removed from SDK 4.0.0 before release (constitution VI: unreachable code is deleted).

## Alternatives considered

| Alternative                                   | Why rejected                                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Keep `paths.userData` beside `globalStorage`  | No extension reads it after the move; it would keep handing every extension the folder holding the core's and others' files. |
| The core moves each extension's data          | The core would have to know Foundry's and git-integration's file names, which constitution II forbids.                       |
| Name it `paths.storage`                       | VS Code's `storageUri` is the per-workspace folder; a VS Code author would read the wrong scope into it.                     |
| The core creates the folder before activation | VS Code does not, and most extensions (notepad, task-vault, remote-control) write nothing there.                             |
| Merge the two copies when both exist          | Which record wins is the extension's knowledge, not a file system rule; leaving both and saying so loses nothing.            |

## Consequences

- An extension that ran git or gh in userData outside its own folder gets `CwdOutOfScopeError`.
- Moving is a `rename` inside userData, so it is atomic and needs no copy; it cannot cross file systems, and it does not need to.
- An operator who ran a newer build and then an older one may have both copies; the newer is used and the log names the older.
