# ADR-007: Agent Runner as Child Subprocess

**Status:** Accepted  
**Date:** 2026-06-27

## Context

SpecKit Pilot needs to run Claude Code autonomously across 10 pipeline phases. We evaluated two approaches:

1. **Anthropic API directly** — call the Claude API from the main process, stream tokens, parse tool calls.
2. **Claude Code CLI as subprocess** — spawn `claude --headless --print <command>` as a child process, stream its stdout.

## Decision

We spawn **Claude Code CLI** (`claude`) as a child process via Node.js `child_process.spawn`.

## Rationale

- **Tool use is handled for us.** Claude Code already knows how to read/write files, run shell commands, and iterate. Reimplementing this over the raw API would require a full tool-execution loop.
- **Slash skills work out of the box.** Self-review uses `/google-review`, which is a Claude Code skill — impossible to replicate via raw API.
- **Output is line-oriented.** Stdout lines map 1-to-1 to `speckit:run-output` push events, making progress streaming trivial.
- **Isolation.** Each phase runs in its own subprocess and its own git worktree, so a hanging phase can be killed without affecting the app process.

## Consequences

- **Requires Claude Code installed.** The user must have `claude` on their PATH. We validate this at dispatch time.
- **No streaming tool approval.** We cannot intercept individual tool calls mid-flight (Claude Code handles them internally). Batch check-ins (implement phase) compensate by letting the user review diffs at batch boundaries.
- **Self-review command:** `npm run format && npm run lint && npx vitest run --coverage && claude --headless --print /google-review`

## Alternatives Considered

| Option                    | Why Rejected                                                   |
| ------------------------- | -------------------------------------------------------------- |
| Anthropic SDK (streaming) | Would require full tool-execution loop; no slash-skill support |
| MCP sidecar               | Additional process complexity; retired in ADR-020              |
| Claude Code MCP server    | Not yet available as a stable subprocess interface             |
