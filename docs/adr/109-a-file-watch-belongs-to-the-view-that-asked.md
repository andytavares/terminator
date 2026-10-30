# ADR 109: A file watch belongs to the view that asked

**Status**: Accepted
**Date**: 2026-10-13
**Extends**: [ADR-005](005-native-fswatcher-over-chokidar.md)
**Relates to**: [ADR 023](023-channel-manifest-and-declared-remote-access.md), [ADR 034](034-a-branch-is-named-by-its-branch.md)

## Decision

`fs.watchStart(projectRoot)` gives the changes under that root to the view that called it, and to no other view. The Git tab starts a watch for its repository. It reads status when the watch reports a change. The three-second poll of the Git tab is gone.

Until now the view API had three members (`fs.watchStart`, `fs.watchStop`, `fs.onChanged`), and nothing called `watchStart`. So `fs:changed` never fired, and the app polled git status. The poll started two git processes every three seconds while the Git tab was open.

## How it works

```
view ── fs:watch-start {projectRoot} ──▶ fs.ipc.ts ── watch(root, listenerOf(event.sender)) ──▶ FsWatcherService
                                                                                                 │ one WatchedRoot per root
 ◀── fs:changed, to event.sender only ◀── listener ◀── one batch per burst ◀── ChangeBurst ◀── tree-watch.ts
```

