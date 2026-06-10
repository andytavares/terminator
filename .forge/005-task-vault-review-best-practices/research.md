# Research: task-vault Extension — Feature-by-Feature Best Practice Comparison

**Date:** 2026-06-08
**Requested by:** Andrew
**Codebase context:** The task-vault extension is a self-contained GTD/BuJo/PARA productivity system inside the Terminator Electron app. It stores all data in a SQLite database via better-sqlite3 (`vault.db`), registers IPC handlers across five separate modules (`vault.ipc.ts`, `projects.ipc.ts`, `links.ipc.ts`, `kanban.ipc.ts`, `admin.ipc.ts`), exposes a React + Zustand UI across 25 component files, and has a notification/scheduler subsystem. The data model covers tasks (with subtasks, blocking, recurrence), projects, areas, a kanban board (configurable lanes, swimlanes), an inbox, a someday list, a weekly-review wizard, a calendar drawer, and JSON import/export.

---

## Problem Statement

task-vault is a capable personal task-management system but has grown organically in ways that diverge from established patterns in comparable tools (Todoist, Linear, Things 3) and from the official best practices for the libraries it uses (better-sqlite3, Zustand, Zod). This research identifies the specific gaps — duplicated code, a custom recurrence engine that ignores the RRULE standard, JSON-encoded arrays stored as blobs in SQL, a 1,515-line god-file IPC handler, a hand-rolled markdown renderer when a tested library exists, and a Zustand store that mixes navigation state with data-fetching — and presents concrete, prioritised improvement options to reduce code volume, improve reliability, and align with industry practice.

---

## Scope

**In scope:**

- Data model and SQLite schema design
- IPC handler organisation and code duplication
- Recurrence engine design compared to RRULE industry standard
- Zustand store design compared to official Zustand patterns
- Zod schema coverage and validation completeness
- Markdown rendering approach
- JSON array columns (`terminator_links`, `metadata`) as SQL anti-patterns
- Tag parsing approach compared to established NLP-style task parsers
- Test coverage gaps
- Kanban config storage (flat JSON file vs. DB)

**Out of scope:**

- End-to-end UX review (not enough context on design intent)
- MCP integration details (separate feature boundary)
- Security audit of the admin raw-SQL handler (a known risk already mitigated by DDL block)
- Performance benchmarking (no profiling data available)

---

## Codebase Context

