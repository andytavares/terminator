# ADR 143: A global scheduled run starts in Scratch

**Status**: Accepted

**Date**: 2026-11-06

## Context

Every scheduled run belonged to a workspace: Start work saved the workspace's folder as its `repo_root`. Some prompts belong to no repository, for example "Summarise yesterday's merged pull requests". The operator had to pick an unrelated workspace for them, and the run then made a worktree there.

## Decision

A global scheduled run belongs to no workspace. Start work offers **Global** first in the workspace picker, on the Prompt tab only.

- It starts in Scratch, with the home folder as its working directory.
- It runs only as an agent tab or Claude in a terminal. The schedule schema refuses another run-as, a branch, and a new worktree for it.
- Its missed-run ask in Needs you says "Global · …" where a workspace run names its repository (`src/main/home/schedules.ts`).
- The `schedules` table stores it with `repo_root = ''`. The column is `NOT NULL`, and SQLite cannot drop that constraint without a table rebuild. `src/main/home/schedules.ts` reads `''` as `repoRoot: null`, so no other code sees the empty string.

## Alternatives

- **Start it in every workspace**, as Across repos does, on a timer. This makes one worktree per repository for a prompt that needs none, and multiplies agents.
- **A folder picker** for each global run. This adds a field to Start work for a case the home folder already covers.
- **Rebuild the table** to make `repo_root` nullable. A rebuild copies every row and needs a migration that cannot be reverted by reverting the code. The `''` sentinel stays inside one file.

## Consequences

- A global run has no branch or worktree: its agent works in the home folder.
- Home's Scheduled view groups global runs first, under "Global".
- Code that reads the `schedules` table directly must treat `repo_root = ''` as no workspace.
