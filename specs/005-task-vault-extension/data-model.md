# Data Model: Task Vault Extension

**Date**: 2026-05-19  
**Branch**: `005-task-vault-extension`

All entities are stored as plain markdown files in the user-configured vault directory. The `.todo/index.json` is an ephemeral derived artifact — never the source of truth.

---

## Core Entities

### Task

A single bullet item in any vault file.

```typescript
interface Task {
  id: string // "<filepath>:<line>" — session-scoped, rebuilt on file change
  filePath: string // Absolute path to the vault file containing this task
  line: number // 1-based line number within the file
  status: TaskStatus // Derived from bullet marker
  text: string // Raw task text (without marker and metadata tags)
  project?: string // +project tag value (without +)
  context?: string // @context tag value (without @)
  area?: string // #area tag value (without #)
  dueDate?: string // due:YYYY-MM-DD value
  completedDate?: string // YYYY-MM-DD appended after [x] marker
  migratedTo?: string // YYYY-MM-DD target date after [>] marker
  metadata: Record<string, string> // Arbitrary key:value pairs
  terminatorLinks: string[] // UUIDs of linked Terminator projects/workspaces
}

type TaskStatus = 'open' | 'done' | 'migrated' | 'cancelled' | 'in-progress'
```

**Markdown representation**:

```
- [ ] Open task +project @context #area due:2026-05-22
- [x] Completed task                              2026-05-19
- [>] Migrated task → 2026-05-20
- [-] Cancelled task
- [/] In-progress task
```

**State transitions**:

```
open → done       (complete_task)
open → migrated   (migrate_task)
open → cancelled  (manual edit only; no MCP tool)
open → in-progress (manual edit only)
done → (terminal, no transition)
migrated → (terminal, no transition)
```

---

### DailyLog

One markdown file per calendar day.

```typescript
interface DailyLog {
  date: string // YYYY-MM-DD (derived from filename)
  filePath: string // Absolute path: <vault>/daily/YYYY-MM-DD.md
  tasks: Task[] // All task bullets in the file
  events: Event[] // Bullet lines starting with 'o'
  notes: Note[] // Bullet lines starting with '*'
  exists: boolean // false if file not yet created
}

interface Event {
  time?: string // e.g. "09:00"
  text: string
}

interface Note {
  text: string
}
```

**File path**: `<vault>/daily/YYYY-MM-DD.md`

**Auto-creation**: If file does not exist when the daily log view loads, it is created from a blank template with "Tasks", "Events", and "Notes" headings.

---

### InboxItem

An unprocessed task in `inbox.md`.

```typescript
interface InboxItem extends Task {
  capturedAt?: string // ISO timestamp if added via capture tool (metadata key)
  source?: string // 'quick-capture' | 'mcp' | 'manual'
}
```

**File path**: `<vault>/inbox.md`

---

### Project

A markdown file with YAML frontmatter and structured sections.

```typescript
interface Project {
  filePath: string
  name: string // H1 heading from file body
  status: ProjectStatus
  deadline?: string // YYYY-MM-DD from frontmatter
  area?: string // PARA area from frontmatter
  created: string // YYYY-MM-DD from frontmatter
  outcome?: string // Content under "## Outcome" heading
  nextActions: Task[] // Open tasks under "## Next action" heading
  allTasks: Task[] // All tasks under "## All tasks" heading
  isStale: boolean // true if nextActions is empty OR mtime > staleness threshold
  lastModified: Date // File system mtime
  terminatorLinks: string[] // UUIDs of linked Terminator workspaces/projects
}

type ProjectStatus = 'active' | 'someday' | 'done' | 'archived'
```

**YAML frontmatter**:

```yaml
---
type: project
status: active
deadline: 2026-06-12
area: engineering
created: 2026-05-01
terminator-links: ['uuid-1', 'uuid-2'] # TerminatorLink UUIDs (optional)
---
```

**Staleness rule**: `isStale = nextActions.length === 0 || (Date.now() - lastModified.getTime()) > stalenessThresholdMs`

**Invariant**: Every active project SHOULD have at least one open task under "## Next action". Absence is flagged as stale (not enforced as a write constraint).

---

### Area

A markdown file for an ongoing responsibility.

