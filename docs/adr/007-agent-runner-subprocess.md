# ADR-007: Agent Runner as Child Subprocess

**Status:** Accepted  
**Superseded in part by:** [ADR-026](026-supervised-runs-in-a-terminal.md) — a card's phases now run supervised, in a visible terminal. The headless spawn described here remains only for self-review, which needs an agent that cannot write.  
**Date:** 2026-06-27

## Context

SpecKit Pilot needs to run Claude Code autonomously across 10 pipeline phases. We evaluated two approaches:

1. **Anthropic API directly** — call the Claude API from the main process, stream tokens, parse tool calls.
2. **Claude Code CLI as subprocess** — spawn `claude --print <command>` as a child process, stream its stdout.

## Decision

We spawn **Claude Code CLI** (`claude`) as a child process via Node.js `child_process.spawn`.

## Rationale

- **Tool use is handled for us.** Claude Code already knows how to read/write files, run shell commands, and iterate. Reimplementing this over the raw API would require a full tool-execution loop.
- **Slash skills work out of the box.** Self-review uses `/google-review`, which is a Claude Code skill — impossible to replicate via raw API.
- **Output is line-oriented.** Stdout lines map 1-to-1 to `speckit:run-output` push events, making progress streaming trivial.
- **Isolation.** Each phase runs in its own subprocess and its own git worktree, so a hanging phase can be killed without affecting the app process.

## Consequences

- **Requires Claude Code installed.** The user must have `claude` on their PATH. We validate this at dispatch time.
- **Headless runs bypass permission prompts.** Each phase is spawned as a non-interactive `claude --print` pipe with no channel to answer approval prompts, so it runs with `--permission-mode bypassPermissions`. Without this every Write/Edit/Bash tool call stalls forever waiting on approval that can never arrive. This is safe because each phase runs in the card's own isolated git worktree (see ADR-011), the exact "isolated environment" this mode is intended for. Batch check-ins (implement phase) remain the human gate — the user reviews diffs at batch boundaries rather than approving individual tool calls.
- **Self-review command:** `npm run format && npm run lint && npx vitest run --coverage && claude --print --permission-mode bypassPermissions /google-review`
  - _Superseded._ The review no longer bypasses permissions — it runs under a
    read-only command policy (see [ADR-026](026-supervised-runs-in-a-terminal.md)) — and the
    four checks run as separate steps rather than an `&&` chain, so each records
    its own result. `format` was replaced by the repository's `format:check`:
    the former is `prettier --write`, and a review that reformats the code under
    review is not a review. See `src/runner/self-review-plan.ts`.

## Alternatives Considered

| Option                    | Why Rejected                                                   |
| ------------------------- | -------------------------------------------------------------- |
| Anthropic SDK (streaming) | Would require full tool-execution loop; no slash-skill support |
| MCP sidecar               | Additional process complexity; retired in ADR-020              |
| Claude Code MCP server    | Not yet available as a stable subprocess interface             |
