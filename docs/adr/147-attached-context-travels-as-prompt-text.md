# ADR 147: Attached context travels as prompt text

**Status**: Accepted

**Date**: 2026-11-07

## Context

An operator in an agent tab wants to give the agent two kinds of context: another session (session context) and a passage of the agent's own earlier reply with a comment (citation). The context must reach the agent on every send path: prompt, steer and the queue. Each of these paths carries text only. Sources differ: a Claude session has a transcript file that its record names, a non-Claude agent tab has only the updates that main holds, and a shell has only its xterm scrollback in the renderer.

## Decision

The renderer writes attached context as text after the typed prompt (`promptWithContext` in `src/renderer/components/agent/attached-context.ts`).

- **Transcript reference.** A session whose record names a transcript file becomes one `<session … agent="…" transcript="…" />` line inside a `<terminator_context>` block. The agent reads the file with its own Read tool when it needs it.
- **Embedded text.** A session with no transcript file embeds its text in the same block: a digest of a non-Claude agent tab's history (`agents.history`, folded with `foldUpdates`), or a shell's scrollback. The text keeps its last 60,000 characters.
- **Citations.** Each citation becomes a `<citation>` with its quote and the operator's comment inside a `<citations>` block.
- **Labels.** Each block says its contents are reference material, not instructions. All text inside the blocks is escaped, so a quote cannot close a tag.
- **Display.** `splitAttachedContext` is the exact inverse. The transcript shows the typed text and chips, not the envelope.

## Alternatives

- **B. An ACP `resource_link` block with a `file://` URI.** It is the protocol's own way to reference context. But the Claude adapter turns it into the same text as this decision, and steer and the queue carry text only, so both need a schema change.
- **C. An embedded digest that main builds and sends as an ACP `resource` block.** The format is short and clean. It needs a new Claude JSONL parser, a size cap that cuts content, and the same steer and queue change as B. It spends context tokens whether the agent needs them or not.
- **D. A `read_session` tool on the Terminator MCP server (ADR 145).** It gives paging and a format that Terminator controls. It needs a new tool, a reader and paging code, and ACP sessions start with `mcpServers: []`, so the tool reaches the agent only through the operator's own Claude MCP configuration.

## Consequences

- No IPC, schema or Extension SDK change. Every ACP agent gets the context, because every agent takes text.
- The agent reads raw Claude JSONL, which is noisy. If agents use it badly, C or D can replace the transcript line in the same place in the prompt.
- Embedded text spends context tokens at send time and loses the start of long output.
- Main publishes the sent text as a `user_message_chunk`, so the transcript shows the message, and the renderer must split the envelope off before it draws a user message.
