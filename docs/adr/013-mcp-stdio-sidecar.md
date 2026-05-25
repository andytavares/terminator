# ADR-013: MCP Stdio Sidecar for Task Vault Agent Access

**Status**: Accepted  
**Date**: 2026-05-19  
**Feature**: `005-task-vault-extension`

## Decision

Bundle the MCP server as a standalone Node.js script (`extensions/task-vault/src/mcp/server.ts`) that MCP clients spawn as a subprocess communicating over stdio. The script reads vault files directly using the same parser/writer modules as the Electron extension.

## Motivation

Agent-native access (FR-006, US3) requires a way for Claude Code, Cursor, and Claude Desktop to call into the vault without any per-client integration work beyond standard MCP configuration. The MCP protocol's canonical transport model for local servers is: _the client spawns the server process and communicates over stdin/stdout_.

## Alternatives Considered

| Alternative                                    | Why Rejected                                                                                                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-process HTTP server inside Electron         | MCP clients expect to spawn the server themselves. An HTTP server on a fixed port would require clients to know the port, handle port conflicts, and cannot use the standard `"command"/"args"` MCP config. |
| Compiled binary (pkg, nexe)                    | Adds a separate build pipeline; binary must be rebuilt for each platform; larger artifact; no benefit over a Node script when Electron already ships Node.js.                                               |
| IPC bridge (MCP client → Electron IPC → vault) | Requires a custom IPC bridge in the renderer and makes the MCP server dependent on the Electron app being running. Agents should be able to query the vault even when the GUI is closed.                    |

## Consequences

- The MCP server reads vault files directly (not via IPC to the Electron process). This means two writers can coexist: the UI and an MCP client. Atomic writes (`write-to-temp + rename`) prevent corruption.
- `TASK_VAULT_PATH` environment variable is required at startup; server exits with a clear error if absent.
- The server path is shown in extension settings so users can copy it into their MCP client config.
- VaultIndex is rebuilt after every write. Two concurrent MCP writes may race; the second writer will receive a `STALE_ID` error and must re-query — this is documented behavior, not a bug.
