# Feature Specification: Task Vault Extension

**Feature Branch**: `005-task-vault-extension`  
**Created**: 2026-05-19  
**Status**: Draft

## Clarifications

### Session 2026-05-19 (clarify command)

- Q: How should the weekly review be triggered? → A: Configurable scheduled nudge — default Friday; non-blocking reminder appears if review is overdue by N days.
- Q: Where do calendar events come from in weekly review Step 4? → A: ICS feed — user configures a URL or local file path; extension reads and displays events read-only.
- Q: What makes a project stale? → A: Both signals — stale if no open task under "Next action" heading OR no file edits in N configurable days (default N=14).
- Q: Should the agent ever take action without confirmation? → A: Per-operation config — each MCP tool has an auto-execute toggle the user configures individually; default is off for all tools.
- Q: How should the extension handle vault files edited externally while it is open? → A: File-watch reload with notification — detect change via filesystem watch, show a non-blocking toast ("File changed externally — reloaded"), then reload the affected view.

### Session 2026-05-19 (user feedback)

- Arch decision: Extension is app-level, not workspace-scoped — it lives as a permanent top-level sidebar tab visible at all times regardless of active project or workspace.
- Linking: Vault tasks and projects can be linked to Terminator projects and workspaces; linked items are navigable from both sides.

### Session 2026-05-19 (clarify command — round 2)

- Q: How does the user create a vault↔Terminator link? → A: Both — inline syntax (e.g., `terminator:project-slug` in task text) for power users AND a UI picker ("Link to Terminator…" button/menu) for discoverability; both produce the same stored reference.
- Q: Where in the Terminator UI do linked vault tasks appear? → A: Collapsible sidebar panel within the project/workspace view, consistent with how other extensions surface contextual data.
- Q: How are task IDs stable for MCP tool calls? → A: Line-based IDs (`filepath:line`), valid for a session; index rebuilds on any file change; agents must re-query after writes to get fresh IDs.
- Q: When is the ICS calendar feed refreshed? → A: Background polling on a configurable interval (default 4 hours); Step 4 shows the most recently cached data.
- Q: What identifier is stored in vault files for Terminator links? → A: Opaque UUID exposed by the Extension API per project/workspace; survives renames; display name fetched separately at render time.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Daily Log Front Door (Priority: P1)

Every morning the user opens the extension and sees today's daily log. The log shows tasks for today, events, and free-form notes. A sidebar shows inbox item count, active projects, and areas. The user can add tasks, mark tasks complete, and migrate tasks to another day — all without leaving the daily log.

**Why this priority**: Without this view, no other feature has a home. It is the primary surface the user interacts with daily.

**Independent Test**: Create today's daily log entry, add three tasks, complete two, migrate one to tomorrow. Verify tomorrow's log contains the migrated task with the `[>]` marker and today's log shows the forward pointer.

**Acceptance Scenarios**:

1. **Given** the extension is opened on any day, **When** the daily log view loads, **Then** the current date's log file is shown with all tasks, events, and notes for that date grouped into labeled sections.
2. **Given** today's log is open, **When** the user checks off a task, **Then** the task is marked `[x]` with today's date inline and rendered with strikethrough styling.
3. **Given** today's log is open, **When** the user migrates a task to the next day, **Then** the task is marked `[>]` with a forward pointer to tomorrow's date, and tomorrow's log file gains a copy of the task marked open.
4. **Given** the sidebar is visible, **When** items exist in inbox.md, **Then** the inbox count badge reflects the current number of unprocessed items.

---

### User Story 2 - Quick Capture From Anywhere (Priority: P2)

The user triggers a global hotkey from any app on the OS. A floating capture overlay appears with a single text field. The user types a thought and presses Enter — it lands in inbox.md immediately. Pressing ⌘Enter instead files it to the agent's suggested destination. The overlay dismisses. No context-switching required.

**Why this priority**: If capture requires opening the app and navigating, the user will not capture. Low-friction capture is the foundation of GTD.

**Independent Test**: With the extension in the background, trigger the global hotkey, type a note, press Enter, then open inbox.md. The note must appear as a new task.

**Acceptance Scenarios**:

