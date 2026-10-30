# Task Vault Extension

GTD+BuJo+PARA daily productivity system backed by the shared SQLite database.

## Features

- **Daily Log** — open the Task Vault tab to see today's tasks, events and notes
- **Quick Capture** — an OS-level global hotkey opens a floating overlay from any app
- **Projects Browser** — lists projects with stale detection
- **Inbox Processing** — the GTD clarify flow for inbox items
- **Recurring Tasks** — set daily/weekly/biweekly/monthly recurrence on any task. The engine keeps exactly one future open instance at all times.

## Areas: archive and restore

Archiving an area archives its projects and cancels its unfinished tasks, subtasks included. Each change is recorded with the status it replaced (table `area_archive_changes`). Restoring the area puts back exactly those statuses and nothing else. Tasks you cancelled and projects you parked or archived before stay as they were. Areas archived before this record existed are restored the old way. Their projects reactivate, and tasks cancelled at the archive time (directly in the area or its projects, not subtasks) reopen.

## Stale tasks

An open task left on Today rolls over each day. `today_since` records when it first landed there. After it has rolled over for `terminator.task-vault.staleThresholdDays` days (Settings → Task Vault → **Stale Task Threshold (days)**, 7 by default, 1–365), Today marks it stale (`src/stale-threshold.ts`). `task-vault:settings:set-stale-threshold` writes the same setting for a remote client. Earlier versions kept the threshold in the `settings` table as `stale_days_threshold`. Activation moves that value into the setting once and deletes the row. Project staleness is separate: a project is stale when it has no open next action.

## Export and import

Export writes tasks, projects and areas as JSON. Import into another database keeps each project's area, each task's project and area, and each area's status (through ids; the import still reads the older `area`/`project` name fields). Import skips rows whose id already exists.

## Reset

The **Reset (delete all data)** setting deletes every task, project and area, and Task Vault's own rows in the shared `settings` table (those with `extension_id = 'task-vault'`). It does not touch the settings rows of other extensions.

## Task ID format

Task IDs are UUIDs assigned at creation and stored in the shared SQLite database (`app.sqlite`). IDs are stable across restarts. A `{ error: 'STALE_ID' }` response means the task no longer exists (for example, it was deleted or migrated).

See also: [`specs/005-task-vault-extension/quickstart.md`](https://github.com/andytavares/terminator/blob/8e1f355937df5328fc4e8fc52f5d1e794e949a6b/specs/005-task-vault-extension/quickstart.md) for integration scenarios. `specs/` is no longer in the repository; the link opens the last version.