```typescript
interface Area {
  filePath: string
  name: string // H1 heading from file body
  area: string // Derived from filename
  tasks: Task[] // Any tasks in the file
  terminatorLinks: string[]
}
```

**File path**: `<vault>/areas/<name>.md`
**Distinction from Project**: No frontmatter `deadline`, no completion state, no "Next action" invariant.

---

### VaultIndex

Ephemeral, rebuilt on every file change. Stored at `<vault>/.todo/index.json`. Never committed to git.

```typescript
interface VaultIndex {
  version: number // Schema version for cache invalidation
  builtAt: string // ISO timestamp of last rebuild
  vaultPath: string // Absolute path to vault root
  tasks: IndexedTask[] // All tasks across all non-archive files
  projects: IndexedProject[]
  inboxCount: number
}

interface IndexedTask {
  id: string // filepath:line
  filePath: string
  line: number
  status: TaskStatus
  text: string
  project?: string
  context?: string
  area?: string
  dueDate?: string
  terminatorLinks: string[]
}

interface IndexedProject {
  id: string // filePath (stable within a session)
  filePath: string
  name: string
  status: ProjectStatus
  deadline?: string
  area?: string
  isStale: boolean
  nextActionCount: number
  lastModified: string // ISO timestamp
  terminatorLinks: string[]
}
```

**Rebuild trigger**: Any file change event from the chokidar watcher (debounced 200ms).
**Archive exclusion**: Files under `<vault>/archive/` are excluded from the live index by default.

---

### TerminatorLink

A navigational pointer from a vault item to a Terminator workspace or project.

```typescript
interface TerminatorLink {
  targetId: string // Terminator workspace or project UUID (opaque, from Extension API)
  targetType: 'workspace' | 'project'
  displayName?: string // Resolved at render time; never stored in vault
  isBroken: boolean // true if targetId no longer exists in Terminator
}
```

**Storage in task files** (inline metadata):

```
- [ ] Spike JWT rotation +auth @deep terminator:550e8400-e29b-41d4-a716-446655440000
```

**Storage in project frontmatter**:

```yaml
terminator-links: ['550e8400-e29b-41d4-a716-446655440000']
```

**Resolution**: Display names are fetched from `api.workspace.list()` at render time and never written to the vault file. Links survive workspace/project renames because only the UUID is stored.

---

### CalendarEvent

Parsed from user-configured ICS feed(s).

```typescript
interface CalendarEvent {
  uid: string
  summary: string
  startDate: Date
  endDate: Date
  allDay: boolean
  location?: string
  description?: string
}

interface IcsFeedCache {
  feedUrl: string // URL or file path
  events: CalendarEvent[]
  lastFetchedAt: string // ISO timestamp
  fetchError?: string // Last error message if fetch failed
}
```

**Cache location**: `<vault>/.todo/ics-cache.json`
**Refresh**: Background polling on configurable interval (default: 14400000ms = 4 hours).
**Failure handling**: If fetch fails, last cached events are shown with a staleness warning.

---

## File Layout

```
<vault>/                          # User-configured root (default: ~/vault)
├── daily/
│   ├── 2026-05-19.md             # One file per day
│   └── 2026-05-18.md
├── inbox.md                      # All captured items
├── projects/
│   ├── q2-okr-planning.md        # Project file with YAML frontmatter
│   └── refactor-auth-layer.md
├── areas/
│   ├── health.md
│   └── engineering.md
├── archive/
│   └── 2026-Q1-finished.md       # Archived projects and old daily logs
└── .todo/                        # Ephemeral; gitignored
    ├── index.json                 # VaultIndex (rebuilt on file change)
    ├── ics-cache.json             # ICS feed cache
    └── config.yaml                # User settings (vault path, hotkey, thresholds)
```

---

## VaultIndex ID Stability Contract

| Scenario                         | Behavior                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| File unchanged since index built | ID `filepath:line` is valid                                                           |
| File changed externally          | Watcher detects change; index rebuilt; old IDs invalid                                |
| MCP tool writes to file          | Index rebuilt immediately after write; tool returns new IDs                           |
| MCP client uses stale ID         | Tool returns `{ error: 'STALE_ID', message: 'Task not found at line N; re-query' }`   |
| Two agents write simultaneously  | Atomic rename prevents corruption; second write gets stale ID error and must re-query |