1. **Given** the extension is running, **When** the user presses the global capture hotkey from any application, **Then** the quick capture overlay appears within 300ms, focused and ready for input.
2. **Given** the capture overlay is open with text entered, **When** the user presses Enter, **Then** the text is appended to inbox.md as an open task and the overlay closes.
3. **Given** the capture overlay is open, **When** the overlay detects tags in the input text, **Then** suggested tags and a destination are shown but the user is never blocked on them.
4. **Given** the capture overlay shows a suggested destination, **When** the user presses ⌘Enter, **Then** the item is filed directly to the suggested destination instead of inbox.md.
5. **Given** the capture overlay is open, **When** the user presses Escape, **Then** the overlay closes with no item saved.

---

### User Story 3 - MCP Tool Surface for Agents (Priority: P2)

Any MCP-compatible agent (Claude Code, Cursor, Claude Desktop) can call a set of structured tools to read and write the vault. The tools cover the full GTD loop: capture, query, complete, migrate, review. Every operation the human performs in the UI is also available as an MCP tool call. The vault files remain the source of truth; the MCP layer adds atomicity and queryability.

**Why this priority**: Agent-native design is the core differentiator of this system. Without MCP tools, agents must screen-scrape or use ad-hoc file edits.

**Independent Test**: Using an MCP client, call `capture("test item")`, then call `query({status: "open"})` and verify the new item appears in results. Call `complete_task(id)` and verify the file is updated.

**Acceptance Scenarios**:

1. **Given** an MCP client is connected, **When** `capture(text)` is called, **Then** the text is appended to inbox.md and the call returns the new item's ID.
2. **Given** tasks exist across vault files, **When** `query({status, context, project, due_before})` is called with any combination of filters, **Then** matching tasks are returned in structured form.
3. **Given** an open task exists, **When** `complete_task(task_id)` is called, **Then** the task marker changes from `[ ]` to `[x]` with today's date, atomically.
4. **Given** an open task exists, **When** `migrate_task(task_id, target_date)` is called, **Then** the source task is marked `[>]` with the target date and the target day file receives a copy of the task.
5. **Given** the vault has projects, **When** `list_projects(status?)` is called, **Then** all matching project files are returned with their status, deadline, next action, and staleness flag.
6. **Given** the weekly review is requested, **When** `weekly_review()` is called, **Then** a structured payload is returned containing inbox items, all active projects with their next actions, stale projects, and the prior week's completed tasks — ready for a review wizard to consume.

---

### User Story 4 - Projects Browser With Stale Detection (Priority: P3)

The user can view all active projects in a single pane. Each project card shows its name, deadline, PARA area, number of open and completed tasks, and the single "next action" task. Projects with no open task in their "Next action" section are flagged stale in red. The user can promote a stale project from the browser by choosing: add a next action, move to Someday, or archive.

**Why this priority**: Stale project detection is GTD's core feedback loop. Without it, the system silently accumulates projects with no forward momentum.

**Independent Test**: Create a project file with no tasks in its "Next action" section. Open the projects browser. The project must appear with a "no next action" badge. Select "Move to Someday" — the project's status frontmatter changes to `someday` and it disappears from the active list.

**Acceptance Scenarios**:

1. **Given** the projects browser is open, **When** an active project file has no open task under its "Next action" heading, **Then** that project card is visually flagged as stale.
2. **Given** a stale project is displayed, **When** the user selects "Add next action", **Then** the project file opens in edit mode with the cursor placed under the "Next action" heading.
3. **Given** a stale project is displayed, **When** the user selects "Move to Someday", **Then** the project file's `status` frontmatter is updated to `someday` and the project is removed from the active list.
4. **Given** a stale project is displayed, **When** the user selects "Archive", **Then** the project file is moved to the archive directory and the project is removed from the active list.

---

### User Story 5 - Inbox Processing (Priority: P3)

The user opens the inbox processing view (manually via ⌘I or as a weekly review step). Each inbox item is presented one at a time through GTD's clarifying questions: Is it actionable? If yes, is it under two minutes? If yes to two minutes, do it now. Otherwise, where does it live? The agent suggests a destination based on tags and content matching existing projects and areas. The user confirms or overrides.

**Why this priority**: Capture is only valuable if inbox items get processed. Without guided clarification, the inbox becomes a graveyard.

**Independent Test**: Add three items to inbox.md. Open inbox processing. Complete the clarify flow for one item — answer "yes/actionable", "no/more than 2 min", select a destination. Verify the item is removed from inbox.md and appears in the chosen destination file.

**Acceptance Scenarios**:

