# Contract: `session-records:*` additions

Extends feature 054's channels. Same conventions: Zod-validated, errors as envelopes, never thrown across the boundary.

## `session-records:list` (changed)

Each record in `data` gains:

- `agent: AgentConversation | null`
- `resumable: boolean` — the transcript exists on this machine right now. Always false when `agent` is null.

## `session-records:changed` (changed)

The pushed record carries the same two fields, so a conversation captured while Home is open appears without a reload.

## `session-records:transfer` (new, invoke)

**Input**: `{ fromSessionId: string; session: SessionSnapshot }` — the snapshot of the newly created session.

**Behaviour**: moves the old record's description, link and agent facts onto the new session, and deletes the old record. One write, so the two can never both hold the same context.

**Output**: `{ data: SessionRecord | null }` — the new record, or `null` when the old session had none.

**Errors**: `VALIDATION_ERROR` for a bad payload.

## `terminal:create` (changed)

Input gains `initialCommand?: string` — a single line written into the PTY once it is spawned. Rejected if it contains a newline: one line, one command, so nothing can be smuggled in behind it.