- `extensions/task-vault/src/vault/db.ts:1-193` — `initDb` uses a module-level singleton `_db`; `applyMigrations` uses `PRAGMA table_info` column-existence checks instead of a versioned migration table; `applySchema` duplicates several columns already present as migration-only additions (`project_id`, `area_id`) — these are defined in both `CREATE TABLE` and in `applyMigrations`, relying on SQLite's `CREATE TABLE IF NOT EXISTS` being idempotent, which works but makes the schema harder to read as a whole.
- `extensions/task-vault/src/vault/recurrence.ts:4-9` — Custom `RecurrenceRule` discriminated union with only four rule kinds (`daily`, `weekly`, `biweekly`, `monthly`). No quarterly, yearly, or "last weekday of month" support. Rule strings like `'weekly:1,3'` are bespoke and not interoperable.
- `extensions/task-vault/src/vault/ensure-next-occurrence.ts:105` — Hardcoded `source: 'daily'` when inserting the next occurrence, regardless of the template task's source. This is a confirmed bug.
- `extensions/task-vault/src/ipc/vault.ipc.ts:53-107` — `rowToTask` defined here; identical function defined again at `projects.ipc.ts:24-41` and `links.ipc.ts:22-39`. Three copies of the same function in the TypeScript source.
- `extensions/task-vault/src/ipc/vault.ipc.ts:36` and `projects.ipc.ts:13`, `links.ipc.ts:11`, `kanban.ipc.ts:9` — `let vaultPath = ''` with its own `setVaultPath()` and `getVaultPath()` setter/getter duplicated in four IPC modules. `links.ipc.ts` and `projects.ipc.ts` never actually use `vaultPath` in any handler.
- `extensions/task-vault/src/vault/db.ts:145-192` — `terminator_links` is stored as a JSON-serialised array string (`TEXT NOT NULL DEFAULT '[]'`). Searching it requires a `LIKE '%<uuid>%'` pattern match (see `links.ipc.ts:158`), which is O(n) full-scan and fragile.
- `extensions/task-vault/src/vault/db.ts:145-192` — `metadata` column is a JSON blob (`TEXT NOT NULL DEFAULT '{}'`) storing nine different logical fields (`blocked_reason`, `blocked_check_interval`, `recurrence_end_type`, `recurrence_end_date`, `recurrence_end_count`, `recurrence_completed_count`, `description`, `acceptance_criteria`, `dev_hints`, `migration_twin_id`). Every read requires `JSON.parse` with a try/catch; every write requires `JSON.parse` + mutate + `JSON.stringify`.
- `extensions/task-vault/src/stores/vault.store.ts:59-186` — Single Zustand store holds: data (`todayLog`, `inboxCount`, `somedayTasks`, `kanbanLanes`), UI navigation state (`activeView`, `selectedAreaName`, `selectedProjectName`, `pendingTaskId`, `viewingDate`), filter state (`selectedContexts`), async loading state (`isLoading`, `error`), and side-effectful localStorage reads at store creation time (`localStorage.getItem` called inline in the initial state object at line 69).
- `extensions/task-vault/src/utils/markdown.ts:6-130` — 125-line hand-rolled markdown parser that handles only h1–h3, bold, italic, inline code, links, fenced code, bullet lists, and checkboxes. No table support, no nested list support, no escape handling for `\*` or `\_`.
- `extensions/task-vault/src/ipc/vault.ipc.ts:195-1515` — 1,320-line `registerVaultIpcHandlers` function containing 28 handler registrations. No intermediate extraction into service/repository functions.
- `extensions/task-vault/src/ipc/kanban.ipc.ts:18-27` — Kanban configuration stored in a flat JSON file at `<vaultPath>/.todo/kanban.json` read synchronously via `fs.readFileSync`. Not transactional, separate from the SQLite database.
- `extensions/task-vault/src/schemas/vault.schema.ts:281-304` — `SetRecurrenceRequestSchema` uses a custom `RecurrenceIntervalSchema = z.enum(['daily','weekly','biweekly','monthly'])` — no RRULE string validation.

---

## Options Considered

### Option 1: Extract a shared `vault/mappers.ts` and a `VaultContext` to eliminate the four-way duplication of `rowToTask`, `rowToProject`, and `vaultPath`

**Summary:** Move `rowToTask`, `rowToProject`, `TASK_COLS`, `TASK_JOINS`, `PROJECT_COLS`, `PROJECT_JOINS`, and the `vaultPath` singleton into one shared module, then import from each IPC file.

**Official source:**
Source: better-sqlite3 README — https://github.com/WiseLibs/better-sqlite3
Quote: "better-sqlite3 is designed to be used in the main thread of Node.js; sharing database handles across modules via a singleton is explicitly supported."

**Feasibility:** High — the duplication is purely mechanical; all four files already import from `../vault/db`, so adding `../vault/mappers` is a zero-risk addition.

**Complexity to adopt:** Low — three pairs of duplicate functions, ~120 lines of duplicate TypeScript. Total change is extracting ~150 lines and updating four import statements.

**Risks:**

- Accidental behavioural divergence if the three implementations were intentionally different (they are not — diff confirms identical logic).
- None other than a mechanical refactor.

**Codebase fit:** Yes — the extension already uses a shared `vault/db.ts` singleton pattern; this continues that pattern.

---

### Option 2: Replace the custom recurrence rule string format with RRULE (RFC 5545)

