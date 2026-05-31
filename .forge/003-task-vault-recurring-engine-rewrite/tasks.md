# Tasks — 003-task-vault-recurring-engine-rewrite

<!-- find-reuse:
  - computeNextDueDate exists in extensions/task-vault/src/vault/recurrence.ts — reuse and extend (do not replace wholesale)
  - hasColumn migration guard exists in extensions/task-vault/src/vault/db.ts — follow same pattern for new columns
  - localDate() utility exists in recurrence.ts — reuse in ensureNextOccurrence
  - No existing ensureNextOccurrence, parseRecurrenceRule, or RecurrenceRule type found anywhere
-->

---

## T-001 — Add recurrence columns and unique index to tasks schema

**Description:** The tasks table currently stores all recurrence state inside an opaque JSON metadata blob. Three first-class columns must be added — a rule column encoding the recurrence interval and days, a template-link column pointing each spawned instance back to its origin task, and a notification-time override column — along with a unique index preventing duplicate future instances at the database level. A data migration must run on existing databases, reading the old metadata keys (accounting for the double-encoded JSON bug in recurrence_days) and populating the new columns so no user data is silently lost.

**Acceptance criteria:**

- On a fresh database, all three new columns and the unique index exist after `initDb` completes.
- On an existing database that has tasks with recurrence metadata (`recurrence_interval`, `recurrence_days`, `recurrence_time`), those tasks have their `recurrence_rule` and `recurrence_notify_at` columns populated after `initDb` completes.
- Running `initDb` twice on the same database produces no error and no data change (idempotent migration).
- Attempting to insert two rows with the same `recurrence_template_id` and `due_date` raises a constraint error.
- The migration correctly handles the double-encode case where `recurrence_days` in metadata is a JSON string of a JSON array (e.g., `"\"[1,3]\""`) rather than a plain array.

**Depends on:** (none)
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-002 — Refactor recurrence.ts: typed rule, parser, no silent no-op

**Description:** The current `computeNextDueDate` function accepts a bare string interval and a separate days array, and silently returns the input date unchanged when given an unrecognised interval — making bugs invisible at the call site. Replace this with a `RecurrenceRule` discriminated union type, a `parseRecurrenceRule` function that throws a typed error on invalid input (eliminating the separate days parameter and the double-encode problem), and update `computeNextDueDate` to accept the typed rule and throw rather than no-op. Preserve the existing monthly date-overflow behaviour (Jan 31 + 1 month = Mar 2) as documented accepted behaviour.

**Acceptance criteria:**

- `parseRecurrenceRule('weekly:1,3')` returns a typed value with kind `'weekly'` and days `[1, 3]`.
- `parseRecurrenceRule('unknown-value')` throws a typed `InvalidRecurrenceRuleError` (not `undefined`, not the input date).
- `computeNextDueDate` called with a daily rule on `'2026-01-31'` returns `'2026-02-01'`.
- `computeNextDueDate` called with a monthly rule on `'2026-01-31'` returns `'2026-03-02'` (overflow preserved).
- All pre-existing tests in `recurrence.spec.ts` pass after call-site updates.

**Depends on:** (none)
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-003 — Implement `ensureNextOccurrence` core function

**Description:** The central piece of the new engine is a single idempotent function that enforces one invariant: for any recurring task, exactly one `status='open'` future instance must exist in the database. If a future instance already exists, the function does nothing. If none exists, it computes the next due date from the most recent instance's due date (strict mode: always from the previous due date, never from the completion date), checks end conditions, and inserts the new instance in a transaction. This function is the only place that ever inserts a new occurrence row; the scheduler never calls it.

**Acceptance criteria:**

- Calling the function on a recurring task with no existing future instance creates exactly one new row with `due_date` = previous due date + interval.
- Calling the function a second time on the same task creates no additional rows (idempotent).
- Calling the function on a task where `recurrence_rule` is NULL does nothing.
- When `recurrence_end_type = 'after_count'` and the count is exhausted (`completed_count + 1 >= end_count`), no new row is inserted.
- When `recurrence_end_type = 'on_date'` and the computed next due date is after the end date, no new row is inserted.
- The new instance row has `recurrence_template_id` pointing to the original template task (not to an intermediate instance).
- The insert operation is atomic — if the transaction fails, no partial row is written.

**Depends on:** T-001, T-002
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-004 — Wire `ensureNextOccurrence` into `complete-task` IPC handler

**Description:** The current `complete-task` handler marks a task done but has no awareness of recurrence — completing a recurring task is a dead end that produces no next occurrence. Update the handler to call `ensureNextOccurrence` after marking the task complete, inside the same database transaction so that if either operation fails, both roll back. Surface transaction failures as a structured error response rather than a silent swallow. Broadcast `task-vault:recurrence-spawned` after a successful commit when a new occurrence was created.

**Acceptance criteria:**

- Completing a recurring task with a daily rule creates exactly one new row with the correct next due date.
- Completing a non-recurring task creates no new row.
- If the database transaction fails, the task remains `open` and no new row is created; the handler returns `{ error: string }`.
- Completing a recurring task that has already reached its end condition creates no new row.
- The `task-vault:recurrence-spawned` event is broadcast if and only if a new instance was created.

**Depends on:** T-003
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-005 — Wire `ensureNextOccurrence` into `set-recurrence` and startup gap-fill

