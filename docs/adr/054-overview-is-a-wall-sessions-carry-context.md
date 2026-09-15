# ADR 054: Overview is a wall, and sessions carry their own context

**Status**: Accepted

**Date**: 2026-09-15

**Supersedes**: [ADR 036](036-the-board-is-one-grid.md) as the Overview layout. Its one-grid invariant is kept.

## Context

The state-columned board answered "which terminal is in what state". It did not answer the question the operator actually asks when they come back to the app: which session, in which workspace and project, is working on what. And when a session has no ticket, it offered no answer to "why is this open?"

Three facts in the code shaped the answer:

1. **Sessions do not survive a restart.** `TerminalSession` lives only in the renderer's memory. The one-line `note` added for this purpose vanished at quit, which is exactly when context is lost.
2. **Work items are linked per project.** `issue-link-store` holds one issue per project, and the agent's SessionStart context injection is keyed on it.
3. **Needs-you is inferred from the terminal bell.** Claude Code rings it only when the user has configured a bell notification channel, so any feature that waits for `awaiting-input` would rarely see it.

## Decision

1. **The Overview tab is a wall of live tiles.** Sessions awaiting input are pinned as double-width tiles in a Needs you band. Tiles remain direct children of one grid, emitted in `sessionId` order, and move between bands by style alone. `mountPreview` moves the one live xterm node into its tile, so re-parenting a tile would tear the preview out. That was ADR 036's reason for one grid, and it still holds.
2. **Home is the launch view.** It shows every session as a Ledger (rows by workspace/project) or a Logbook (list plus detail), and the choice persists.
3. **A session's description and its own work item link are persisted per session**, in a main-process `session-record-store` (`userData/session-records.json`), in the same shape as `issue-link-store`:
   - A record exists only while a session has either one.
   - `terminal:close` stamps its close time, and a startup sweep closes anything left open, because nothing can be open at startup.
   - Records are pruned 30 days after close.
   - The in-memory `note` is removed. The description replaces it, so there is one field.
4. **A session's work item is its own link, else its project's.** The project link, and the context injection keyed on it, are unchanged. A session link is organisation and display only, because there is no supported way to re-inject context into a session that has already started.
5. **A visible numbered-choice prompt counts as awaiting input**, alongside the bell. `parseChoicePrompt` runs on each busy → idle transition through the existing `AgentStateSource` seam. Answering in place re-parses before it sends, and sends nothing if the prompt changed.
6. **Home and wall preferences persist** in `localStorage`. This reverses the Overview's earlier choice not to persist its layout: the operator asked for a configured homepage, and filters stay unpersisted so the view never opens narrowed.

## Alternatives considered

- **Keep the board and add columns for work items.** Rejected: state as the primary axis is what hid the work item. Mockup B (columns by ticket) was reviewed and not chosen.
- **Store records in PGlite.** Rejected: async reads on a render-time path, for a few hundred rows.
- **Generalise `IssueLink` to sessions.** Rejected: every existing project-link reader would need a guard for a case it never handles.
- **Consume Claude Code `Notification` hooks for needs-you.** Rejected: those hooks belong to extensions (Principle II), and a shell-started `claude` has none.
- **Stamp close times on `before-quit`.** Rejected: races the quit. The startup sweep is deterministic.

## Consequences

- `BoardScreen`, `board-lanes.ts`, the hidden-lanes preference, the session note, and their tests are deleted.
- A prompt shaped like a numbered list that is not a question (for example, a numbered log at the bottom of the screen) can read as needs-you. The parser requires ≥ 2 options numbered 1..n in the bottom half of the screen, with a line above, which bounds but does not remove this.
- Whether a bare digit confirms a Claude Code select option is observed, not documented. It is verified live before release, and a change there is confined to `answerChoice`.
