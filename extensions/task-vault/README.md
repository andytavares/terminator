# Task Vault Extension

GTD+BuJo+PARA daily productivity system backed by plain markdown files.

## Features

- **Daily Log** — open Task Vault tab to see today's tasks, events, notes
- **Quick Capture** — OS-level global hotkey opens floating overlay from any app
- **Projects Browser** — list projects with stale detection
- **Inbox Processing** — GTD clarify flow for inbox items
- **Weekly Review** — full review payload including stale projects and completed tasks
- **Recurring Tasks** — set daily/weekly/biweekly/monthly recurrence on any task; the engine automatically ensures exactly one future open instance exists at all times

## Task ID format

Task IDs are UUIDs assigned at creation and stored in SQLite. IDs are stable across restarts. A `{ error: 'STALE_ID' }` response means the task no longer exists (e.g. it was deleted or migrated).

See also: `specs/005-task-vault-extension/quickstart.md` for integration scenarios.
