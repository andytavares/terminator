# Data Model: Resume an agent session

## AgentConversation (persisted, part of a SessionRecord)

What is needed to bring one conversation back.

| Field            | Type           | Rule                                                                                      |
| ---------------- | -------------- | ----------------------------------------------------------------------------------------- |
| `provider`       | `'claude'`     | The agent whose resume mechanism this is. A union, so a second can join.                  |
| `sessionId`      | `string`       | The agent's own id for the conversation. Stable across resuming.                          |
| `transcriptPath` | `string`       | Absolute path the agent reported. Its existence is what makes the conversation resumable. |
| `cwd`            | `string`       | The folder the conversation ran in, which the resumed terminal opens in.                  |
| `capturedAt`     | `string` (ISO) | When the agent last reported it, fresh start or resume.                                   |

## SessionRecord (changed, from feature 054)

| Change                             | Why                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `agent: AgentConversation \| null` | What Resume needs.                                                                         |
| Existence rule widened             | A record is kept while it has a description, its own link, **or** a captured conversation. |
| `resumable: boolean` (derived)     | Reported beside each record, never stored: the transcript is stat'd on read.               |

Retention is unchanged: 30 days past close, then the record and its conversation facts go together.

**Lifecycle**

```
(none) ──agent reports a conversation──► open, with agent facts
open ──second conversation in the same terminal──► agent facts replaced
open ──terminal:close / startup sweep──► closed, still resumable
closed ──transcript deleted──► listed, not resumable
closed ──resumed──► transferred to the new session, old record gone
closed ──30 days──► pruned
```

## HookReport (written by the hook, read by the main process)

One file per terminal at `userData/agent-sessions/<terminalSessionId>.json`, replaced on each write.

| Field            | Type           | Rule                                                               |
| ---------------- | -------------- | ------------------------------------------------------------------ |
| `terminal`       | `string`       | From `TERMINATOR_SESSION_ID`. A report without one is not written. |
| `provider`       | `string`       | `claude`.                                                          |
| `sessionId`      | `string`       | From the hook payload's `session_id`.                              |
| `transcriptPath` | `string`       | From `transcript_path`.                                            |
| `cwd`            | `string`       | From `cwd`.                                                        |
| `source`         | `string`       | `startup` or `resume`, as reported. Recorded, not acted on.        |
| `at`             | `string` (ISO) | When the hook ran.                                                 |

Anything malformed is ignored: a report that cannot be read must never stop a session starting, and never take the record with it.

## ResumePlan (derived, renderer)

`planResume(facts, record)` → `{ projectId, cwd, command } | null`

- `null` when the session is running, has no conversation, or is not resumable.
- `command` comes from `resumeCommand(agent)`: `claude --resume <sessionId>` for `provider: 'claude'`.