1. **Given** inbox.md has items, **When** the user opens inbox processing, **Then** each item is presented sequentially with the GTD clarify questions in order.
2. **Given** an item is shown in the clarify flow, **When** the user answers "actionable → more than 2 minutes", **Then** destination options are shown: an existing project, a new project, an area, or Someday — with the agent's recommended destination highlighted.
3. **Given** the user selects a destination, **When** the item is filed, **Then** the item is removed from inbox.md and appended to the chosen destination file as an open task.
4. **Given** an item is shown in the clarify flow, **When** the user answers "less than 2 minutes", **Then** the item is marked as a do-now task and the user is prompted to take the action before continuing.

---

### User Story 6 - Weekly Review Wizard (Priority: P4)

The user launches the weekly review (manually or when nudged by the system). A 6-step wizard guides them through: processing inboxes, reviewing every active project for a next action, scanning the calendar window, reviewing Someday items, and a free-form reflect step. The agent pre-loads each step with the relevant vault state so the user is reacting to data, not searching for it.

**Why this priority**: The weekly review is the step most people abandon in GTD. A guided, pre-loaded wizard removes the friction that causes abandonment.

**Independent Test**: Launch the weekly review. Step 3 (Projects) must list all active projects automatically. For a stale project, select "Archive" — the file must be moved and the project must disappear from the step's list. Complete all 6 steps and verify the session is recorded.

**Acceptance Scenarios**:

1. **Given** the weekly review is launched, **When** step 1 (Get Clear) loads, **Then** all loose inbox items are shown and the user is guided to file or trash each one.
2. **Given** the review is at step 3 (Projects), **When** the step loads, **Then** every active project is listed with its current next action status without the user having to navigate anywhere.
3. **Given** a project has no next action at step 3, **When** the user selects "Archive", **Then** the project file is moved to archive, the step list updates immediately, and the wizard records the action.
4. **Given** all 6 steps are completed, **When** the user finishes the wizard, **Then** a completion record is written to the daily log noting the review date and step summary.

---

### User Story 7 - Link Vault Items to Terminator Projects and Workspaces (Priority: P3)

The user can attach a vault task or vault project to a Terminator project or workspace via two paths: typing inline syntax (`terminator:<uuid>`) directly in the task text, or selecting "Link to Terminator…" from a UI menu and picking from a list. Once linked, navigating to that Terminator project shows the associated vault tasks in context. From inside the vault, linked items display the Terminator project or workspace name as a navigable reference — clicking it opens the corresponding Terminator context. Links are bidirectional but do not sync data; they are navigational pointers only.

**Why this priority**: The vault lives at the app level, but the user's actual work happens inside Terminator projects and workspaces. Without linking, the vault is contextually disconnected from the tool the user spends most of their time in.

**Independent Test**: Open a vault task and link it to an open Terminator project. Navigate to that Terminator project — the linked task must appear in a "Vault tasks" section. Click the task reference — the vault extension must open and scroll to that task.

**Acceptance Scenarios**:

1. **Given** a vault task is open, **When** the user adds a link to a Terminator project or workspace, **Then** the link is stored as metadata on the task and the target Terminator project/workspace displays the task in a linked vault items section.
2. **Given** a Terminator project has linked vault tasks, **When** the user opens that project, **Then** a "Vault tasks" panel shows all linked tasks with their current status (open/done/migrated).
3. **Given** a vault task has a Terminator link, **When** the user clicks the link reference in the vault view, **Then** Terminator navigates to the linked project or workspace.
4. **Given** a linked Terminator project is deleted, **When** the user views the vault task that referenced it, **Then** the link is shown as broken with a visual indicator; the task itself is not affected.
5. **Given** a vault project file has a Terminator workspace link, **When** the user views the vault projects browser, **Then** the linked workspace name is displayed on the project card as a navigable badge.

---

### Edge Cases