**Description:** Two additional trigger points must call `ensureNextOccurrence`: the `set-recurrence` IPC handler (so the first future occurrence is immediately visible after a rule is applied) and the database initialisation function (so occurrences missed while the app was closed are created on next launch). The `set-recurrence` handler must also call `ensureNextOccurrence` inside its transaction. The startup gap-fill must handle the case where the app was closed for multiple days by running the invariant check for every recurring task whose most recent instance is in the past. The `clear-recurrence` handler must delete all future open instances and null out the column.

**Acceptance criteria:**

- After calling `set-recurrence` on a task, a future open instance with the correct due date exists in the database immediately, without requiring any other action.
- Calling `set-recurrence` twice replaces the old future instance rather than creating a duplicate (enforced by the unique index).
- After `initDb` on a database containing a recurring task whose sole instance has a past due date and no future instance, a new future instance is created.
- Running `initDb` twice does not create a second future instance (idempotent gap-fill).
- After calling `clear-recurrence`, the task's `recurrence_rule` is NULL and all future open instances are deleted.

**Depends on:** T-003
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-006 — Remove spawn block from task-scheduler.ts

**Description:** With `ensureNextOccurrence` wired into all three trigger points, the spawn block inside the notification scheduler (lines 181–248) is now dead code that creates duplicate occurrences and races against the new engine. Remove it entirely. The scheduler tick loop must only query for and send due-date notifications; it must never write task rows. Update the scheduler's database query to remove any recurrence-specific field fetches that were only needed for the removed spawn logic. Rewrite the now-obsolete spawn-from-scheduler tests to assert that the scheduler does not create task rows.

**Acceptance criteria:**

- The scheduler source contains no `INSERT INTO tasks` statement.
- The scheduler source contains no reference to `recurrence_next_spawned`.
- Firing a scheduler tick on a recurring task whose due date has passed does not create a new task row.
- Due-date notification behaviour is unchanged: the notification fires when `due_date <= today`.
- All notification-related tests continue to pass.

**Depends on:** T-004, T-005
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-007 — Remove old recurrence metadata reads and writes

**Description:** After the column-based engine is live, all reads and writes of the old metadata keys (`recurrence_interval`, `recurrence_days`, `recurrence_time`, `recurrence_next_spawned`, `notification_notified_date`) must be removed. The `rowToTask` mapping function must derive recurrence fields from the new columns rather than the metadata blob. The `set-recurrence` handler must write only to columns, not to the metadata blob. Any backward-compatibility metadata writes added during the transition must be removed.

**Acceptance criteria:**

- No production code path reads `meta.recurrence_interval`, `meta.recurrence_days`, `meta.recurrence_time`, `meta.recurrence_next_spawned`, or `meta.notification_notified_date`.
- No production code path writes any of those metadata keys.
- `rowToTask` returns correct `recurrenceRule` and `recurrenceNotifyAt` values derived from the SQL columns, not the metadata blob.
- All existing tests that assert on `task.recurrenceInterval` or `task.recurrenceDays` pass (values now come from the column parse, same values).

**Depends on:** T-005, T-006
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-008 — Fix recurrence-spawned event handler to refresh today view

**Description:** The renderer event handler for `task-vault:recurrence-spawned` currently only calls `tickCalendar()`, which updates the mini-calendar but leaves the today task list stale. A user completing a recurring task sees the new occurrence only after manually navigating away and back. Update the handler to also call `loadToday()` (or the equivalent date-specific load function for the currently viewed date) so the view refreshes immediately.

**Acceptance criteria:**

- After a recurring task is completed, the today view updates to show the new occurrence without any manual navigation.
- The mini-calendar is still updated (existing `tickCalendar` call is preserved).
- A component-level test confirms that `loadToday` is called when the `task-vault:recurrence-spawned` event fires.

**Depends on:** (none)
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-009 — Clean up IndexedTask type and remove stale recurrence fields

**Description:** The `IndexedTask` type currently declares nine separate `recurrence*` fields sourced from metadata keys that no longer exist. After the column migration and metadata cleanup, update the type to reflect the new data model: remove fields that came from the deleted metadata keys, add typed fields for the new columns, and ensure all renderers that read recurrence state from tasks use the updated field names. This is the final cleanup task that confirms no dead type surface remains.

**Acceptance criteria:**

- The `IndexedTask` type contains no field sourced from a deleted metadata key (`recurrenceInterval`, `recurranceDays`, `recurrenceTime`, `recurrenceNextSpawned`, `notificationNotifiedDate`).
- The type exposes `recurrenceRule: string | null`, `recurrenceTemplateId: string | null`, and `recurrenceNotifyAt: string | null` derived from the SQL columns.
- `npm run lint` passes with 0 errors after the type change (all call sites updated).
- `npm run build` succeeds with 0 type errors.

**Depends on:** T-007
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-010 — Update ARCHITECTURE.md for new recurrence model

**Description:** The architecture documentation must describe the new recurrence model so future maintainers understand the design: the distinction between template tasks and instance tasks, the column-based rule format, the three trigger points for `ensureNextOccurrence`, and why the scheduler no longer writes task rows.

**Acceptance criteria:**

- `docs/ARCHITECTURE.md` contains a section or paragraph describing the Task Vault recurring task model.
- The documentation describes the `recurrence_rule` column format, the `recurrence_template_id` link, and the three trigger points.
- The documentation notes that the scheduler is notification-only and never creates task rows.

**Depends on:** T-007
**Tags:** `docs-only`
**Touches tested package:** no
**Touches documented module:** no