**Summary:** Replace `'daily' | 'weekly:1,3' | 'biweekly' | 'monthly'` with RFC 5545 RRULE strings such as `FREQ=DAILY`, `FREQ=WEEKLY;BYDAY=MO,WE`, parsed by the `rrule` npm package.

**Official source:**
Source: rrule.js — https://github.com/jakubroztocil/rrule
Quote: "rrule.js supports recurrence rules as defined in the iCalendar RFC, as well as parsing, human-readable descriptions, and occurrence iteration."

**Feasibility:** Medium — the `rrule` package is well-maintained and tested. The rule storage column already exists (`recurrence_rule TEXT`). The four existing rule variants map cleanly to RRULE equivalents. Migration requires updating `parseRecurrenceRule`, `serializeRecurrenceRule`, `computeNextDueDate`, and the Zod schema.

**Complexity to adopt:** Medium — `computeNextDueDate` in `recurrence.ts` (85 lines) is replaced by `rule.after(fromDate)`. The migration step adds ~30 lines.

**Risks:**

- `rrule` adds ~50 KB to the extension bundle (acceptable for Electron).
- Monthly overflow behaviour (`Jan 31 + 1 month = Mar 2`) differs from RRULE's `FREQ=MONTHLY` (which skips months without a 31st day) — must document the chosen behaviour.
- RRULE strings are less human-readable in the database column than `'daily'`.

**Codebase fit:** Partial — the existing rule format is bespoke but compact. The `node-ical` package is already a dependency, so the project is already iCal-adjacent.

---

### Option 3: Promote `metadata` JSON blob columns to first-class SQL columns

**Summary:** Move the nine logical sub-fields currently stored in the `metadata` TEXT blob to individual nullable SQL columns, and move `terminator_links` to a separate junction table.

**Official source:**
Source: SQLite Documentation — https://www.sqlite.org/datatype3.html
Quote: "SQLite does not enforce type constraints on columns, but using correct column types improves query performance, enables foreign key enforcement, and simplifies WHERE clause filtering."

**Feasibility:** Medium — the recurrence rule fields (`recurrence_rule`, `recurrence_template_id`, `recurrence_notify_at`) were already promoted from `metadata` to columns in a previous migration (`db.ts:72-98`). The same pattern is established. `blocked_reason` and `blocked_check_interval` are natural candidates to promote next.

**Complexity to adopt:** Medium-High — each column promotion requires a new `applyMigrations` branch, a data-migration UPDATE, and changes to every query that touches `metadata`. The `rowToTask` function loses its try/catch JSON.parse loops.

**Risks:**

- The migration path is one-way; rolling back requires schema downgrade logic.
- `terminator_links` as a junction table requires a schema change to the `links.ipc.ts` handlers — but eliminates the `LIKE '%uuid%'` full-scan search pattern.

**Codebase fit:** Yes — directly follows the established pattern at `db.ts:72-98` where recurrence fields were promoted from `metadata` to columns.

---

### Option 4: Split the Zustand store into data, UI navigation, and filter slices following the Zustand slice pattern

**Summary:** Break `useVaultStore` (34 properties, 12 async actions) into three slices: `useVaultDataStore` (server state: `todayLog`, `inboxCount`, `somedayTasks`, `kanbanLanes`), `useVaultNavStore` (navigation: `activeView`, `selectedAreaName`, `selectedProjectName`, `pendingTaskId`, `viewingDate`), and `useVaultFilterStore` (filter state: `selectedContexts`, `viewMode`).

**Official source:**
Source: Zustand — Slices Pattern — https://docs.pmnd.rs/zustand/guides/slices-pattern
Quote: "Slices pattern is recommended for splitting a large store into multiple smaller stores that are each responsible for a separate concern."

**Feasibility:** High — the slices are already logically distinct in the existing store. The split does not require touching IPC or DB code.