- What happens when today's daily log file does not exist yet? A blank template must be created automatically on first open.
- What happens when an MCP client calls `complete_task` with a stale line-based ID (file was edited since the ID was issued)? The tool MUST return an error indicating the ID is stale; the client must re-query before retrying.
- What happens when two agents call `complete_task` on the same task simultaneously? The file must be treated as source of truth; the second write must not corrupt the first.
- What happens when a project file has malformed YAML frontmatter? The project must still appear in the browser with a parse-error badge rather than crashing the view.
- What happens when the vault directory does not exist or is inaccessible? The user must see a clear error and be offered a path to configure or create the vault.
- What happens when the ICS feed URL is unreachable during a background refresh? The last successfully cached data is shown with a staleness warning; Step 4 does not fail.
- What happens when a linked Terminator project or workspace is deleted? The vault item shows a broken-link badge but is not modified or deleted.
- What happens when a vault file is edited in an external text editor while the extension is open? The extension detects the change via filesystem watch, reloads the view, and shows a non-blocking toast. No data is lost.
- What happens when a captured item is empty (whitespace only)? The item must be rejected silently; nothing is written to inbox.md.
- What happens when the global hotkey conflicts with another app? The system must surface a conflict warning in settings and allow rebinding.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Extension MUST expose a daily log view showing all tasks, events, and notes for the current date, organized into labeled sections.
- **FR-002**: Extension MUST display a sidebar listing inbox item count, active projects, areas, and archive.
- **FR-003**: Extension MUST support a global operating-system hotkey that opens the quick capture overlay from any foreground application.
- **FR-004**: Quick capture overlay MUST append the captured text to inbox.md when the user confirms with Enter.
- **FR-005**: Quick capture overlay MUST suggest tags and a destination without blocking submission; the user can always send to inbox unconditionally.
- **FR-006**: Extension MUST bundle an MCP server exposing 8 tools: `capture`, `today`, `add_task`, `complete_task`, `migrate_task`, `query`, `list_projects`, `weekly_review`.
- **FR-007**: MCP tool `query` MUST support filtering by status, context tag, project tag, area tag, and due date.
- **FR-008**: Extension MUST read and write plain markdown files in a user-configured vault directory using the task syntax: `- [ ]` open, `- [x]` done, `- [>]` migrated, `- [-]` cancelled, `- [/]` in-progress.
- **FR-009**: Vault MUST follow the directory structure: `daily/`, `inbox.md`, `projects/`, `areas/`, `archive/`, `.todo/` (ephemeral index only).
- **FR-010**: Project files MUST use YAML frontmatter with fields: `type`, `status` (active/someday/done/archived), `deadline`, `area`, `created`.
- **FR-011**: Projects browser MUST flag a project as stale if EITHER (a) it has no open task under its "Next action" heading, OR (b) its file has not been modified in more than N days, where N is user-configurable with a default of 14 days.
- **FR-012**: Stale project cards MUST offer three resolution actions: add next action, move to Someday, archive.
- **FR-013**: Inbox processing view MUST present items one at a time and walk the user through GTD clarify questions in order: actionable? → two-minute rule? → destination?
- **FR-014**: Weekly review MUST be a 6-step wizard: Get Clear → Inbox → Projects → Calendar → Someday → Reflect.
- **FR-015**: Weekly review MUST pre-populate each step with the relevant vault state so the user does not need to navigate separately.
- **FR-016**: Extension MUST support inline task metadata: `+project`, `@context`, `#area`, `due:YYYY-MM-DD`, and arbitrary `key:value` pairs.
- **FR-017**: The `.todo/index.json` index MUST be rebuilt automatically when vault files change; it must never be treated as source of truth. Task IDs are line-based (`filepath:line`) and are valid for the current session only; the index is rebuilt after any write, and MCP clients MUST re-query to obtain fresh IDs after performing a write operation.
- **FR-018**: Completing or migrating a task MUST be an atomic file operation — no corruption on concurrent writes.
- **FR-019**: Extension settings MUST allow the user to configure the vault directory path, the global capture hotkey, and the weekly review reminder day and time.
- **FR-021**: Extension MUST display a non-blocking weekly review reminder notification when the configured review day arrives and no review has been completed in the last 7 days.
- **FR-022**: The weekly review nudge interval MUST be configurable; default is Friday at a user-specified time. The nudge must not auto-launch the wizard — it must require explicit user action to open.
- **FR-023**: Weekly review Step 4 (Calendar) MUST display events read from a user-configured ICS feed (URL or local file path) for the previous 7 days and next 7 days. The feed MUST be refreshed in the background on a configurable polling interval (default: every 4 hours); Step 4 shows the most recently cached data and displays the last-refreshed timestamp.
- **FR-024**: Extension settings MUST allow the user to configure one or more ICS feed sources (URL or file path). If no ICS feed is configured, Step 4 MUST display a message prompting the user to add one.
- **FR-020**: Extension MUST NOT implement priorities, energy levels, or context-as-folders; ordering signals are due date, project, and file order only.
- **FR-025**: Each MCP tool MUST have a per-tool auto-execute toggle configurable in extension settings. Default for every tool is off (suggest-only). When off, the agent surfaces a recommendation and waits for explicit user confirmation before writing any change to the vault.
- **FR-026**: Extension MUST watch vault files for external changes via filesystem events. When a watched file changes outside the extension, the extension MUST reload the affected view and display a non-blocking toast notification indicating the file was reloaded.
- **FR-027**: Extension MUST occupy a permanent top-level sidebar tab in the Terminator application, always visible regardless of which project or workspace is currently active.
- **FR-028**: Extension MUST NOT be scoped to or hidden by any project or workspace context; it is a global, app-level surface.
- **FR-029**: Vault tasks and vault projects MUST support linking to Terminator projects and workspaces via two equivalent authoring paths: (a) inline syntax — user types `terminator:<uuid>` directly in task text or project frontmatter; (b) UI picker — user selects "Link to Terminator…" from a button or context menu and picks from a list of available projects/workspaces (display names shown, UUID stored). Both paths store the same opaque UUID reference; the display name is resolved from the Extension API at render time and never written to the vault file.
- **FR-030**: When a vault item is linked to a Terminator project or workspace, that Terminator context MUST display the linked vault items in a collapsible sidebar panel showing task text and current status (open/done/migrated/cancelled). The panel is consistent with how other extensions surface contextual data in Terminator project/workspace views.
- **FR-031**: Clicking a Terminator link from inside the vault MUST navigate the Terminator application to the referenced project or workspace.
- **FR-032**: Clicking a vault link from inside a Terminator project or workspace MUST open the vault extension and scroll to the referenced item.
- **FR-033**: If a linked Terminator project or workspace is deleted, the vault item MUST display the broken link with a visual indicator but remain otherwise unaffected.

