# ADR 155: termctl is an MCP client of the running app, shipped inside it

**Status**: Accepted

**Date**: 2026-11-08

## Context

The maintainer asked for a command line that exposes what the Terminator MCP server exposes, both as direct commands and as an interactive full-screen view (design "Terminator Speed and termctl", 2026-11-08). The server already listens on a Unix socket, and its relay shows the protocol: one JSON hello line, then MCP JSON-RPC (ADR 145). Most of its 108 tools act on the running app's state.

## Decision

`termctl` (`apps/termctl`) is an MCP client of that socket. It sends the relay's hello line, lists the tools, and maps each tool name to a `noun verb` command with flags from the tool's JSON Schema; a tool the map cannot name keeps its raw name. Without arguments it opens a full-screen view built with Ink. It needs the app running; otherwise it exits 3 with "Terminator is not running." A destructive tool asks in a terminal and is refused without one unless `--yes` is passed.

esbuild bundles it into one file that ships inside the app (`Resources/termctl/termctl.mjs`). On every start the app writes a launcher that runs it with the app's own binary in Node mode and the app's socket path, the way it runs the relay. Settings → Integrations links the launcher into `/usr/local/bin`.

## Alternatives considered

- **A command that runs the features itself.** Most tools act on the live app's state; a second copy of that logic would drift.
- **A separate npm package.** Its version could drift from the app's; the bundle in the app always matches.
- **A readline prompt instead of a full-screen view.** No dependency, but the maintainer chose a full-screen view. Ink is React for terminals, which the repository already uses (React 19.3.1 meets Ink 8's `>=19.3.0`); it is published by sindresorhus and maintained in vadimdemedes/ink.

## Consequences

A new MCP tool becomes a `termctl` command with no change to `termctl`. Only `apps/termctl` depends on Ink. A tool that only makes sense for a Claude Code session (for example `move_session_here`) returns its own error to `termctl`.
