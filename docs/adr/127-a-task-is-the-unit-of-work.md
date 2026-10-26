# ADR 127: A task is the unit of work

**Status**: Accepted

**Date**: 2026-10-24

Amends ADR 035 (the sidebar stops at the branch) and ADR 054 (Overview is a wall, and sessions carry their own context).

## Context

The same change looked different on every screen. The Desk grouped sessions by work thread, the sidebar by repo and branch, and Overview by session state. A change that spans repos, such as `rate-limits` in `terminator`, `api-gateway` and `web-console`, showed as three unrelated rows on the Desk and in three places in the sidebar. Only a Linear or Jira ticket joined them, and many changes have none.

The Desk also stated things it did not know:

- **A stage pipeline** (Shaping, Building, In review, Merging, Shipped) assumed every piece of work follows one path. It read "Building" whenever it had no evidence.
- **Waiting on others** was the fallback for anything not yours and not running.
- **Running** came from bytes arriving in the terminal, so a thinking agent that printed nothing read as idle.
- **Parked** was a 48-hour timer, not a decision.
- **Plan today** took 250px of every day, including days it had nothing to say.

## Decision

1. **A task is stored and groups lanes.** A lane is a repo and a branch (`src/shared/schemas/tasks.schema.ts`). A task holds a title, its lanes, an optional ticket, whether it is today's focus, and when it was marked done or archived. A lane belongs to at most one task. The main process keeps tasks in `userData/tasks.json` (`src/main/tasks/task-store.ts`, `src/main/ipc/task.ipc.ts`), in the shape of the session record store, and the renderer mirrors them (`src/renderer/stores/task.store.ts`).
2. **A work thread joins by lane, then task, then ticket, then branch** (`src/renderer/home/work-threads.ts`). A branch in no task is still a one-lane thread, so nothing is migrated and existing threads are unchanged.
3. **Every state is a fact, or says it is a guess.** A task has one of five states (`src/renderer/home/task-state.ts`): needs you, running, waiting on others, quiet, done. Each comes from something the app knows:

   | State              | Set by                                                                                                       |
   | ------------------ | ------------------------------------------------------------------------------------------------------------ |
   | Needs you          | An agent's reported question, a failed check, or a review that is yours                                      |
   | Needs you, guessed | A bell, or a numbered choice on screen. Drawn hollow, and the drawer names the signal                        |
   | Running            | A Claude Code turn in progress (UserPromptSubmit seen, no Stop since); for a plain terminal, output just now |
   | Waiting on others  | Checks running, a review requested, or a merge queue. Never a fallback                                       |
   | Done               | Every lane's pull request merged and its sessions closed, or you pressed Mark done                           |
   | Quiet              | None of the above                                                                                            |

   A task takes the most urgent state among its lanes. A guessed ask goes into the Needs you queue below the reported ones: a missed ask leaves an agent waiting for good, and a false one costs a glance.

4. **The stage pipeline is removed.** `furthestStage`, the stage bar and its captions are deleted, not moved. Foundry orders keep their own stages inside Foundry, where the order really does follow one line.
5. **Running comes from Claude Code's own hooks.** Beside its existing `Notification` and `SessionStart` entries, core adds `UserPromptSubmit` and `Stop` entries to `~/.claude/settings.json` (`src/main/agents/agent-ask-hook.ts`). They mark a turn (`src/main/agents/agent-turns.ts`). Byte flow remains only for a terminal that never reported a turn.
6. **Nothing is parked or finished by a timer.** `PARKED_AFTER_MS` and the waiting-on-others fallback are deleted. You press Mark done or Archive, and a quiet task stays quiet until something happens on it.

### Amends ADR 035

- The sidebar still lists repos and branches only; a terminal is still not a row.
- **Grouping gains `Task`.** ADR 035 narrowed `GroupKey` to `'workspace' | 'none'`; it is now `'workspace' | 'task' | 'none'`. Under **Display → Group → Task**, each task is a header over its lanes as branch rows, and branches in no task sit under **Not in a task**. Workspace stays the default.
- A branch row and a terminal tab gain **Add to task…**.
- The tab bar shows a lane switcher for a task with two or more lanes. ADR 035's claim that the tab bar carries per-terminal state for "the branch you are in" now includes the other lanes of that task: the switcher marks one that is asking.

### Amends ADR 054

- **Home** is the Tasks layout by default: a pulse line, a plan strip, the Needs you queue, the task list and a footer. The Desk as ADR 054 left it stays as the **Classic** layout (setting `ui.homeLayout`). ADR 054's Ledger and Logbook choice is unchanged.
- **Needs-you** is no longer only inferred from the bell and the screen. A hook-reported ask is a fact; the bell and the choice prompt (decision 5 of ADR 054) remain, but are marked as guesses.
- **Overview** keeps its wall and its one grid. Its **Then by** gains **Task**, which bands tiles by task through order and style alone, so no tile is re-parented.
- The session description and per-session link (decisions 3 and 4 of ADR 054) are unchanged. A task's ticket joins before a branch's.
- The 48-hour parked group from the Desk is gone.

## Options considered

- **Tidy the Desk in place.** Rejected: it fixes the density but not the join. The cross-repo change stays three rows, and the stage bar stays a guess.
- **A board as Home.** Rejected: columns need a lifecycle every task shares, which is the false premise removed here. ADR 054 already replaced a state-columned board.
- **A separate agents window.** Rejected: a second window with its own store and focus, for something the operator wants on the first screen. It is the cost ADR 126 turned down for breakouts.
- **Tasks only through tickets.** Rejected: a spike, a config change and an incident have no ticket, and the case that hurt, one change in three repos, would stay unjoined.

## Consequences

- `tasks.json` is a new file of operator data. A task is created only when you start one, confirm Add to task…, or first rename, focus or add a lane to a task joined by ticket.
- The hook entries are added to a user-level Claude settings file that Claude Code runs for every session on the machine. The command returns at once outside a Terminator terminal.
- A Claude Code session whose hooks were removed reads Running only while output flows, as before.
- The Home screenshots in the user guide are retaken by `tests/e2e/tools/capture-session-home-screenshots.spec.ts`.