- **Who is told.** An `ipcMain` handler knows its caller as `event.sender`, a `WebContents` ([IpcMainInvokeEvent](https://www.electronjs.org/docs/latest/api/structures/ipc-main-invoke-event)). `src/main/ipc/fs.ipc.ts` keeps one listener per `WebContents`. It sends `fs:changed` to that `WebContents` alone. The `send` of the main window is patched to relay every push to the extension views and the remote bridge. The relay leaves out `fs:changed`.
- **Several watches.** `FsWatcherService` (`src/main/fs/fs-watcher.ts`) watches each root once, however many views listen. It closes the watch when the last view stops. A view can watch several roots. Each `watchStart` adds one root. `watchStop` ends all the watches of that view and no other view's watches.
- **A view that goes away.** The listener ends its watches on the [`destroyed`](https://www.electronjs.org/docs/latest/api/web-contents) event of the `WebContents`. It also ends them on [`did-start-navigation`](https://www.electronjs.org/docs/latest/api/web-contents) of the main frame to another document, which is what a reload is. The page that asked no longer exists.
- **Bursts.** A checkout or an install changes thousands of files. `ChangeBurst` reports once the tree has been quiet for 100 ms, or 1 s into a burst that has not ended. The event keeps its shape. `filename` is the one path that changed, or `null` when several paths changed.

## What is watched

| Platform       | How                                            | Why                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS, Windows | `fs.watch(root, { recursive: true })`          | Native: FSEvents and ReadDirectoryChangesW ([fs.watch](https://nodejs.org/docs/latest-v24.x/api/fs.html#fswatchfilename-options-listener)). One watch, whatever the size of the tree.                                                                                                                                                                                               |
| Linux          | one `fs.watch` per directory (`tree-watch.ts`) | On Linux, Node builds `recursive` from one inotify watch per **file**, keyed by path ([`lib/internal/fs/recursive_watch.js`](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/fs/recursive_watch.js)). A rename replaces the file, which is how git writes `.git/index`. Node reports this the first time and never again. A watch on the directory reports it every time. |

Measured on Node 24.21 (`node:24.21.0-bookworm`), one recursive watch, an edit then `git add` then `git commit`, four rounds:

| Round | Node's `recursive`: events for `git add` | One watch per directory |
| ----- | ---------------------------------------- | ----------------------- |
| 1     | 3                                        | reported                |
| 2–4   | 0                                        | reported                |

No platform watches `node_modules` or `.git/objects` (`isUnwatchedPath`). No status depends on them. On Linux, each directory in them would cost an inotify watch. Starting the recursive watch of Node on a tree with 50,000 files under `node_modules` took 235 ms of the time of the main process. With `node_modules` ignored, it took under 1 ms.

The service reports a tree that cannot be watched (the root is missing, the inotify limit is reached) as changed every three seconds, as ADR-005 decided.

## The app's own git must not feed the watch

`git status` rewrites `.git/index` to save work for the next command ([Background refresh](https://git-scm.com/docs/git-status#_background_refresh)). That is a change in the watched tree, so the read would ask for itself again. Measured on macOS, `git status --porcelain=v1 -z` after a file was saved with the content it had:

| Environment            | Events from one `git status`        |
| ---------------------- | ----------------------------------- |
| default                | 3 (`.git/index.lock`, `.git/index`) |
| `GIT_OPTIONAL_LOCKS=0` | 0                                   |

Every git command that the app runs gets `GIT_OPTIONAL_LOCKS=0` (`BACKGROUND_GIT` in `src/main/git/git-env.ts`, used by the git service of the core and by `shell.exec`). Git documents it for this case: "useful for processes running in the background which do not want to cause lock contention with other operations on the repository" ([git, `GIT_OPTIONAL_LOCKS`](https://git-scm.com/docs/git#_environment_variables)). It also means the app no longer takes the index lock from under a `git add` that the person runs.

`git diff` does not obey it. The `git diff --numstat HEAD` of the sidebar still rewrote the index (git 2.55). That call now passes `-c diff.autoRefreshIndex=false` ([diff.autoRefreshIndex](https://git-scm.com/docs/diff-config)), which changes nothing in its counts. The app does not apply the setting to every git command. With the setting, `git diff --name-only` lists a file whose content did not change.

The app never writes into a watched repository, either to prove that a watch is armed or for any other reason.

## The git directory outside the working tree

A linked worktree keeps its index and `HEAD` in the git directory of the repository ([git-worktree, Details](https://git-scm.com/docs/git-worktree#_details)). So `git add` and `git commit` there change nothing under the worktree. The Git tab asks its backend which directories to watch (`git:watch-roots`: `git rev-parse --path-format=absolute --git-common-dir`). It also watches the git directory when the directory is outside the folder.

## The moment before a watch is armed

On macOS, a change made just after `fs.watch` returns can have no event. The team observed this (handoff advisory 7). Node documents no signal for a watch that is armed. The Git tab starts the watch and only then reads status. The read includes a change made before the read. A change made after the watch is armed has an event. A change in between is read on the next event, or when the view is shown again. For the same reason, tests make their change again on each look, and never wait a fixed time.

## The remote browser client

`fs.watchStart`, `fs.watchStop` and `fs.onChanged` are stand-ins there (`remote: 'stub'`). `watchStart` answers `{ error: 'WATCH_UNAVAILABLE' }`, and a caller that gets this answer polls. Only in that case does the Git tab read status every three seconds.

The bridge calls a channel with no sender. It has no view to tell, and no event for a browser tab that closed. So a remote watch could not belong to one client or end with it. The three channels leave the set that the bridge can reach. This also stops a remote client from starting a watch on any path of the desktop.

## Alternatives considered

| Alternative                                                 | Why rejected                                                                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove the three members from the view API                  | A breaking SDK change, only to keep a poll.                                                                                                                                                 |
| chokidar or `@parcel/watcher`                               | ADR-005 stands. The standard library does this in about a hundred lines.                                                                                                                    |
| Node's `recursive` on Linux, with a poll for what it misses | The poll is what this decision removes.                                                                                                                                                     |
| Send the event over the bridge to remote clients            | See above. The watch has no owner and no end.                                                                                                                                               |
| `useBranchSync` on the watch                                | The branch is one file, `HEAD`. The view API watches trees. A watch per sidebar card, to save one `git branch --show-current` every five seconds, costs more than it saves. It still polls. |

## Consequences

- With the Git tab open and nothing changing, the Git tab starts no git process. Measured over one idle minute on macOS with one repository open, before and after:

  | git process                    | Started by                   | Before | After |
  | ------------------------------ | ---------------------------- | ------ | ----- |
  | `git status --porcelain=v1 -z` | the Git tab                  | 20     | 0     |
  | `git branch --show-current`    | the Git tab                  | 20     | 0     |
  | `git branch --show-current`    | the sidebar, `useBranchSync` | 12     | 12    |
  | `git diff --numstat HEAD`      | the sidebar's change count   | 2      | 2     |
  | Total                          |                              | 54     | 14    |

  Counted from the trace of git: the app started with `XDG_CONFIG_HOME` naming a git config that sets `trace2.normalTarget` to a file. The count is the `start` lines written in 60 s.

- The 14 that remain are the two polls of the core sidebar. This decision does not change them.
- An extension that calls `fs.watchStart` hears about its own roots only, in bursts, and never about `node_modules`.
- On Linux, a very large tree outside `node_modules` still costs one inotify watch per directory, and a synchronous walk when the watch starts.
- When the own `git diff` of an extension refreshes the index, a file saved with unchanged content still causes one extra status read.
