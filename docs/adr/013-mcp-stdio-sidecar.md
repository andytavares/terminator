# ADR-013: MCP Stdio Sidecar for Task Vault Agent Access

**Status**: Superseded by ADR-015  
**Date**: 2026-05-19  
**Feature**: `005-task-vault-extension`

## Decision

Bundle the MCP server as a standalone Node.js script (`extensions/task-vault/src/mcp/server.ts`). MCP clients spawn it as a subprocess and communicate over stdio. The script reads vault files directly, using the same parser/writer modules as the Electron extension.

## Motivation

Agent-native access (FR-006, US3) requires a way for Claude Code, Cursor, and Claude Desktop to call into the vault. It must need no per-client integration work beyond standard MCP configuration. The MCP protocol's canonical transport model for local servers is: _the client spawns the server process and communicates over stdin/stdout_.

## Alternatives Considered

| Alternative                                    | Why Rejected                                                                                                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-process HTTP server inside Electron         | MCP clients expect to spawn the server themselves. An HTTP server on a fixed port would require clients to know the port, handle port conflicts, and cannot use the standard `"command"/"args"` MCP config. |
| Compiled binary (pkg, nexe)                    | Adds a separate build pipeline; binary must be rebuilt for each platform; larger artifact; no benefit over a Node script when Electron already ships Node.js.                                               |
| IPC bridge (MCP client → Electron IPC → vault) | Requires a custom IPC bridge in the renderer and makes the MCP server dependent on the Electron app being running. Agents should be able to query the vault even when the GUI is closed.                    |

## Consequences

- The MCP server reads vault files directly (not via IPC to the Electron process). Two writers can therefore coexist: the UI and an MCP client. Atomic writes (`write-to-temp + rename`) prevent corruption.
- The `TASK_VAULT_PATH` environment variable is required at startup. The server exits with a clear error if it is absent.
- Extension settings show the server path, so users can copy it into their MCP client config.
- VaultIndex is rebuilt after every write. Two concurrent MCP writes can race. The second writer receives a `STALE_ID` error and must re-query. This is documented behavior, not a bug.
