# Research: Task Vault Extension

**Date**: 2026-05-19  
**Branch**: `005-task-vault-extension`

---

## Decision 1: MCP Server Transport & Integration Pattern

**Decision**: Bundled stdio sidecar script

**Rationale**: MCP clients (Claude Code, Cursor, Claude Desktop) connect to MCP servers via stdio by spawning a subprocess. The cleanest integration is to bundle the MCP server as a standalone Node.js script inside the extension, which users configure in their MCP client settings as `node path/to/server.js`. No separate binary compilation required since Electron ships with Node.js — the server script can be run by the user's system Node.js or referenced directly. The extension itself does not need to manage the server lifecycle; the MCP client handles spawning.

**Alternatives considered**:

- In-process HTTP server: Would require the extension to host an HTTP/SSE endpoint. Adds complexity (port management, CORS), and external MCP clients would need the URL rather than a stdio command. Rejected: unnecessarily complex for v1.
- Standalone compiled binary (Rust/Go): Eliminates Node.js dependency for users, but requires a separate build pipeline. Rejected: scope creep for v1; revisit in v2 per PRD roadmap.
- In-memory MCP (Electron IPC as transport): Would only work for agents running inside Terminator itself. Rejected: spec requires Claude Code, Cursor, and Claude Desktop to connect.

