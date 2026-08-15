# Contract: Task Vault IPC Channels

**Version**: 1.0.0  
**Date**: 2026-05-19  
**Feature**: `005-task-vault-extension`

All channels use the `task-vault:` namespace prefix. Payloads are validated with Zod schemas at both ends before use. All channels are invoke/handle (renderer → main, awaiting response) unless noted as send (fire-and-forget) or on (main → renderer push).

---

## Vault Operations

### `task-vault:vault:capture`

Append a new task to `inbox.md`.

**Request**:

```typescript
{
  text: string           // Task text (must not be empty or whitespace-only)
  hintArea?: string      // Optional #area suggestion
  hintProject?: string   // Optional +project suggestion
}
```

**Response**:

```typescript
{ taskId: string } | { error: string }
```

---

### `task-vault:vault:get-today`

Read today's daily log.

**Request**: `{}`

**Response**:

```typescript
{
  date: string          // YYYY-MM-DD
  tasks: IndexedTask[]
  events: Event[]
  notes: Note[]
  exists: boolean       // false if file was auto-created
} | { error: string }
```

---

### `task-vault:vault:get-daily`

Read a specific day's log.

**Request**: `{ date: string }` — YYYY-MM-DD

**Response**: Same shape as `get-today`.

---

### `task-vault:vault:add-task`

Insert a task into a specific vault file.

**Request**:

```typescript
{
  filePath: string      // Relative to vault root
  text: string
  section?: string      // Heading to insert under (e.g., "## Next action")
  dueDate?: string      // YYYY-MM-DD
  tags?: { project?: string; context?: string; area?: string }
}
```

**Response**: `{ taskId: string } | { error: string }`

---

### `task-vault:vault:complete-task`

Mark a task `[x]` with today's date.

**Request**: `{ taskId: string }`

**Response**: `{ success: true } | { error: 'STALE_ID' | string }`

---

### `task-vault:vault:migrate-task`

Mark a task `[>]` and copy it as `[ ]` to a target date's daily log.

**Request**: `{ taskId: string; targetDate: string }` — targetDate is YYYY-MM-DD

**Response**: `{ newTaskId: string } | { error: 'STALE_ID' | string }`

---

### `task-vault:vault:query`

Query tasks across all indexed vault files.

**Request**:

```typescript
{
  status?: TaskStatus | TaskStatus[]
  context?: string       // @context value (without @)
  project?: string       // +project value (without +)
  area?: string          // #area value (without #)
  dueBefore?: string     // YYYY-MM-DD
  filePattern?: string   // Glob relative to vault root
}
```

**Response**: `{ tasks: IndexedTask[] } | { error: string }`

---

### `task-vault:vault:process-inbox-item`

File an inbox item to a destination (removes from inbox.md, adds to destination).

**Request**:

```typescript
{
  taskId: string
  action: 'file' | 'trash' | 'do-now' | 'someday'
  destination?: string   // Relative file path within vault (required for action: 'file')
  newProjectName?: string  // Creates new project file if provided
}
```

**Response**: `{ success: true; newTaskId?: string } | { error: string }`

---

### `task-vault:vault:update-project-status`

Change a project file's `status` frontmatter field.

**Request**:

```typescript
{
  projectFilePath: string // Relative to vault root
  status: 'active' | 'someday' | 'done' | 'archived'
}
```

**Response**: `{ success: true } | { error: string }`

---

## Project & Review Operations

### `task-vault:projects:list`

List projects by status.

**Request**: `{ status?: ProjectStatus | ProjectStatus[] }`

**Response**: `{ projects: IndexedProject[] } | { error: string }`

---

### `task-vault:projects:weekly-review`

Assemble the full weekly review payload (pre-loads all 6 steps).

**Request**: `{}`

**Response**:

```typescript
{
  inboxItems: InboxItem[]
  activeProjects: IndexedProject[]        // Step 3
  staleProjects: IndexedProject[]         // Flagged in step 3
  someDayProjects: IndexedProject[]       // Step 5
  completedLastWeek: IndexedTask[]        // Step 1 / reflect
  lastReviewDate?: string                 // ISO date of last completed review
} | { error: string }
```

