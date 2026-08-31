# Terminator User Guide

An end-to-end reference for every feature and extension in Terminator — an extension-first, AI-focused terminal emulator built on Electron.

---

## Table of Contents

1. [What is Terminator?](#1-what-is-terminator)
2. [Installation](#2-installation)
3. [The Interface at a Glance](#3-the-interface-at-a-glance)
4. [Repos & Branches](#4-repos--branches)
5. [Terminal Sessions](#5-terminal-sessions)
6. [Split Panes](#6-split-panes)
7. [Scratch Terminals](#7-scratch-terminals)
8. [Command Palette](#8-command-palette)
9. [Settings](#9-settings)
10. [Issue Tracking](#10-issue-tracking)
11. [Overview Screen](#11-overview-screen)
12. [Notification Center & Activity Indicators](#12-notification-center--activity-indicators)
13. [Keyboard Shortcuts](#13-keyboard-shortcuts)
14. [Extensions Overview](#14-extensions-overview)
15. [Extension: Git Integration](#15-extension-git-integration)
16. [Extension: SpecKit Pilot](#16-extension-speckit-pilot)
17. [Extension: Notepad](#17-extension-notepad)
18. [Extension: Task Vault](#18-extension-task-vault)
19. [Extension: Remote Control](#19-extension-remote-control)

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

| Zone             | Description                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Left rail**    | Collapsed workspace group names. Click to expand a workspace in the main sidebar.                                                                                |
| **Main sidebar** | A labelled app band at the top (Overview, Notes, Remote Control, Task Vault, Git Changes), then search, then every repo with its branches and terminal sessions. |
| **Content area** | Tabbed area on the right showing the active terminal session and extension tabs (Terminal, SpecKit, Git).                                                        |

The **status bar** at the bottom of the window shows live CPU, Memory, and Network figures when the global metrics bar is enabled in Settings.

---

## 4. Repos & Branches

![Sidebar workspaces](screenshots/03-sidebar-workspaces.png)

### Workspaces

A workspace maps to a directory on disk — typically a git repository. Each workspace appears as a named, colour-coded card in the left rail. Click a workspace name to expand it in the main sidebar.

- **Create a workspace:** Click `+` in the sidebar header and choose a directory.
- **Color coding:** Each repo has a distinct accent colour, and the sidebar wears it: a branch header is washed in a muted version of that colour, and the wash and its left-edge marker carry on unbroken down every row beneath it — the branch switcher, each session, and the `+ New branch` row that closes the run — with hovering or selecting a row keeping the highlight in the same hue. A workspace's rows therefore read as one continuous territory, separated from the next workspace by a hairline rather than a gap. A session row takes the colour from its own branch, so it stays right even when the sidebar is grouped by status or by branch, where one group holds sessions from several workspaces. Scratch terminals belong to no workspace and stay on the neutral surface.
- **Keyboard access:** `Cmd+1`–`Cmd+9` focuses and expands the corresponding workspace; `Cmd++` / `Cmd+-` cycles through them.
- **Toggle sidebar:** `Cmd+B`.

### Projects

Projects live inside a workspace and hold one or more terminal sessions scoped to a task or branch.

- **Create a branch:** Click `+ New branch` under any repo. A branch can be a plain checkout or its own git worktree; the sidebar marks which with a distinct glyph.
- **Sessions per branch:** A branch can hold multiple named terminal tabs. Sessions are grouped under the branch in the sidebar, and the session tab bar states which branch's terminals it is showing.
- **Per-workspace settings:** Theme, scrollback limit, and default shell can be overridden per workspace via Settings.

---

## 5. Terminal Sessions

![Terminal session](screenshots/02-terminal-session.png)

Terminal sessions are powered by **xterm.js** backed by **node-pty** in the main process. Sessions are **never destroyed** when you switch tabs or navigate the sidebar — the buffer, scroll position, and running process survive intact.

### Opening sessions

- **New tab on this branch:** Click `+` in the tab bar or press `Cmd+T`.
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

Split panes let you view multiple terminals side by side without leaving the current branch.

- **Split vertically (side by side):** `Cmd+D`
- **Split horizontally (top / bottom):** `Cmd+Shift+D`

Splits are **recursive** — each pane can be split again. Drag the divider bar to resize. Click a pane to focus it; a blue border marks the focused pane. `Cmd+W` closes the focused pane (collapsing the split) or the active tab when there is no split.

> **Note:** Split panes require an active branch session. Scratch sessions do not support splits.

---

## 7. Scratch Terminals

![Scratch terminal](screenshots/15-scratch-terminal.png)

Scratch terminals give you an instant shell without selecting any repo or branch first.

- **Open a scratch terminal:** Click the `~` button in the workspace rail or press `Cmd+Shift+T`.
- Scratch sessions appear as a **Scratch** group at the bottom of the sidebar, with a count like any other group.
- **Promote a scratch session:** Right-click its tab and choose **Move to branch…** to attach it to an existing branch or create a new one.

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
| **Integrations**   | Connect Linear and Jira — see below                       |
| **Extensions**     | Enable/disable individual extensions                      |
| **Remote Control** | Enable local server, port, ngrok tunnel, session password |

### Integrations — connecting an issue tracker

**Settings → Integrations** is the only place Terminator asks for a tracker credential, and every
part of the app reads that one connection. Linear and Jira can both be connected, independently.

| Tracker    | What you provide                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| **Linear** | API key. Optionally an email, to list someone else's assigned issues instead of the key's own account. |
| **Jira**   | Site (`your-team.atlassian.net`), account email, API token, and a JQL query defining "my issues".      |

**The credential is checked before it is kept.** Terminator calls the tracker with it first, so a
mistyped key is rejected there and then, with the tracker's own message, rather than turning up
later as an empty issue list. Nothing is stored unless it works.

**Where it lives.** Encrypted with your operating system's keychain (`safeStorage`) in
`integrations.json` in the app's data directory, and read only inside the main process. No part of
the interface can ask for it back — status only ever reports _whether_ a tracker is connected and
_which account_ the credential proved to belong to. The connect and disconnect actions are also
the only two settings deliberately unavailable over Remote Control: an authenticated browser on
your LAN still has no business writing your API keys.

**Already used SpecKit Pilot?** Your Linear and Jira credentials move across automatically the
first time you launch a build with this feature. You will not be asked for them again, and the
extension's old credential file is renamed `.bak` rather than deleted.

**Disconnecting** destroys that tracker's credential and leaves the other one alone. Anything you
had linked to a branch stays linked — it is your association, not the tracker's — and starts
working again as soon as you reconnect.

### Per-workspace overrides

Expand any workspace in Settings to override the global theme, scrollback limit, and default shell for sessions in that workspace.

Themes switch immediately across the entire app — no restart required. Terminal colours re-apply live via a `MutationObserver`.

---

## 10. Issue Tracking

Terminator attaches a **Linear or Jira issue to a branch**, so the thing you are working on is on
screen — and so every agent session you start there already knows it.

Connect a tracker first: [Settings → Integrations](#9-settings).

### Attaching an issue to a branch

A branch can carry **one** issue at a time — a branch is a unit of work, and so is a ticket.

**To attach one**: right-click the branch in the sidebar → **Link issue…**. The picker opens on
the issues assigned to you across every connected tracker, so the common case needs no typing.
Type to search, or type an issue key exactly (`TAV-42`) to jump straight to it. Each row shows
which tracker it came from, because two trackers can both have a `TAV-42` and they are different
issues.

You can also reach it from the command palette (`⌘K`) with **Link Issue to Project**, scoped to
whichever branch you are in.

**The badge.** Once attached, the branch's row in the sidebar carries the issue key with a small
dot:

| Dot            | Meaning                                       |
| -------------- | --------------------------------------------- |
| Dim            | Backlog or not started                        |
| Amber          | In progress                                   |
| Green          | Done or cancelled                             |
| Dashed outline | Terminator could not read the issue right now |

The dot is never the only signal — hover the badge for the tracker, the state by name, and the
issue title, and screen readers get the same text. Clicking the badge opens the issue.

**Changing it.** Picking a different issue **replaces** the one attached; you are warned before it
happens. Right-click the branch for **Change linked issue…**, **Copy issue key**, **Open … in
tracker**, or **Unlink**.

**Removing a branch** discards its association with it. Nothing is left behind.

### Reading an issue

Click the issue key on a branch to open it. Description and comments are **rendered** — headings,
lists, task lists, tables, code blocks, links and emphasis all appear as formatted text, the same
whether the issue came from Linear or from Jira.

Issue text is treated as untrusted: embedded HTML never runs, images are not loaded (a remote image
in a ticket is a tracking pixel aimed at whoever opens it), and links open in your browser rather
than navigating the app.

The panel also carries **Refresh** (fetches current data, ignoring the cache), **Comment**, and
**Unlink**. If a comment fails to post you are told, and what you typed stays in the box.

If the issue cannot be read right now — tracker down, credential expired — the panel says so and
keeps the attachment. Your link is yours; it does not disappear because a tracker had a bad minute.

### What your agent sessions are told

This is the point of attaching an issue. With one attached, **any agent session started in that
project already knows it** — you do not paste the ticket in.

That includes a session you start yourself, at an ordinary shell prompt in the project directory,
outside Terminator entirely. It is not a launch flag; it is a hook registered in the project.

**What it gets**, in this order: the issue key, title, tracker, state, assignee, labels and URL,
then the description, then the most recent handful of comments. Header first on purpose — if the
context has to be shortened, it costs discussion, never the identity of what you are working on.

**How much.** The agent runtime caps this at 10,000 characters. Terminator enforces that itself and
shows you the number, rather than letting the runtime silently swap your context for a file path.
Long descriptions are trimmed near 4,000 characters and a closing line tells the agent it was
shortened and where to read the rest. You can see the exact text and its size before any session
starts.

**You are told when it happens** — a notification naming the issue and the character count. It is
an ordinary notification, so turn it down to the notification centre, or off, in Settings.

**Turning it off** for a project stops it for new sessions and removes what was written into that
project's directory. Sessions already running are unaffected.

### What Terminator writes into your project

To make the above work, Terminator adds one hook to **`.claude/settings.local.json`** in the
project's directory. That file is gitignored by convention and is not the shared, checked-in
`.claude/settings.json`, which Terminator never reads or writes.

The rules it holds to:

- It **merges**. Any `SessionStart` hooks you already had stay, along with every other setting.
- If it cannot parse the file, it **refuses** rather than overwriting it.
- **Unlinking removes it.** If the file is then empty it is deleted, and if Terminator created the
  `.claude` directory, that goes too — your project directory ends up exactly as it started.
- If the directory is not writable, **linking fails and tells you why**. It will not leave you with
  an issue that looks attached but silently feeds nothing.

The hook itself runs a small script that reads one file and prints it. It holds no credential,
makes no network request, and knows nothing about your trackers.

Terminals opened in a linked project also carry `TERMINATOR_ISSUE_KEY` and
`TERMINATOR_ISSUE_TRACKER` in their environment, for your own scripts and prompts.

### Writing back to your tracker

Terminator **never changes a field on an issue** — not its state, not its assignee, nothing. The
only thing it can write is a comment, and only in two places:

- **You press Comment** in the issue panel.
- **A pull request opens** for a SpecKit Pilot card whose issue is attached — and this is
  **off by default**.

> **Behaviour change.** That pull-request comment used to fire whenever its setting happened to be
> on, and its failures were discarded silently — so nobody could tell a comment that posted from
> one that never had. It is now off unless you turn it on, in the SpecKit Pilot settings, and when
> it fails you are told. **If you were relying on it, switch it back on.**

---

## 11. Overview Screen

![Overview screen](screenshots/12-overview-screen.png)

The overview screen displays a **full-screen tiled grid** of all open sessions. Each tile shows:

- A live canvas snapshot of the terminal (refreshed every ~3 seconds).
- The project name and session name.
- Per-session CPU% and memory usage.

Click any tile to navigate directly to that session.

**Open overview:** Click the **grid icon** in the sidebar header or press **`Cmd+Shift+E`**.

---

## 12. Notification Center & Activity Indicators

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

## 13. Keyboard Shortcuts

| Action                               | Shortcut                 |
| ------------------------------------ | ------------------------ |
| Toggle sidebar                       | `Cmd+B`                  |
| Focus workspace 1–9                  | `Cmd+1`–`Cmd+9`          |
| Cycle workspaces                     | `Cmd++` / `Cmd+-`        |
| New tab                              | `Cmd+T`                  |
| New scratch terminal                 | `Cmd+Shift+T`            |
| Close focused pane / active tab      | `Cmd+W`                  |
| Split pane vertically                | `Cmd+D`                  |
| Split pane horizontally              | `Cmd+Shift+D`            |
| Cycle tabs left/right                | `Cmd+Left` / `Cmd+Right` |
| Clear terminal                       | `Cmd+K`                  |
| Command palette                      | `Cmd+P`                  |
| Settings                             | `Cmd+,`                  |
| Toggle Git sidebar                   | `Cmd+Shift+G`            |
| Toggle Overview screen               | `Cmd+Shift+E`            |
| Send newline (always)                | `Cmd+Enter`              |
| Send newline (bracketed paste mode)  | `Shift+Enter`            |
| Leave an extension, back to terminal | `Esc` `Esc`              |

### Leaving an extension

Press `Esc` twice in quick succession (within half a second) inside any extension — Notes, Task Vault, Git Integration, SpecKit Pilot, Remote Control — and Terminator returns you to the terminal session you were last in. Extension sidebar panels close in place; full-screen extension tabs close and reveal the terminal behind them.

It takes two presses because extensions use a single `Esc` for their own dismissals — closing a dropdown, cancelling a rename, dismissing a dialog. The first press still goes to the extension, so nothing is stolen; the second is what leaves. `Esc` inside a terminal always goes to the shell and never exits anything.

---

## 14. Extensions Overview

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

## 15. Extension: Git Integration

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
- **Five filter pills:** All, High risk, Quick wins, In progress, Stale >3d. In the queue, a PR's risk is classified by total lines changed (≥400 = high, ≥150 = medium) so large diffs surface under **High risk** immediately; opening a PR refines its risk with per-file analysis (churn, blast radius, coverage, complexity).
- **Stat cards:** awaiting count, high-risk count, total review time, in-progress count.
- PRs scored across six signals: tests, coverage, CI, lint, churn, and blast radius.
- Chapter-by-chapter review surface with syntax-highlighted diffs and inline comment threading.
- One-click review submission (Approve / Request Changes / Comment) via `gh` CLI.
- **AI-era enhancements:** universal language-agnostic chapter grouping, semantic-only diff filter (hides formatting/whitespace-only hunks), DRY violation detection, large-PR cognitive load warning (>400 LOC) with estimated review time.
- **Pop-out window:** the ↗ button opens a dedicated focused review window restoring the exact PR, session, and view state.
- Review sessions (chapter position, file, scroll) persist across restarts.

---

## 16. Extension: SpecKit Pilot

![SpecKit tab](screenshots/08-speckit-tab.png)

SpecKit Pilot automates the full ticket-to-PR lifecycle across a **10-phase pipeline**:

```
Constitution → Specify → Clarify → Plan → Checklist → Tasks → Analyze → Implement → Self-review → Open PR
```

Each phase runs Claude Code **in a terminal you can see**, in the card's own
worktree project — it appears in the sidebar, you can read it, and you can type
into it at any time without the pilot losing track. **Human approval gates**
protect every phase boundary, and every tool call the agent makes is held until
somebody decides.

For small changes you can flip a card to **Quick fix** at hand-off, which skips the upfront spec/analysis phases and runs a short pipeline instead:

```
Plan → Implement → Self-review → Open PR
```

Each run happens in the card's own git **worktree** on a dedicated branch (the Linear-suggested branch name when the card came from a Linear ticket, otherwise `<git-username>/<ticket-key>-<kebab-title>`), so the base branch is never touched. If a run goes sideways, **Reset / start over** on the card removes the worktree + branch, wipes the run history, and returns the card to a clean, re-dispatchable state (the brief and ticket are kept).

### Opening SpecKit Pilot

Click the **SpecKit** tab in the content area tab bar.

### Supervising what is running

Above the board are two panels that answer "does anything need me?".

**Waiting on you** lists every tool call an agent is holding. Allow it, deny it,
answer it in words, or hand it back to the terminal to deal with there. Nothing
in that run moves until you do — after five minutes it is handed back
automatically rather than left hanging.

**Supervision** has four sections:

| Section    | Answers                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| **Runs**   | what is running, what state it is in, how long, how much it has changed |
| **Stalls** | what stopped making progress without asking for anything                |
| **Review** | what is finished and waiting on you, worst risk first                   |
| **Feed**   | what happened, and a roll-up of what happened since you last looked     |

Every run offers the same six actions: go to its **Terminal**, read its
**Transcript**, **Interrupt** it (ends the turn, keeps the session, so your next
message lands), **Redirect** it, **Stop** it, or **Discard** it — which ends it
and removes its worktree and branch.

The **command palette** (`Cmd+P`) carries every live run and every diff waiting
on review, blocked ones first. Choosing one takes you straight there.

### Review, and why a fourth agent gets refused

A finished turn with changes is graded by what it touched — **P0** for auth,
payments, secrets, migrations or a public API, down to **P3** for a lockfile
bump — and the grade is always shown with the reason for it. You accept or
reject **hunk by hunk**, not file by file, because one file routinely holds both
the change you asked for and the one you did not.

With **three diffs unreviewed, a new run is refused** and says so. Overriding is
one click and is recorded with how deep the queue was at the time.

Stall detection ships in **shadow mode**: stalls are recorded and shown, never
notified, until you have judged a week of them against your own read. Turn it off
in Settings once the thresholds have earned it.

### Workflow

1. Connect your Linear or Jira account in Settings → SpecKit Pilot (credentials stored in the main-process secrets store, never exposed to the renderer).
2. Your assigned tickets load onto the board automatically when SpecKit Pilot opens (deduped, so reopening never creates duplicates); use **Import ticket** to refresh on demand. Open a card and click **Start** to run it.
3. SpecKit creates a feature directory and begins running phases automatically.
4. At each phase boundary a gate appears — review the output and click **Approve** or **Request Changes**.
5. The **Implement** phase streams live batch check-in banners showing progress.
6. The **Self-review** gate runs `format + lint + coverage + /google-review` and summarises the quality report.
7. The **Open PR** gate prompts for a PR title before pushing.

Each SpecKit-mode phase invokes the project's native SpecKit skill (`/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, …) rather than a freeform prompt, so artifacts land in the right feature directory and the agent doesn't wander. This requires the SpecKit Claude skills to be installed (`.claude/skills/speckit-*`, via the `specify` CLI) and reachable in the run's worktree.

**Answering the agent.** If a phase asks a question (e.g. during
`/speckit-clarify`), answer it in the **Waiting on you** panel, or open the run's
terminal and answer it where the agent is — both work, and the pilot follows
either.

State is persisted to `.pilot/state.json` inside each feature directory; audit log in `.pilot/history.json`.

---

## 17. Extension: Notepad

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
- **Outline** — the open note's headings, in the right rail above the comments, nested by heading level. Click one to jump the editor to that heading. With the comments open the two split the rail evenly — half each, whatever either one holds; with one closed the other takes the whole rail. Close the outline from the button in its header and bring it back with **Outline** in the toolbar; closing both gives the whole width to the editor. The same panel is in a popped-out note window. Headings inside fenced code blocks are not listed, and depth is measured from the note's own top heading, so a note that starts at `##` is not indented for it.
- **Margin comments** — pin comments at any position in the note body.
- **Full-text search** — type in the search bar to filter notes by content.
- **Multi-tag filter** — click the Tags button in the sidebar to open a multiselect dropdown and filter by one or more tags simultaneously.
- **Import/export** — export all notes and diagrams as a zip (`.md` files + `.excalidraw.json` files).

### Diagram features

- Draw shapes, arrows, sticky notes, and freehand lines on an Excalidraw canvas.
- Double-click any shape to edit its label in-place.
- **Canvas comments** — click the Comment button in the toolbar, click anywhere on the canvas to place a pin, write a comment, and reply or resolve threads inline. Comments follow the canvas as you zoom and pan.

---

## 18. Extension: Task Vault

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

## 19. Extension: Remote Control

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
