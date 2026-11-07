# ADR 145: Claude Code reaches Terminator over a local MCP relay

**Status**: Accepted

**Date**: 2026-11-07

## Context

A Claude Code session that Terminator did not start cannot use Terminator. This includes the Claude desktop app, a `claude` CLI in another terminal, and the scheduled runs that Terminator starts. Such a session cannot raise an alert, start work, open a window or move itself into a Terminator tab. ADR 144 gave scheduled runs an alerts folder, but only runs that Terminator starts know that folder.

## Decision

Terminator runs one local MCP server, the Terminator MCP server.

- **Transport.** Claude Code starts a small stdio process, the relay, registered with `claude mcp add-json --scope user`. The relay connects to `<userData>/mcp.sock`, a Unix socket with mode `0600`, and sends one hello line with `CLAUDE_CODE_SESSION_ID` and its parent `claude` process id. There is no port, no token and no network access.
- **Manifest opt-in.** An invoke method in `src/shared/electron-api/manifest.ts` becomes a tool through its `mcp` field, as the `remote` field drives the remote allowlist. Every invoke method decides: an `mcp` object, or `mcp: false`. `mcpToolSpecs()` derives the list, and `manifest.spec.ts` pins it. The input schema is the row's zod schema, which `ipcInvokeRegistry` now keeps.
- **App and renderer tools.** A small set of tools covers what no channel does: `alert`, updates, the move, and screen actions that the renderer runs over `mcp:call` / `mcp:answer` (`src/shared/mcp/renderer-tools.ts`).
- **Asking.** A destructive tool carries `annotations.destructiveHint: true` and `_meta["anthropic/requiresUserInteraction"]: true`, so Claude Code asks on every call, over allow rules and in every mode. A tool that can reach both kinds of action is split in two, and the plain tool refuses destructive targets. All other tools run with no prompt under the `mcp__terminator` allow rule.
- **Alerts.** This replaces the alert section of ADR 144. A scheduled run raises an alert through the `alert` tool. The alerts folder and its watcher are removed.

## Alternatives

- **Streamable HTTP on 127.0.0.1 with a bearer token.** The server never learns which session called, so a session cannot move itself. The token lives in `~/.claude.json`, and a port can collide.
- **The remote-control bridge.** It listens on `0.0.0.0` behind a password, and it does not speak MCP.

## Consequences

- Each Claude Code session starts one relay process.
- When Terminator is not running, the server fails to connect for that session.
- A new feature becomes a tool with one `mcp` line, and the pinned list shows each change in review.