**Source**: [MCP TypeScript SDK — stdio transport](https://github.com/modelcontextprotocol/typescript-sdk), [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)

---

## Decision 2: Filesystem Watching

**Decision**: `chokidar` v3.x

**Rationale**: chokidar is the de-facto standard for filesystem watching in Node.js/Electron applications. It correctly handles macOS FSEvents, Linux inotify, and Windows ReadDirectoryChangesW. It has multiple active maintainers, is MIT-licensed, and is a transitive dependency of many existing projects. The Extension API already exposes `api.fs.watch` which uses `fsWatcherService` internally — but that service is scoped to project root changes, not arbitrary vault directory paths. The task-vault extension registers its own chokidar instance for the user-configured vault path.

**Alternatives considered**:

- `node:fs` `watch`/`watchFile`: Unreliable on macOS for directory recursion. Rejected.
- `@parcel/watcher`: Faster native watcher, but fewer dependents and less battle-tested in Electron context. Rejected per Constitution IV (prefer well-known alternatives).

**Source**: [chokidar GitHub](https://github.com/paulmillr/chokidar) (multiple maintainers, MIT, 30M+ weekly downloads)

---

## Decision 3: YAML Frontmatter Parsing

**Decision**: `gray-matter`

**Rationale**: gray-matter is the standard library for YAML/TOML frontmatter parsing in the Node.js ecosystem. MIT-licensed, multiple maintainers, used by Jekyll, Gatsby, and thousands of projects. It handles the YAML frontmatter format specified in the spec (Project files with `---` delimited frontmatter) without any custom parsing.

**Alternatives considered**:

- `js-yaml` directly: Would require manual frontmatter extraction (finding `---` delimiters). gray-matter wraps this correctly. Rejected: gray-matter is the proper tool.
- `yaml` package: Lower-level; same argument as js-yaml. Rejected.

**Source**: [gray-matter GitHub](https://github.com/jonschlinkert/gray-matter) (MIT, 6M+ weekly downloads)

---

## Decision 4: ICS Calendar Parsing

**Decision**: `node-ical`

**Rationale**: node-ical is an MIT-licensed ICS/iCalendar parser for Node.js with active maintenance and multiple contributors. Handles RFC 5545 VCALENDAR parsing including recurring events (RRULE), which is critical for correctly showing weekly events in the calendar step. It supports both URL fetching and string parsing.

**Alternatives considered**:

- `ical.js`: LGPL-licensed. Rejected per Constitution IV (prefer MIT/Apache over copyleft for extension bundling).
- Manual parsing: iCalendar format is complex (RRULE recurrence rules, timezone handling). Rejected: stdlib cannot satisfy this requirement.

**Source**: [node-ical GitHub](https://github.com/jens-maus/node-ical) (MIT, actively maintained, multiple contributors)

---

## Decision 5: Task ID Strategy

**Decision**: Line-based IDs (`filepath:line`), session-scoped

**Rationale**: This matches the PRD's stated approach ("stable enough for a session; the indexer reconciles after edits") and was confirmed in clarification session. Line-based IDs are simple to generate, require no mutation of vault files (no embedded UUIDs), and keep markdown files clean. The VaultIndex maps IDs to file positions; it is rebuilt after every write. MCP clients are documented to re-query after any write operation.

**Trade-off accepted**: IDs are not stable across sessions or after external edits. This is acceptable because: (1) MCP tool calls within a session use IDs from the same index snapshot, (2) the index rebuilds automatically on file change, (3) agents are documented to re-query.

**Source**: PRD §10 ("Tool IDs for tasks: `<filepath>:<line>`. Stable enough for a session; the indexer reconciles after edits"), clarification session 2026-05-19.

---

## Decision 6: Atomic File Writes

**Decision**: Write-to-temp-file + `fs.promises.rename` (same filesystem)

**Rationale**: POSIX `rename(2)` is atomic on the same filesystem. Write the new content to a `.todo/<filename>.tmp` file, then rename to the target. This prevents corruption if the process is killed mid-write. Node.js `fs.promises.rename` uses `rename(2)` on POSIX and `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING` on Windows, both of which are atomic for same-volume moves.

**Alternatives considered**:

- Direct overwrite (`fs.promises.writeFile`): Not atomic — a crash mid-write corrupts the file. Rejected.
- `write-file-atomic` package: Wraps the same pattern. Single maintainer. Rejected per Constitution IV.

**Source**: [Node.js fs.promises.rename docs](https://nodejs.org/api/fs.html#fspromisesrenameoldpath-newpath), POSIX rename(2) man page.

---

## Decision 7: Extension API v1.2.0 Additions

**Decision**: Add three new namespaces to `ExtensionAPI`

**Rationale**: The current v1.1.x API cannot support the task-vault's requirements for (1) a permanent global tab, (2) OS-level global hotkey, and (3) workspace/project enumeration. All three are additive (MINOR version bump, no breaking changes).

**Additions**:

1. `sidebar.registerGlobalTab(tab: GlobalTabContribution): Disposable` — registers a permanent tab in the app's top-level layout, always visible regardless of active workspace/project. Rendered by App.tsx alongside WorkspaceRail.
2. `globalShortcut.register(accelerator: string, handler: () => void): Disposable` — wraps Electron's `globalShortcut.register` for OS-level hotkeys (work when app is backgrounded).
3. `workspace.list(): WorkspaceSnapshot[]` — returns all workspaces with their UUIDs and display names. Used by the link picker UI.
4. `workspace.onDelete(handler: (workspaceId: string) => void): Disposable` — fires when a workspace is deleted, enabling broken-link detection.

**Source**: [Electron globalShortcut docs](https://www.electronjs.org/docs/latest/api/global-shortcut), existing `api.ts` patterns.

---

## Dependencies Summary

| Package                     | Version       | License | Purpose              | Justification                 |
| --------------------------- | ------------- | ------- | -------------------- | ----------------------------- |
| `@modelcontextprotocol/sdk` | latest stable | MIT     | MCP server           | Official Anthropic SDK        |
| `chokidar`                  | `^3.6.0`      | MIT     | Filesystem watching  | De-facto standard, 30M+ DL/wk |
| `gray-matter`               | `^4.0.3`      | MIT     | YAML frontmatter     | 6M+ DL/wk, battle-tested      |
| `node-ical`                 | `^0.20.0`     | MIT     | ICS parsing          | Active, multiple maintainers  |
| `zod`                       | `3.23.8`      | MIT     | Schema validation    | Already in other extensions   |
| `zustand`                   | `4.5.5`       | MIT     | State management     | Already in other extensions   |
| `react`                     | `18.3.1`      | MIT     | UI                   | Already in other extensions   |
| `react-dom`                 | `18.3.1`      | MIT     | UI                   | Already in other extensions   |
| `electron-store`            | `8.2.0`       | MIT     | Settings persistence | Already in git-integration    |

All packages have active communities with multiple maintainers. No single-maintainer packages. All versions pinned.
