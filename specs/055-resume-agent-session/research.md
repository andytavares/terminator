# Research: Resume an agent session

Every decision below is grounded in the code as of `712b7d97`, or in a live run against Claude Code 2.1.273. The live runs are named where they matter, because the whole feature rests on behaviour no document promises.

## R1. Where the resume id comes from

**Decision**: A `SessionStart` hook, merged into the operator's own Claude settings (`~/.claude/settings.json`), writes what it is told about each conversation. Terminator installs it once at startup, identifiable and idempotent, in the shape of `installProjectHook`.

**Rationale**:

- Verified live: the hook's stdin payload carries `session_id`, `transcript_path`, `cwd`, `hook_event_name` and `source` (`startup` on a fresh session, `resume` on a resumed one). Nothing else the application can see carries the conversation id.
- `--settings <file>` is a launch flag with no environment equivalent (`claude --help`), so a `claude` the operator types themselves can only be covered by a settings file Claude already reads.
- Terminator's existing hook is installed **only in projects with a linked issue** (`syncProjectContext` in `src/main/integrations/context-sync.ts`), which would leave most branches uncovered.
- A user-level hook is one entry in one file, covers every branch and folder, and writes nothing into the operator's repositories. Verified live with `HOME` pointed at a temporary directory: the hook fired, and Claude left the settings file as written.

**Alternatives considered** (the operator chose the first):

- **Per repo**: extend today's per-project install to every branch Terminator knows. Covers hand-started sessions, but writes `.claude/settings.local.json` into every repository.
- **Only what Terminator launches**: pass `--settings` when the application starts the agent. Installs nothing anywhere, but a `claude` typed by hand can never be resumed, which is the common case (US4).
- **Read the transcript directory** (`~/.claude/projects/<slug>/*.jsonl`) and guess by time: no reliable mapping when two terminals on one branch start seconds apart.

**Kept separate** from the existing per-project context hook: that one exists to feed an issue in, is removed when a link goes, and its script reads a context file. Two hooks with one job each, both merged by Claude, beats one script with two reasons to change.

## R2. Which terminal a conversation belongs to

**Decision**: `terminal:create` adds `TERMINATOR_SESSION_ID` to the PTY's environment, beside the existing `TERMINATOR_ISSUE_KEY`. The hook reads it from its own environment.

**Rationale**: Verified live — with `TERMINATOR_SESSION_ID=pty-abc123` set on the process that ran `claude`, the hook logged `{"session_id": "b610a882…", "source": "startup", "terminal": "pty-abc123"}`. The hook runs beneath the agent, which runs in the terminal, so ordinary process inheritance carries it. This is exact, unlike matching on time or folder, and it works for a conversation started by hand in a Terminator terminal.

**Consequence**: a `claude` run in a terminal outside Terminator has no such variable. Its line names no terminal, and is ignored rather than guessed at.

## R3. How the hook reaches the main process

**Decision**: The hook writes one small JSON file per terminal, `userData/agent-sessions/<terminal id>.json`, replacing whatever was there. The main process watches that directory and folds each change into the session's record.

**Rationale**:

- One file per terminal is last-write-wins, which is exactly the rule for a terminal that hosted a second conversation (FR-004). An append-only log would need parsing and pruning to say the same thing.
- A file is the only channel available: the hook is a separate process with no route into the application, and giving it one is a far larger surface than a file the application already owns.
- Watching gives SC-001 its 5 seconds without polling.

**Alternatives considered**:

- **One append-only log**: grows without bound, needs de-duplication per terminal on every read.
- **Poll on Home opening**: simpler, but a session started while Home is open would not become resumable until it is reopened.

## R4. Where the resume facts live

**Decision**: `SessionRecord` (feature 054) gains `agent: { provider, sessionId, transcriptPath, cwd, capturedAt } | null`. A record now exists when a session has **a description, its own link, or a captured conversation**, and is pruned 30 days after close as before.

**Rationale**: The record is already the per-session thing that survives a restart, is closed by `terminal:close` and swept at startup, and is already read by Home and the wall. A second store would duplicate its lifecycle.

**Consequence for 054's rule**: "a record exists only while it has a description or a link" widens by one clause. The delete-when-empty rule now also requires no captured conversation.

## R5. Whether a conversation can still be resumed

**Decision**: The main process stats the recorded `transcriptPath` when it lists records and when one changes, and reports `resumable: boolean` beside each record. Home and the wall offer Resume only when it is true.

**Rationale**: The operator must not be offered a button that fails (US3). A stat of a few hundred paths is cheap, and it is the only check that catches a transcript deleted behind the application's back — including a record carried to a different machine.

**Alternatives considered**: offer Resume always and let the agent report the failure in the terminal — rejected by the spec's FR-008.

## R6. Resuming

**Decision**:

- `terminal:create` gains an optional `initialCommand`. After the PTY spawns, the main process writes that line into it.
- Resume builds the line from the record with a pure `resumeCommand(agent)` → `claude --resume <id>` for `provider: 'claude'`, and `null` for anything else.
- The new terminal opens on the session's branch, in the recorded `cwd`.

**Rationale**:

- Typing into a fresh PTY is the technique the runtime already uses to launch agents, and a short line is well inside the 1024-byte canonical-input limit that mangled a long one before (`project_pty_max_canon_truncates_launches`).
- Building the command from the provider keeps a second agent a matter of one more branch, rather than `claude` written through the codebase.

**Open, and answered in quickstart §4**: whether a line written immediately after spawn is delivered once the shell is ready. It is buffered by the line discipline in principle; the live check proves it rather than assuming.

## R7. What happens to the old session

**Decision**: One main-process call, `session-records:transfer`, moves a record's description, link and agent facts to the newly created session, and deletes the old record. The renderer then closes the exited terminal, if it still has one.

**Rationale**:

- The operator chose "the resumed terminal replaces the exited one", so the exited tab closes (FR-012) and the conversation ends up with one terminal.
- Two writes from the renderer (write the new, forget the old) can half-fail and leave the same context on two sessions. One call cannot.
- The conversation keeps its id when resumed — verified live, the hook fired again with the same `session_id` and `source: "resume"` — so the transferred agent facts stay correct, and the hook confirms them within seconds.

## R8. Removing the hook again

**Decision**: The installer is idempotent and identifiable (its command names Terminator's own script path), and the user guide says how to remove it by hand. No removal code ships, because nothing in the application would call it.

**Rationale**: Constitution X forbids dead exports. A settings toggle to turn capture off is speculative until the operator asks for one; the entry is one block in a file they own, and the guide names it.
