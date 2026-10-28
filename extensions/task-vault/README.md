# Task Vault Extension

GTD+BuJo+PARA daily productivity system backed by the shared SQLite database.

## Features

- **Daily Log** — open Task Vault tab to see today's tasks, events, notes
- **Quick Capture** — OS-level global hotkey opens floating overlay from any app
- **Projects Browser** — list projects with stale detection
- **Inbox Processing** — GTD clarify flow for inbox items
- **Recurring Tasks** — set daily/weekly/biweekly/monthly recurrence on any task; the engine automatically ensures exactly one future open instance exists at all times

## Areas: archive and restore

Archiving an area archives its projects and cancels its unfinished tasks, subtasks included. Each change is recorded with the status it replaced (table `area_archive_changes`), so restoring the area puts back exactly those statuses and nothing else: tasks you cancelled and projects you had parked or archived before stay as they were. Areas archived before this record existed are restored the old way: their projects reactivate, and tasks cancelled at the archive time (directly in the area or its projects, not subtasks) reopen.

## Stale tasks

An open task left on Today rolls over each day; `today_since` records when it first landed there. Once it has rolled over for `terminator.task-vault.staleThresholdDays` days (Settings → Task Vault → **Stale Task Threshold (days)**, 7 by default, 1–365), Today marks it stale (`src/stale-threshold.ts`). `task-vault:settings:set-stale-threshold` writes the same setting for a remote client. Versions before this kept the threshold in the `settings` table as `stale_days_threshold`; activation moves that value into the setting once and deletes the row. A project's staleness is separate: it is stale when it has no open next action.

## Export and import

Export writes tasks, projects and areas as JSON. Import into another database keeps each project's area, each task's project and area, and each area's status (via ids; the older `area`/`project` name fields are still read). Import skips rows whose id already exists.

## Reset

The **Reset (delete all data)** setting deletes every task, project and area, and Task Vault's own rows in the shared `settings` table (those with `extension_id = 'task-vault'`). Other extensions' settings rows are left untouched.

## Task ID format

Task IDs are UUIDs assigned at creation and stored in the shared SQLite database (`app.sqlite`). IDs are stable across restarts. A `{ error: 'STALE_ID' }` response means the task no longer exists (e.g. it was deleted or migrated).

See also: `specs/005-task-vault-extension/quickstart.md` for integration scenarios.
