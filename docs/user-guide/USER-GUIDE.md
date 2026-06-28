# Terminator User Guide

An end-to-end reference for every feature and extension in Terminator — an extension-first, AI-focused terminal emulator built on Electron.

---

## Table of Contents

1. [What is Terminator?](#1-what-is-terminator)
2. [Installation](#2-installation)
3. [The Interface at a Glance](#3-the-interface-at-a-glance)
4. [Workspaces & Projects](#4-workspaces--projects)
5. [Terminal Sessions](#5-terminal-sessions)
6. [Split Panes](#6-split-panes)
7. [Scratch Terminals](#7-scratch-terminals)
8. [Command Palette](#8-command-palette)
9. [Settings](#9-settings)
10. [Overview Screen](#10-overview-screen)
11. [Notification Center & Activity Indicators](#11-notification-center--activity-indicators)
12. [Keyboard Shortcuts](#12-keyboard-shortcuts)
13. [Extensions Overview](#13-extensions-overview)
14. [Extension: Git Integration](#14-extension-git-integration)
15. [Extension: SpecKit Pilot](#15-extension-speckit-pilot)
16. [Extension: Notepad](#16-extension-notepad)
17. [Extension: Task Vault](#17-extension-task-vault)
18. [Extension: Remote Control](#18-extension-remote-control)

---

## 1. What is Terminator?

Terminator is a developer-focused terminal emulator that organises work into a two-level hierarchy — **Workspaces** (repository-level) and **Projects** (task-level) — with persistent terminal sessions that stay alive as you navigate between them. Extensions add capabilities such as Git integration, spec-driven AI coding pipelines, markdown notes, task management, and remote terminal access, all without modifying the core application.

---

## 2. Installation

### From a packaged release (macOS)

1. Download the `.dmg` from the [latest release](../../releases/latest).
2. Mount the `.dmg` and drag **Terminator** to your Applications folder.
3. Because the app is not notarized, run the following once before opening:

```bash
xattr -cr /Applications/Terminator.app
```

4. Open Terminator normally from your Applications folder.

### From source

```bash
git clone <repo-url>
cd terminator
npm install
npm run dev
```

**Prerequisites:** Node.js 20 LTS+, Python setuptools (`pip3 install setuptools --break-system-packages` on macOS with Python 3.12+), and `git` on your `PATH`. The `gh` CLI is optional but required for GitHub PR features.

---

## 3. The Interface at a Glance

![Main overview](screenshots/01-main-overview.png)

The window is divided into three zones:

| Zone             | Description                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Left rail**    | Collapsed workspace group names. Click to expand a workspace in the main sidebar.                                                                                                  |
| **Main sidebar** | Expanded workspace showing its projects and terminal sessions. Search bar at the top. Icon row (grid / wifi / notepad / calendar / bell / +) for quick access to extension panels. |
| **Content area** | Tabbed area on the right showing the active terminal session and extension tabs (Terminal, SpecKit, Git).                                                                          |

The **status bar** at the bottom of the window shows live CPU, Memory, and Network figures when the global metrics bar is enabled in Settings.

---

## 4. Workspaces & Projects

![Sidebar workspaces](screenshots/03-sidebar-workspaces.png)

### Workspaces

A workspace maps to a directory on disk — typically a git repository. Each workspace appears as a named, colour-coded card in the left rail. Click a workspace name to expand it in the main sidebar.

- **Create a workspace:** Click `+` in the sidebar header and choose a directory.
- **Color coding:** Each workspace has a distinct accent colour visible in the rail and project headers.
- **Keyboard access:** `Cmd+1`–`Cmd+9` focuses and expands the corresponding workspace; `Cmd++` / `Cmd+-` cycles through them.
- **Toggle sidebar:** `Cmd+B`.

### Projects

Projects live inside a workspace and hold one or more terminal sessions scoped to a task or branch.

- **Create a project:** Click `+ New project` inside any expanded workspace.
- **Sessions per project:** A project can hold multiple named terminal tabs. Sessions are grouped under the project name in the sidebar.
- **Per-workspace settings:** Theme, scrollback limit, and default shell can be overridden per workspace via Settings.

---

## 5. Terminal Sessions

![Terminal session](screenshots/02-terminal-session.png)

Terminal sessions are powered by **xterm.js** backed by **node-pty** in the main process. Sessions are **never destroyed** when you switch tabs or navigate the sidebar — the buffer, scroll position, and running process survive intact.

### Opening sessions

- **New tab in project:** Click `+` in the tab bar or press `Cmd+T`.
- **New scratch terminal:** Press `Cmd+Shift+T` or click the `~` button in the workspace rail (see [Scratch Terminals](#7-scratch-terminals)).

### Navigating tabs

- `Cmd+Left` / `Cmd+Right` — cycle through tabs.
- Click any tab to switch to it.
- Drag tabs left or right to reorder them; order persists for the lifetime of the app session.

### Clickable links

URLs and absolute file paths in terminal output are **underlined on hover**. `Cmd+click` a URL to open it in your system browser; `Cmd+click` a file path (e.g. `/Users/foo/bar.ts` or `~/project/file.go`) to open it with the default application. Line:col suffixes like `file.go:42:5` are stripped before opening.

### Useful shortcuts

| Action                                                        | Shortcut      |
| ------------------------------------------------------------- | ------------- |
| New tab                                                       | `Cmd+T`       |
| Close focused pane / active tab                               | `Cmd+W`       |
| Clear terminal                                                | `Cmd+K`       |
| Send newline (always)                                         | `Cmd+Enter`   |
| Send newline (bracketed paste mode, e.g. inside `claude` CLI) | `Shift+Enter` |

---

## 6. Split Panes

Split panes let you view multiple terminals side by side without leaving the current project.

- **Split vertically (side by side):** `Cmd+D`
- **Split horizontally (top / bottom):** `Cmd+Shift+D`

Splits are **recursive** — each pane can be split again. Drag the divider bar to resize. Click a pane to focus it; a blue border marks the focused pane. `Cmd+W` closes the focused pane (collapsing the split) or the active tab when there is no split.

> **Note:** Split panes require an active project session. Scratch sessions do not support splits.

---

## 7. Scratch Terminals

![Scratch terminal](screenshots/15-scratch-terminal.png)

Scratch terminals give you an instant shell without selecting any workspace or project first.

- **Open a scratch terminal:** Click the `~` button in the workspace rail or press `Cmd+Shift+T`.
- Scratch sessions appear in a dedicated **SCRATCH** section at the bottom of the sidebar, beneath all workspace projects.
- **Promote a scratch session:** Right-click its tab and choose **Move to project…** to attach it to an existing project or create a new one.

---

## 8. Command Palette

![Command palette](screenshots/04-command-palette.png)

Press **`Cmd+P`** to open the command palette. Type to filter available actions — create sessions, navigate workspaces, toggle panels, and trigger extension commands. Press `Enter` to execute or `Esc` to close.

---

## 9. Settings

![Settings](screenshots/05-settings.png)

Open Settings with **`Cmd+,`** or via **View → Open Settings**.

### Global settings

| Section            | Options                                                   |
| ------------------ | --------------------------------------------------------- |
| **Interface**      | Theme (dark/light), show CPU/Memory/Network bar           |
| **Terminal**       | Default shell, scrollback limit                           |
| **Extensions**     | Enable/disable individual extensions                      |
| **Remote Control** | Enable local server, port, ngrok tunnel, session password |

### Per-workspace overrides

Expand any workspace in Settings to override the global theme, scrollback limit, and default shell for sessions in that workspace.

Themes switch immediately across the entire app — no restart required. Terminal colours re-apply live via a `MutationObserver`.

---

## 10. Overview Screen

![Overview screen](screenshots/12-overview-screen.png)

The overview screen displays a **full-screen tiled grid** of all open sessions. Each tile shows:

- A live canvas snapshot of the terminal (refreshed every ~3 seconds).
- The project name and session name.
- Per-session CPU% and memory usage.

Click any tile to navigate directly to that session.

**Open overview:** Click the **grid icon** in the sidebar header or press **`Cmd+Shift+I`**.

---

## 11. Notification Center & Activity Indicators

### Notification center

Click the **bell icon** in the sidebar header to open the notification center panel. It lists all in-app notifications — toasts, extension events, and any persistent notifications created by extensions.

- Per-notification **×** button to dismiss.
- **Mark all read** and **Clear all** buttons.
- Press `Esc` or click the backdrop to close.
- An unread count badge appears on the bell icon when there are unread notifications.
- Every toast automatically appears in the center so nothing is lost after auto-dismiss.

### Activity indicators

- A **spinning indicator** appears on workspace tiles, project cards, and session tabs while a terminal is running a command or producing output (1.5 s idle debounce).
- An **alert badge** (red dot + count) coexists alongside the spinner for sessions awaiting input.
- An **OS-level system notification** and Dock bounce fires on terminal bell.

---

## 12. Keyboard Shortcuts

| Action                              | Shortcut                 |
| ----------------------------------- | ------------------------ |
| Toggle sidebar                      | `Cmd+B`                  |
| Focus workspace 1–9                 | `Cmd+1`–`Cmd+9`          |
| Cycle workspaces                    | `Cmd++` / `Cmd+-`        |
| New tab                             | `Cmd+T`                  |
| New scratch terminal                | `Cmd+Shift+T`            |
| Close focused pane / active tab     | `Cmd+W`                  |
| Split pane vertically               | `Cmd+D`                  |
| Split pane horizontally             | `Cmd+Shift+D`            |
| Cycle tabs left/right               | `Cmd+Left` / `Cmd+Right` |
| Clear terminal                      | `Cmd+K`                  |
| Command palette                     | `Cmd+P`                  |
| Settings                            | `Cmd+,`                  |
| Toggle Git sidebar                  | `Cmd+Shift+G`            |
| Toggle Overview screen              | `Cmd+Shift+I`            |
| Send newline (always)               | `Cmd+Enter`              |
| Send newline (bracketed paste mode) | `Shift+Enter`            |

---

## 13. Extensions Overview

Extensions install from any directory on disk via a `manifest.json`. They contribute UI without modifying core code: sidebar items, sidebar panels, global tabs, workspace-scoped tabs, top-bar menu items, native View menu items, context menu entries, and terminal event hooks. Extension UIs run in isolated `WebContentsView` contexts — no app rebuild required after updates.

Terminator ships five built-in extensions:

| Extension           | What it adds                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| **Git Integration** | Live git status sidebar, staging/committing, PR creation, MergeFlow conflict resolver, Code Reviews tab |
| **SpecKit Pilot**   | Autonomous ticket-to-PR pipeline with 10 phases, Linear/Jira integration                                |
| **Notepad**         | Markdown notes, live preview, diagrams, tags, folders, full-text search                                 |
| **Task Vault**      | GTD+BuJo+PARA productivity vault with kanban, recurring tasks, weekly review                            |
| **Remote Control**  | Local HTTP/WebSocket server + optional ngrok tunnel for browser-based terminal access                   |

---

## 14. Extension: Git Integration

The Git integration is a workspace-scoped extension that surfaces git tooling directly inside the terminal window.

### Git sidebar

![Git sidebar](screenshots/06-git-sidebar.png)

Press **`Cmd+Shift+G`** or choose **View → Toggle Git Sidebar** to open a right-side panel showing:

- Live git status (staged, unstaged, untracked files) — auto-refreshes on file changes.
- Stage/unstage individual files or all files.
- Commit message field with a one-click **Commit** button.
- **Push** button with branch and remote info.
- PR creation via the `gh` CLI (requires `gh auth login`).

### Git tab

![Git tab](screenshots/07-git-tab.png)

The **Git** tab in the content area shows a full diff view with syntax-highlighted changes (red for removed lines, green for added). Use this for reviewing changes before committing.

### MergeFlow conflict resolver

When a `git merge` produces conflicts, a **"Resolve conflicts →"** button appears in the git sidebar. MergeFlow presents each conflict as a two-panel diff (yours vs. theirs) with author info and commit context for each side.

**Resolution actions per conflict:**

| Action                   | Key           |
| ------------------------ | ------------- |
| Keep Mine                | `M`           |
| Keep Theirs              | `T`           |
| Keep Both                | `B`           |
| Edit manually            | `E`           |
| Confirm                  | `Enter`       |
| Previous / Next conflict | `←` / `→`     |
| Undo last decision       | `Cmd+Z`       |
| AI suggestion panel      | `Cmd+Shift+A` |
| Close modal              | `Esc`         |

Resolution sessions persist across restarts. Once all conflicts are resolved, a single click stages all files and runs the merge commit.

### Code Reviews tab

The Code Reviews tab is a **workspace-scoped tab** — hover over a workspace card header to reveal the code review icon, then click to open it in the content area.

Features:

- Paginated queue of open/closed PRs with search by title or PR number.
- **Five filter pills:** All, High risk, Quick wins, In progress, Stale >3d.
- **Stat cards:** awaiting count, high-risk count, total review time, in-progress count.
- PRs scored across six signals: tests, coverage, CI, lint, churn, and blast radius.
- Chapter-by-chapter review surface with syntax-highlighted diffs and inline comment threading.
- One-click review submission (Approve / Request Changes / Comment) via `gh` CLI.
- **AI-era enhancements:** universal language-agnostic chapter grouping, semantic-only diff filter (hides formatting/whitespace-only hunks), DRY violation detection, large-PR cognitive load warning (>400 LOC) with estimated review time.
- **Pop-out window:** the ↗ button opens a dedicated focused review window restoring the exact PR, session, and view state.
- Review sessions (chapter position, file, scroll) persist across restarts.

---

## 15. Extension: SpecKit Pilot

![SpecKit tab](screenshots/08-speckit-tab.png)

SpecKit Pilot automates the full ticket-to-PR lifecycle across a **10-phase pipeline**:

```
Constitution → Specify → Clarify → Plan → Checklist → Tasks → Analyze → Implement → Self-review → Open PR
```

Claude Code runs autonomously as a subprocess per phase; **human approval gates** protect every phase boundary.

### Opening SpecKit Pilot

Click the **SpecKit** tab in the content area tab bar.

### 4-tab UI

| Tab             | Contents                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| **Tickets**     | Linear and Jira ticket queue; select a ticket to start a new feature run |
| **Features**    | All features with their current phase shown in a mini phase-rail per row |
| **Active runs** | Live view of the currently executing phase with output streaming         |
| **History**     | Completed and failed runs with full audit log                            |

### Workflow

1. Connect your Linear or Jira account in Settings → SpecKit Pilot (credentials stored in the main-process secrets store, never exposed to the renderer).
2. Open the **Tickets** tab, select a ticket, and click **Start**.
3. SpecKit creates a feature directory and begins running phases automatically.
4. At each phase boundary a gate appears — review the output and click **Approve** or **Request Changes**.
5. The **Implement** phase streams live batch check-in banners showing progress.
6. The **Self-review** gate runs `format + lint + coverage + /google-review` and summarises the quality report.
7. The **Open PR** gate prompts for a PR title before pushing.

State is persisted to `.pilot/state.json` inside each feature directory; audit log in `.pilot/history.json`.

---

## 16. Extension: Notepad

![Notes new note](screenshots/09-notes-tab.png)

Notepad is a full markdown note-taking extension with live preview, tags, folders, and Excalidraw diagrams.

### Opening Notepad

Click the **notepad icon** in the sidebar header icon row, or use `Cmd+Shift+N` to create a new note directly.

### Creating content

The **new item dialog** offers three types:

| Type        | Description                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Note**    | Markdown document with title, body, and tags. Saved as `.md` and included in bulk export.                                                     |
| **Diagram** | Freehand Excalidraw canvas (shapes, arrows, sticky notes, freehand drawing). Opens in a pop-out window via the ↗ button.                     |
| **Folder**  | Named container to organise notes and diagrams. Create from the sidebar header; rename or delete via right-click; drag items between folders. |

### Note features

- **Live preview** — toggle between edit and rendered Markdown view.
- **Margin comments** — pin comments at any position in the note body.
- **Full-text search** — type in the search bar to filter notes by content.
- **Multi-tag filter** — click the Tags button in the sidebar to open a multiselect dropdown and filter by one or more tags simultaneously.
- **Import/export** — export all notes and diagrams as a zip (`.md` files + `.excalidraw.json` files).

### Diagram features

- Draw shapes, arrows, sticky notes, and freehand lines on an Excalidraw canvas.
- Double-click any shape to edit its label in-place.
- **Canvas comments** — click the Comment button in the toolbar, click anywhere on the canvas to place a pin, write a comment, and reply or resolve threads inline. Comments follow the canvas as you zoom and pan.

---

## 17. Extension: Task Vault

![Task Vault with capture dialog](screenshots/10-task-vault-tab.png)

Task Vault is a **GTD + Bullet Journal + PARA** productivity extension backed by a SQLite database.

### Opening Task Vault

Click the **calendar icon** in the sidebar header icon row, or press **`Cmd+Shift+Space`** for the global quick-capture hotkey (works from any screen).

### Sidebar sections

| Section           | Contents                                                   |
| ----------------- | ---------------------------------------------------------- |
| **Today**         | Daily log for the current date, mini calendar on the right |
| **Inbox**         | Quick-captured items awaiting triage                       |
| **Projects**      | Named project containers for related tasks                 |
| **Areas**         | Ongoing responsibilities (PARA areas of focus)             |
| **History**       | Past daily logs                                            |
| **Weekly Review** | 6-step guided weekly review wizard                         |

### Quick capture

Press **`Cmd+Shift+Space`** from anywhere to open the **CAPTURE TO INBOX** dialog. Type using the natural syntax:

```
Task text… @project #area +context due:YYYY-MM-DD
```

Press `Enter` to save or `Esc` to dismiss.

### Task features

- **Recurring tasks** — set daily/weekly/biweekly/monthly recurrence; the engine automatically ensures exactly one future open instance exists at all times.
- **Task detail panel** — click any task to open a right-side panel with markdown-capable Description, Acceptance Criteria, and Dev Hints fields.
- **Ghost subtask row** — a faint `· + Add subtask…` row at the bottom of each open task expands inline on click.
- **Bidirectional links** — link vault items to specific terminal sessions.

### Kanban view

Click the **grid icon** in the Task Vault toolbar to switch to kanban view:

- Tasks displayed as cards in configurable lane columns.
- Drag cards between lanes to change their status.
- **Swimlanes** — group tasks by project or area.
- **Lanes editor** — add, rename, reorder, and remove lanes. Default lanes: Todo / In Progress / In Review / Done.
- Cards display a markdown-rendered description preview (capped at 2 lines).
- Lane config and view mode persist across restarts.

### Context filter

Click the **Context filter** button (always visible in the toolbar) to open a multiselect dropdown and filter all views by one or more `+context` tags.

### Calendar feed integration

During the Weekly Review, optionally connect an ICS calendar feed to surface scheduled events alongside your task review.

---

## 18. Extension: Remote Control

Remote Control enables you to access your Terminator terminals from **any web browser** over a local network or the internet.

### Configuration

Open **Settings → Remote Control** and:

1. Toggle the server **on**.
2. Choose a **port** (default: 7681).
3. Optionally enable an **ngrok tunnel** for a public URL (requires `brew install ngrok`).
4. Copy the **LAN URL** (e.g. `http://192.168.1.x:7681`) or the **public ngrok URL**.
5. Use **Show / Copy / Regenerate** to manage the session password (stored as a bcrypt hash).

### Accessing terminals in a browser

Navigate to the URL on any device. Log in with the session password. The server adapts to the viewport:

| Viewport                        | Experience                                                                                                                                                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop / tablet** (≥ 768 px) | Full Electron renderer via `/app/` — complete Terminator UI.                                                                                                                                                                                                                                 |
| **Mobile** (< 768 px)           | Purpose-built mobile UI at `/mobile/`: scrollable workspace/terminal list, full-screen xterm.js terminal view with a control-key toolbar (Ctrl+C, Ctrl+D, Tab, Esc, ↑, ↓), and automatic reconnect via the Page Visibility API (3 attempts × 2 s). Tested on iOS 16+ / Android 12+ (Chrome). |

---

## Developing an Extension

Extensions install from any local directory. Create a directory with a `manifest.json`:

```json
{
  "id": "com.example.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "Does something useful",
  "main": "src/index.js",
  "minAppVersion": "0.1.0"
}
```

Scaffold a new extension in seconds:

```bash
npm run create-extension -- my-extension
```

See [docs/EXTENSION-DEVELOPMENT.md](../EXTENSION-DEVELOPMENT.md) for the full API reference including global tabs, global shortcuts, and the Extension SDK at `packages/extension-sdk/`.

---

_For architecture details see [docs/ARCHITECTURE.md](../ARCHITECTURE.md). For contributing guidelines see [docs/CONTRIBUTING.md](../CONTRIBUTING.md)._