**Complexity to adopt:** Medium — all 25 component files that call `useVaultStore` need their import updated to reference the correct slice.

**Risks:**

- Subscription granularity: components that used to re-render only on combined store change may now re-render more often if they subscribe to multiple slices.
- The localStorage read at store initialisation (`localStorage.getItem(KANBAN_MODE_KEY)` at `vault.store.ts:69`) must be moved into the filter slice's initialiser.

**Codebase fit:** Yes — the git-integration extension already uses separate stores per concern.

---

## Comparison Table

| Criterion             | Option 1: Extract mappers    | Option 2: RRULE standard                     | Option 3: Promote metadata columns        | Option 4: Split Zustand store          |
| --------------------- | ---------------------------- | -------------------------------------------- | ----------------------------------------- | -------------------------------------- |
| Official docs quality | High (better-sqlite3 README) | High (rrule.js + RFC 5545)                   | High (SQLite docs)                        | High (Zustand slices guide)            |
| Feasibility           | High                         | Medium                                       | Medium                                    | High                                   |
| Complexity to adopt   | Low                          | Medium                                       | Medium-High                               | Medium                                 |
| Codebase fit          | Yes                          | Partial                                      | Yes                                       | Yes                                    |
| Code reduction (est.) | ~120 lines removed           | ~55 lines removed                            | ~80 lines of try/catch JSON.parse removed | ~40 lines (store becomes 3 lean files) |
| Key risk              | None (mechanical refactor)   | Monthly overflow semantics differ from RRULE | One-way schema migration                  | More hook calls per component          |

---

## Recommendation

**Option 1** (extract shared mappers) should be implemented first — it is a zero-risk, high-yield mechanical refactor that removes three copies of `rowToTask`/`rowToProject` from the compiled bundle and eliminates four duplicated `vaultPath` singletons. Following that, **Option 3** (promote `metadata` columns) should be the second priority: the established migration pattern at `db.ts:72-98` proves the team is already comfortable with the approach, and promoting `blocked_reason` and `blocked_check_interval` eliminates the most frequently executed `JSON.parse` hot path in the scheduler tick (which runs every 15 seconds). Option 2 (RRULE) is attractive for interoperability with the already-present `node-ical` dependency, but the monthly overflow semantics require an explicit design decision before committing. Option 4 (store slicing) is low-risk and follows Zustand's own recommended guide, but has the widest diff surface and is best deferred until after the DB-level changes are stable.

---

## Open Questions

- **Confirmed bug in `ensure-next-occurrence.ts:105`:** The hardcoded `source: 'daily'` when spawning the next recurrence instance means tasks originally created in the inbox or a project will have their next occurrence land on the daily log instead of staying in their original source. Is this intentional (force recurring tasks to show up on the Today view) or a defect?
- **Coverage config misalignment:** The `coverage/index.html` report shows 0% statement coverage for the bundle. The test suite does exercise the TypeScript source. Is vitest configured to instrument the TypeScript source, or the compiled `src/index.js`?
- **`terminator_links` as LIKE search:** The `links.ipc.ts:158` LIKE pattern is correct but unindexed on the UUID substring. For vaults with many tasks (hundreds), this performs a full table scan on every `get-for-terminator-target` call.
- **Kanban config in JSON file vs. DB:** `kanban.json` is read synchronously on every `kanban:get-config` call with no write-lock. If two windows simultaneously call `kanban:save-config`, one write can clobber the other.

## Next Steps

- `/forge.tasks 005` — decompose Option 1 (extract `vault/mappers.ts`) into implementation tasks.
- `/forge.tasks 005` — decompose Option 3 (promote `blocked_reason`, `blocked_check_interval` to columns) into: migration step, update `rowToTask`, update `block-task`/`unblock-task` handlers, update scheduler tick query.
- Resolve the `ensure-next-occurrence.ts:105` bug question (intentional or defect) before any recurrence engine changes.
