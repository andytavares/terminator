# ADR 109: A file watch belongs to the view that asked

**Status**: Accepted
**Date**: 2026-10-13
**Extends**: [ADR-005](005-native-fswatcher-over-chokidar.md)
**Relates to**: [ADR 023](023-channel-manifest-and-declared-remote-access.md), [ADR 034](034-a-branch-is-named-by-its-branch.md)

## Decision

`fs.watchStart(projectRoot)` gives the view that called it the changes under that root, and gives them to no other view. The Git tab starts a watch for its repository and reads status when the watch reports a change. Its three-second poll is gone.

Until now the view API had the three members (`fs.watchStart`, `fs.watchStop`, `fs.onChanged`) and nothing called `watchStart`, so `fs:changed` never fired and git status was polled: two git processes every three seconds for as long as the Git tab was open.

## How it works

```
view ── fs:watch-start {projectRoot} ──▶ fs.ipc.ts ── watch(root, listenerOf(event.sender)) ──▶ FsWatcherService
                                                                                                 │ one WatchedRoot per root
 ◀── fs:changed, to event.sender only ◀── listener ◀── one batch per burst ◀── ChangeBurst ◀── tree-watch.ts
```

- **Who is told.** An `ipcMain` handler knows its caller as `event.sender`, a `WebContents` ([IpcMainInvokeEvent](https://www.electronjs.org/docs/latest/api/structures/ipc-main-invoke-event)). `src/main/ipc/fs.ipc.ts` keeps one listener per `WebContents` and sends `fs:changed` to that `WebContents` alone. The main window's `send` is patched to relay every push to the extension views and the remote bridge; `fs:changed` is left out of that relay.
- **Several watches.** `FsWatcherService` (`src/main/fs/fs-watcher.ts`) watches each root once, however many views listen, and closes it when the last one stops. A view may watch several roots: each `watchStart` adds one, and `watchStop` ends all of that view's and nobody else's.
- **A view that goes away.** The listener ends its watches on the `WebContents`' [`destroyed`](https://www.electronjs.org/docs/latest/api/web-contents) event, and on [`did-start-navigation`](https://www.electronjs.org/docs/latest/api/web-contents) of the main frame to another document, which is what a reload is: the page that asked no longer exists.
- **Bursts.** A checkout or an install changes thousands of files. `ChangeBurst` reports once the tree has been quiet for 100 ms, or 1 s into a burst that has not ended. The event keeps its shape: `filename` is the one path that changed, or `null` when several did.

## What is watched

| Platform       | How                                            | Why                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS, Windows | `fs.watch(root, { recursive: true })`          | Native: FSEvents and ReadDirectoryChangesW ([fs.watch](https://nodejs.org/docs/latest-v24.x/api/fs.html#fswatchfilename-options-listener)). One watch, whatever the tree's size.                                                                                                                                                                                              |
| Linux          | one `fs.watch` per directory (`tree-watch.ts`) | Node builds `recursive` on Linux from one inotify watch per **file**, keyed by path ([`lib/internal/fs/recursive_watch.js`](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/fs/recursive_watch.js)). A file replaced by a rename, which is how git writes `.git/index`, is reported the first time and never again. A watch on the directory reports it every time. |

Measured on Node 24.21 (`node:24.21.0-bookworm`), one recursive watch, an edit then `git add` then `git commit`, four rounds:

| Round | Node's `recursive`: events for `git add` | One watch per directory |
| ----- | ---------------------------------------- | ----------------------- |
| 1     | 3                                        | reported                |
| 2–4   | 0                                        | reported                |

`node_modules` and `.git/objects` are not watched on any platform (`isUnwatchedPath`). No status depends on them, and on Linux each directory in them would cost an inotify watch: starting Node's recursive watch on a tree with 50,000 files under `node_modules` took 235 ms of the main process's time; ignoring it, under 1 ms.

A tree that cannot be watched (the root is missing, the inotify limit is reached) is reported as changed every three seconds, as ADR-005 decided.

## The app's own git must not feed the watch

`git status` rewrites `.git/index` to save the next command some work ([Background refresh](https://git-scm.com/docs/git-status#_background_refresh)). That is a change in the watched tree: the read would ask for itself again. Measured on macOS, `git status --porcelain=v1 -z` after a file was saved with the content it had:

| Environment            | Events from one `git status`        |
| ---------------------- | ----------------------------------- |
| default                | 3 (`.git/index.lock`, `.git/index`) |
| `GIT_OPTIONAL_LOCKS=0` | 0                                   |

Every git the app runs is given `GIT_OPTIONAL_LOCKS=0` (`BACKGROUND_GIT` in `src/main/git/git-env.ts`, used by the core's git service and by `shell.exec`). Git documents it for this case: "useful for processes running in the background which do not want to cause lock contention with other operations on the repository" ([git, `GIT_OPTIONAL_LOCKS`](https://git-scm.com/docs/git#_environment_variables)). It also means the app no longer takes the index lock from under a `git add` the person runs.

`git diff` does not obey it: the sidebar's `git diff --numstat HEAD` still rewrote the index (git 2.55). That call now passes `-c diff.autoRefreshIndex=false` ([diff.autoRefreshIndex](https://git-scm.com/docs/diff-config)), which changes nothing in its counts. The setting is not applied to every git: with it, `git diff --name-only` lists a file whose content did not change.

Nothing is ever written into a watched repository, to prove a watch is armed or for any other reason.

## The git directory outside the working tree

A linked worktree keeps its index and `HEAD` in the repository's git directory ([git-worktree, Details](https://git-scm.com/docs/git-worktree#_details)), so `git add` and `git commit` there change nothing under the worktree. The Git tab asks its backend which directories to watch (`git:watch-roots`: `git rev-parse --path-format=absolute --git-common-dir`) and watches the git directory too when it is outside the folder.

## The moment before a watch is armed

On macOS a change made just after `fs.watch` returns can have no event. This was observed here (handoff advisory 7); Node documents no signal for a watch being armed. The Git tab starts the watch and only then reads status. A change made before the read is in the read, and one made after the watch is armed has an event. A change in between is read on the next event, or when the view is shown again. Tests make their change again on each look for the same reason, and never wait a fixed time.

## The remote browser client

`fs.watchStart`, `fs.watchStop` and `fs.onChanged` are stand-ins there (`remote: 'stub'`): `watchStart` answers `{ error: 'WATCH_UNAVAILABLE' }`, and a caller told that polls. The Git tab reads status every three seconds in that case only.

The bridge calls a channel with no sender: it has no view to tell, and no event for a browser tab that closed, so a remote watch could not belong to one client or end with it. The three channels leave the set the bridge can reach, which also stops a remote client starting a watch on any path of the desktop.

## Alternatives considered

| Alternative                                                 | Why rejected                                                                                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove the three members from the view API                  | A breaking SDK change, to keep a poll.                                                                                                                                                    |
| chokidar or `@parcel/watcher`                               | ADR-005 stands: the standard library does this in about a hundred lines.                                                                                                                  |
| Node's `recursive` on Linux, with a poll for what it misses | The poll is the thing being removed.                                                                                                                                                      |
| Send the event over the bridge to remote clients            | See above: a watch with no owner and no end.                                                                                                                                              |
| `useBranchSync` on the watch                                | The branch is one file, `HEAD`. The view API watches trees: a watch per sidebar card to save one `git branch --show-current` every five seconds costs more than it saves. It still polls. |

## Consequences

- With the Git tab open and nothing changing, the Git tab starts no git process. Measured over one idle minute on macOS, one repository open, before and after:

  | git process                    | Started by                   | Before | After |
  | ------------------------------ | ---------------------------- | ------ | ----- |
  | `git status --porcelain=v1 -z` | the Git tab                  | 20     | 0     |
  | `git branch --show-current`    | the Git tab                  | 20     | 0     |
  | `git branch --show-current`    | the sidebar, `useBranchSync` | 12     | 12    |
  | `git diff --numstat HEAD`      | the sidebar's change count   | 2      | 2     |
  | Total                          |                              | 54     | 14    |

  Counted from git's own trace: the app was started with `XDG_CONFIG_HOME` naming a git config that sets `trace2.normalTarget` to a file, and the `start` lines written in 60 s were counted.

- The 14 left are the core sidebar's two polls, which this decision does not change.
- An extension that calls `fs.watchStart` is told about its own roots only, in bursts, and never about `node_modules`.
- On Linux a very large tree outside `node_modules` still costs one inotify watch per directory, and a synchronous walk when the watch starts.
- A file saved with unchanged content is still followed by one extra status read when an extension's own `git diff` refreshes the index.
