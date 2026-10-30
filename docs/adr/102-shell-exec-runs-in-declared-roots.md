# ADR-102: Extension Shell Commands Run Only in Declared Roots (Supersedes the cwd rule of ADR-006)

**Status**: Accepted (root 3, `api.paths.userData`, superseded by [ADR-103](103-each-extension-has-its-own-data-folder.md))
**Date**: 2026-10-12
**Supersedes**: ADR-006's rule 2, "CWD pinning: the `cwd` argument must be within the current workspace's `folderPath`". The rest of ADR-006 stands: the git and gh allowlist, `execFile` without a shell, the minimal environment and the timeout.

## Decision

Every command that an extension runs through `api.shell.exec` or `api.github` starts in a directory. After `fs.realpath`, that directory must be one of the **shell roots** of the extension, or below one. The app reads the roots on every call:

1. every workspace `folderPath`;
2. every project `worktreePath`;
3. `api.paths.userData`. This is `app.getPath('userData')`, the per-user data directory of the application. It is the same directory for every extension, because there is no per-extension data directory today;
4. the current value of each setting that the extension declares in `contributes.shellRoots` of its manifest. The app counts a setting only while the extension has registered that key, through `settings.register`, as a `folder` setting.

```json
"contributes": {
  "shellRoots": ["terminator.git-integration.review.cloneFolder"]
}
```

`shellRoots` is a list of setting keys, beside `windowViews` and `commands`. A key that does not start with the own id of the extension (`<id>.`) refuses the manifest at load with `INVALID_MANIFEST`. `activate` registers settings after the app reads the manifest. So the app checks at call time whether the key is a registered `folder` setting. An unregistered key, or a key registered with another type, adds no root.

The check is `assertCwdInScope(cwd, roots)` in `src/main/shell/shell-executor.ts`. It resolves the `cwd` and every root with `realpath`. So a symlink inside a root cannot lead out of it. A `..` after a symlink resolves the way the operating system will resolve it. A directory that does not exist yet (a clone target) resolves through its nearest existing ancestor. Containment is by path segment: `/a/bc` is not inside `/a/b`. The check refuses a relative `cwd` and ignores a relative or empty root.

A refused call rejects with an error named `CwdOutOfScopeError` and runs nothing. Only `name` and `message` cross the link of the extension host (`src/main/extensions/host/rpc-endpoint.ts`), as for `MissingCwdError`.

The `shell:exec` channel of the renderer keeps its single optional `workspaceRoot`. It goes through the same function, so it gains the `realpath` comparison.

## Context

ADR-006 described the cwd pin. But only the `shell:exec` channel of the renderer applied it, and only when the caller passed a `workspaceRoot`. `api.shell.exec` and `api.github` checked the command and nothing else. So an extension could run git or gh in any directory. The check that did exist compared paths as written, so a symlink inside the workspace led out of it.

Applying the rule of ADR-006 as written would have refused five legitimate callers:

| Caller                                                   | Where its cwd is                                                                          | Root that admits it               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| git-integration "Clone and review" (`github:clone-repo`) | `terminator.git-integration.review.cloneFolder`                                           | 4, declared by git-integration    |
| A project worktree under `git.worktreeBaseDir`           | outside the repository, wherever that setting points                                      | 2                                 |
| Foundry's records root with no workspace open            | `api.paths.userData/foundry/.foundry` (`extensions/foundry/src/workspace-root.ts`)        | 3                                 |
| Foundry with `terminator.foundry.dataDir` set            | that absolute directory (`extensions/foundry/src/data-root.ts`)                           | 4, declared by Foundry            |
| A Foundry lane worktree                                  | `<records root>/orders/<id>/worktrees/<repo>` (`extensions/foundry/src/line/worktree.ts`) | the records root's own: 1, 3 or 4 |

Three gh calls in git-integration ran in the home directory, because their directory did not matter to gh. They are a `gh:owner/name` root (gh reads `GH_REPO`), `github:accessible-repos` and `github:dashboard-search`. The home directory is not made a root. These calls pass `api.paths.userData` instead (`GithubAccess.noCheckoutCwd`).

`tests/unit/extensions/shell-scope-callers.spec.ts` runs each of these callers through the real check. Each caller uses the directory that its own code computes. `tests/unit/extensions/shell-scope.spec.ts` covers the roots and the refusals.

## Alternatives considered

| Alternative                                                  | Why rejected                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-006 as written: workspace folders only                   | Refuses the five callers above, including every Foundry order with a data directory and every review clone.                                                                           |
| Add the home directory as a root                             | Admits almost every path a user owns, which is no confinement at all. The gh calls that used it need no particular directory.                                                         |
| Declared roots as literal paths in the manifest              | The directories are the operator's choice, made in settings after the extension ships; a manifest cannot know them.                                                                   |
| A per-extension directory under `userData` as the third root | No such directory exists; Foundry already keeps its fallback records in `userData/foundry`. Introducing one would move existing data. Worth doing when there is a per-extension path. |
| Check registration at manifest load                          | Settings are registered by `activate`, which runs after the manifest is read. The namespace check is what is knowable at load; the type check runs at call time.                      |
| Lexical comparison (`path.relative`) as before               | A symlink inside a root leads out of it, and `..` after a symlink resolves differently in the kernel than on the string.                                                              |

## Consequences

- An extension that ran git or gh outside these roots now gets `CwdOutOfScopeError`. The extension must declare a folder setting in `contributes.shellRoots`. Or it runs in `api.paths.userData` when the directory does not matter. The 4.0.0 changelog of the SDK records this.
- A declared root is only as narrow as its setting. An extension can write its own setting with `settings.set`. So `shellRoots` confines a well-behaved extension to what the operator chose, and it makes the widening visible in the manifest. It is not a boundary against a hostile extension. ADR-006 already does not claim to be one.
- `userData` is shared. Any extension may run git or gh anywhere in it, including in the records of another extension.
- The check runs on every call. It reads the workspace store and the settings each time. So a folder chosen in settings applies to the next call without a restart. The check resolves each root with `realpath`, which costs a few system calls per root per command.
- Between the check and `execFile`, the directory can change (a symlink swapped in). The allowlist and `shell: false` still bound what can run there.
