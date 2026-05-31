# Spec: Task Vault Recurring Task Engine Rewrite

## Problem

Recurring tasks in the Task Vault extension are flaky. The current implementation
piggybacks spawn logic onto the due-date notification tick (task-scheduler.ts), which
creates at least seven failure modes:

1. Spawn blocked on restart by notification_notified_date early-exit
2. Completing a task before the tick prevents spawn (scheduler queries WHERE status='open')
3. No SQLite transaction around INSERT + UPDATE — crash between them creates duplicates
4. recurrence_days is double-encoded JSON — silent parse failure produces wrong weekly dates
5. computeNextDueDate silently returns the input date on unknown intervals
6. Spawn fires while the parent task is still open — users see two tasks at once
7. Today view doesn't refresh after spawn (only tickCalendar is called, not loadToday)

Additionally: if the user never marks a task complete, the next occurrence never appears
at all under a "spawn on completion only" model.

## Solution

Replace the scheduler-coupled spawn with a single idempotent function:

ensureNextOccurrence(db, taskId)

This function enforces the invariant: for every recurring task, exactly one
status='open' future instance exists in the DB. It is idempotent — calling it
multiple times produces the same result as calling it once.

Called at three trigger points:

1. App startup / initDb — covers days the app was closed
2. complete-task IPC handler — the completed task was the last future instance
3. set-recurrence IPC handler — immediately materializes the first occurrence

The scheduler (task-scheduler.ts) retains ONLY notification logic and NEVER
writes task rows.

## Recurrence model: strict (not flexible)

Next due_date is always previous_due_date + interval, regardless of completion date.
A weekly Monday task completed on Wednesday still shows next Monday. This matches
the current code behaviour and is less surprising for deadline-style tasks.

## Data model changes

Add three columns to the tasks table:
recurrence_rule TEXT -- 'daily' | 'weekly:1,3' | 'biweekly' | 'monthly' | NULL
recurrence_template_id TEXT -- FK to tasks(id) ON DELETE SET NULL; links instance to template
recurrence_notify_at TEXT -- HH:MM string override; NULL = global setting

A UNIQUE index on (recurrence_template_id, due_date) prevents DB-level duplicates.

Runtime-only metadata keys to remove (after columns are in place):
recurrence_next_spawned, notification_notified_date

Recurrence configuration keys stay in metadata (infrequently read):
recurrence_end_type, recurrence_end_date, recurrence_end_count, recurrence_completed_count

## Files to change

- extensions/task-vault/src/vault/db.ts — schema migration + backfill + unique index
- extensions/task-vault/src/vault/recurrence.ts — typed RecurrenceRule, parseRecurrenceRule, no silent no-op
- extensions/task-vault/src/ipc/vault.ipc.ts — set-recurrence, clear-recurrence, complete-task
- extensions/task-vault/src/notifications/task-scheduler.ts — remove spawn block (lines 181-248)
- extensions/task-vault/src/components/TaskVaultView.tsx — fix recurrence-spawned handler
- extensions/task-vault/src/vault/types.ts — clean up IndexedTask recurrence fields

## Cleanup

- Remove double-encoded recurrence_days metadata writes
- Remove recurrence_next_spawned and notification_notified_date metadata reads/writes
- Remove backward-compat metadata key writes once columns are fully live
- Remove spawn logic from task-scheduler.ts entirely
- Add UNIQUE constraint to prevent DB-level duplicate spawns

## Done criteria (per constitution)

- npm run format passes
- npm run lint exits with 0 errors
- npx vitest run --coverage passes with all thresholds >= 80% including
  recurrence.ts, task-scheduler.ts, vault.ipc.ts, db.ts
- docs/ARCHITECTURE.md updated to describe new recurrence model
