# Task Vault Extension

GTD+BuJo+PARA daily productivity system backed by the shared SQLite database.

## Features

- **Daily Log** — open Task Vault tab to see today's tasks, events, notes
- **Quick Capture** — OS-level global hotkey opens floating overlay from any app
- **Projects Browser** — list projects with stale detection
- **Inbox Processing** — GTD clarify flow for inbox items
- **Weekly Review** — full review payload including stale projects and completed tasks. Every review is persisted: each promote, archive, backlog, delete, keep, project status change, and inbox decision is recorded against the review, alongside the reflection answers. Past reviews are browsable from the review's **History** button and exportable as Markdown
- **Recurring Tasks** — set daily/weekly/biweekly/monthly recurrence on any task; the engine automatically ensures exactly one future open instance exists at all times

## Areas: archive and restore

Archiving an area archives its projects and cancels its unfinished tasks, subtasks included. Each change is recorded with the status it replaced (table `area_archive_changes`), so restoring the area puts back exactly those statuses and nothing else: tasks you cancelled and projects you had parked or archived before stay as they were. Areas archived before this record existed restore the area only.

## Export and import

Export writes tasks, projects and areas as JSON. Import into another database keeps each project in its area (via `area_id`; the older `area` name field is still read). Import skips rows whose id already exists.

## Reset

The **Reset (delete all data)** setting deletes every task, project and area, and Task Vault's own rows in the shared `settings` table (those with `extension_id = 'task-vault'`). Other extensions' settings rows are left untouched.

## Task ID format

Task IDs are UUIDs assigned at creation and stored in the shared SQLite database (`app.sqlite`). IDs are stable across restarts. A `{ error: 'STALE_ID' }` response means the task no longer exists (e.g. it was deleted or migrated).

See also: `specs/005-task-vault-extension/quickstart.md` for integration scenarios.