---

## Link Operations

### `task-vault:links:create`

Add a TerminatorLink to a vault task or project.

**Request**:

```typescript
{
  taskId?: string            // Use taskId OR projectFilePath, not both
  projectFilePath?: string
  targetId: string           // Terminator workspace or project UUID
  targetType: 'workspace' | 'project'
}
```

**Response**: `{ success: true } | { error: string }`

---

### `task-vault:links:remove`

Remove a TerminatorLink from a vault item.

**Request**:

```typescript
{
  taskId?: string
  projectFilePath?: string
  targetId: string
}
```

**Response**: `{ success: true } | { error: string }`

---

### `task-vault:links:get-for-terminator-target`

Get all vault items linked to a specific Terminator project or workspace (used by LinkedVaultPanel).

**Request**: `{ targetId: string }`

**Response**: `{ tasks: IndexedTask[]; projects: IndexedProject[] } | { error: string }`

---

## ICS Calendar Operations

### `task-vault:ics:get-events`

Get cached calendar events for the surrounding 14-day window.

**Request**: `{ windowDays?: number }` — default 7 past + 7 future

**Response**:

```typescript
{
  events: CalendarEvent[]
  lastFetchedAt: string     // ISO timestamp
  isFeedConfigured: boolean
  isStale: boolean          // true if fetch failed or cache > 2× interval age
  fetchError?: string
} | { error: string }
```

---

## Weekly Review History

The weekly review is persisted so it can be revisited and exported. A review row
is created (or resumed) when the wizard mounts; every decision taken during the
review is recorded against it.

### `task-vault:review:start`

Return the open review, creating one if none is in progress. Resuming rather
than always inserting keeps a mid-review reload from forking the record.

**Request**: `{}`

**Response**: `{ review: WeeklyReview; resumed: boolean }`

### `task-vault:review:log`

Record one action taken during a review.

**Request**:

```typescript
{
  reviewId: string
  step: number // 1-6
  action:
    | 'captured'
    | 'inbox-processed'
    | 'project-status'
    | 'task-promoted'
    | 'task-backlogged'
    | 'task-archived'
    | 'task-deleted'
    | 'task-kept'
  entityType: 'task' | 'project'
  entityId?: string | null
  entityLabel: string
  detail?: string | null
}
```

**Response**: `{ action: WeeklyReviewAction } | { error: 'VALIDATION_ERROR' }`

### `task-vault:review:complete`

Store the step 6 reflection answers and close the review.

**Request**: `{ reviewId: string; worked?: string; didntWork?: string; tryNext?: string }`

**Response**: `{ ok: true } | { error: 'VALIDATION_ERROR' }`

### `task-vault:review:list`

List past reviews, newest first, each with its recorded action count.

**Request**: `{ limit?: number }` (default 50, max 500)

**Response**: `{ reviews: WeeklyReviewSummary[] }`

### `task-vault:review:get`

Fetch one review with all of its recorded actions.

**Request**: `{ reviewId: string }`

**Response**: `{ review: WeeklyReviewDetail } | { error: 'REVIEW_NOT_FOUND' | 'VALIDATION_ERROR' }`

### `task-vault:review:export`

Write a review to a Markdown file chosen through a save dialog.

**Request**: `{ reviewId: string }`

**Response**: `{ filePath: string } | { canceled: true } | { error: string }`

---

## Push Channels (Main → Renderer)

These are sent from main process to renderer when vault state changes.

### `task-vault:push:index-updated`

Fired after VaultIndex is rebuilt (debounced 200ms after file changes).

**Payload**: `{ inboxCount: number; staleProjectCount: number }`

### `task-vault:push:file-changed-externally`

Fired when a vault file is changed outside the extension (for the "File changed externally — reloaded" toast).

**Payload**: `{ filePath: string }`