### Key Entities

- **DailyLog**: One markdown file per day (`daily/YYYY-MM-DD.md`), containing tasks, events, and notes for that date.
- **Task**: A single bullet item in any vault file, with status marker, text, and optional inline metadata tags.
- **InboxItem**: An unprocessed task in `inbox.md` awaiting GTD clarification.
- **Project**: A markdown file under `projects/` with YAML frontmatter, an "Outcome" section, a "Next action" section (must contain at least one open task to be non-stale), and an "All tasks" section.
- **Area**: A markdown file under `areas/` representing an ongoing responsibility with no deadline or completion state.
- **VaultIndex**: Ephemeral `.todo/index.json` rebuilt on file change; enables fast `query()` calls without grepping every file.
- **TerminatorLink**: A navigational pointer stored as `key:value` metadata on a vault task or in the YAML frontmatter of a vault project, referencing a Terminator project or workspace by its opaque UUID (exposed by the Extension API). The display name is resolved at render time and never stored in the vault file. Links are one-to-many (one vault item can link to multiple Terminator contexts). No data syncs across the link — it is navigation only. The link survives project/workspace renames because it stores the UUID, not the name.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Capturing a thought from the global hotkey to inbox.md takes under 5 seconds end-to-end.
- **SC-002**: The daily log view loads and displays all of today's tasks within 1 second of opening the extension.
- **SC-003**: All 8 MCP tools are callable from any MCP-compatible client with no per-client integration work beyond standard MCP configuration.
- **SC-004**: The projects browser correctly identifies 100% of stale projects (no open next action, OR no file edits in more than the configured inactivity threshold) without false positives.
- **SC-005**: The weekly review wizard can be completed in under 20 minutes for a vault with up to 20 active projects.
- **SC-006**: Vault files remain valid, parseable markdown after every write operation — no corruption under normal single-user conditions.
- **SC-007**: The extension works with any vault directory the user configures, including directories synced by git, iCloud Drive, or Dropbox.

## Assumptions

- Extension runs inside the existing Terminator Electron app shell using the established extension API as a permanent top-level sidebar tab, not as a workspace- or project-scoped extension.
- Single-user, single-vault — no multi-user or multi-vault support in this version.
- Sync is the user's responsibility (git, iCloud, Dropbox); the extension does not build or bundle a sync service.
- Mobile capture is out of scope; only the desktop extension is in scope.
- The weekly review's calendar step reads events from a user-configured ICS feed (URL or local file); the extension does not write to any calendar system.
- The global capture hotkey defaults to ⌘N; the user can rebind it in settings.
- Vault directory defaults to `~/vault` if not configured.
- The MCP server is bundled with the extension and starts automatically when the extension is loaded.
- No priorities, no color-coding, no kanban board, no graph view — intentional omissions per the PRD.
- Archive directory is excluded from the live index by default for performance on large vaults.
