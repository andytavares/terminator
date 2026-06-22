# ADR-020: MCP Stdio Sidecar Removal

**Status**: Accepted  
**Date**: 2026-06-21  
**Supersedes**: ADR-013

## Decision

The MCP stdio sidecar (`extensions/task-vault/src/mcp/server.ts`) has been removed from the codebase. The directory `extensions/task-vault/src/mcp/` no longer exists.

## Motivation

ADR-013 introduced the MCP stdio sidecar for agent access to Task Vault data. However, the sidecar was superseded by ADR-015 (WebSocket bridge via the remote-control extension), which provides equivalent read/write capability over a structured JSON protocol without requiring a separate spawnable process.

The sidecar imposed ongoing maintenance cost:

- Separate entry point (`mcp/server.ts`) requiring its own build/test surface
- Duplicated vault parsing logic diverging from the IPC layer
- No active users — the remote-control extension's WebSocket bridge (`/api/ipc`) covers the same agent-access use cases

## Alternatives Considered

| Alternative                             | Why Rejected                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Keep sidecar alongside WebSocket bridge | Dead code; maintenance burden without users; ADR-015 is strictly more capable for in-app agents |
| Update sidecar to call IPC instead      | Circular dependency; sidecar process cannot call into Electron IPC from outside the renderer    |
| Publish sidecar as separate npm package | Out of scope; the remote-control extension satisfies the same use case                          |

## Consequences

- AI agent access to vault data uses the remote-control WebSocket bridge (`extensions/remote-control/`) as defined in ADR-015.
- `extensions/task-vault/src/mcp/` directory does not exist and must not be re-created without a new ADR.
- ADR-013 is superseded; its status field has been updated accordingly.
