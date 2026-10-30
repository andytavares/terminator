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
8. [Quick Actions](#8-quick-actions)
9. [Settings](#9-settings)
10. [Issue Tracking](#10-issue-tracking)
11. [Home, the Overview Wall and Usage](#11-home-the-overview-wall-and-usage)
12. [Notification Center & Activity Indicators](#12-notification-center--activity-indicators)
13. [Keyboard Shortcuts](#13-keyboard-shortcuts)
14. [Extensions Overview](#14-extensions-overview)
15. [Extension: Git Integration](#15-extension-git-integration)
16. [Extension: Foundry](#16-extension-foundry)
17. [Extension: Notepad](#17-extension-notepad)
18. [Extension: Task Vault](#18-extension-task-vault)
19. [Extension: Remote Control](#19-extension-remote-control)

---

## 1. What is Terminator?

Terminator is a terminal emulator for developers. It organises work in two levels: **Workspaces** (one per repository) and **Projects** (one per task). Terminal sessions stay alive while you move between them. Extensions add Git integration, spec-driven AI coding pipelines, markdown notes, task management and remote terminal access. They do not change the core application.

---

## 2. Installation

### From a packaged release (macOS)

1. Download the `.dmg` from the [latest release](https://github.com/andytavares/terminator/releases/latest).
2. Mount the `.dmg` and drag **Terminator** to your Applications folder.
3. Open Terminator from your Applications folder. The app is signed and notarized, so macOS opens it without a warning.

### From source

```bash
git clone <repo-url>
cd terminator
npm install
npm run dev
```

**Prerequisites:** Node.js 24.21.0 (`.nvmrc`), Python setuptools for packaging (`pip3 install setuptools --break-system-packages` on macOS with Python 3.12+), and `git` on your `PATH`. The `gh` CLI is optional. GitHub PR features need it.

---

## 3. The Interface at a Glance

![Main overview](screenshots/01-main-overview.png)

The window has three zones:

| Zone             | Description                                                                                                                                                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Left rail**    | Collapsed workspace group names. Click one to expand a workspace in the main sidebar.                                                                                                                                                                                                                                  |
| **Main sidebar** | A compact row of app icons at the top (Home, Overview, Notes, Remote Control, Task Vault, and the notification bell), then search with the Filter and Display menus, then every repo with its branches. Terminals are not listed here. They are tabs above the terminal, rows on Home, and tiles on the Overview wall. |
| **Content area** | The tabbed area on the right. It shows the active terminal session and extension tabs (Terminal, Foundry, Git).                                                                                                                                                                                                        |

The **status bar** at the bottom of the window shows live CPU, Memory and Network figures when the global metrics bar is enabled in Settings.

---

## 4. Repos & Branches

![Sidebar workspaces](screenshots/03-sidebar-workspaces.png)

### Workspaces

A workspace maps to a directory on disk, usually a git repository. Each workspace appears as a named, colour-coded card in the left rail. Click a workspace name to expand it in the main sidebar.

- **Create a workspace:** Click `+` in the sidebar header and choose a directory.
- **Color coding:** Each repo has a distinct accent colour. The colour appears in two places only: a thin rail down the left edge of the repo's branches, and a small swatch beside the repo's name. Everything else in the column is neutral. Hovering and selecting a row look the same for every repo, so a branch's state draws your eye, not its colour. Scratch terminals belong to no repo and draw no rail.
- **Keyboard access:** `Cmd+1`–`Cmd+9` focuses and expands the corresponding workspace. `Cmd++` / `Cmd+-` cycles through them.
- **Toggle sidebar:** `Cmd+B`.

### Projects

Projects live inside a workspace. A project holds one or more terminal sessions scoped to a task or branch.

- **Create a branch:** Hover a repo's header and click `+`. A branch is usually its own git worktree. The sidebar marks the exception: a plain checkout gets a small branch glyph, and a worktree has no mark.
- **Naming:** A branch takes its name from its git branch. You have nothing else to name and nothing to rename. If you check out a different branch in a plain checkout's own terminal, its card follows within a moment. A worktree's branch is fixed when you create it. (A workspace whose folder is not a git repository has no branch to take a name from. There, Terminator asks you for a name and you can rename it.)
- **Terminals per branch:** A branch can hold several named terminal tabs. The tab bar above the terminal lists them. The sidebar does not. Each tab has its own state glyph and unread bell count, and shows its description on hover. The tab bar states which branch's terminals it shows.

- **What a branch row tells you:** The row shows the branch state, folded from its terminals: waiting on you beats working, working beats idle, idle beats exited. It also shows the name, any linked issue key, how much has changed on the branch, and either how many terminals share that state or how long since the branch was last active. A branch with no terminals is still listed and reads as idle.

- **Ordering the list:** **Display → Sort** orders the whole column, both the repo headers and the branches under each one. **Name** is alphabetical. **Recent** and **Oldest** go by when a branch last did something (a repo takes the most recent of its branches). **Status** puts what is waiting on you at the top. **Manual** is the order you dragged things into. Drag a repo header to move a repo. Drag a branch row to move it within its repo. A drop switches the view to **Manual**, because any other sort would recompute the order and discard the drag. Terminator saves your order and keeps it after a restart. You cannot drag branches under **Display → Group → None**. There, one list spans every repo, so no per-repo order exists to write.

- **Grouping by task:** **Display → Group → Task** lists each task as a header, marked with its state glyph (the same five as Home). The task's lanes are beneath it, one row per repo. Branches that are in no task go under **Not in a task**. **Workspace** is the default. Terminator remembers your choice. A task's lanes are named by repo and branch. See [Making a task](#making-a-task).
- **Add to task…:** Right-click a branch and choose **Add to task…** to put it in an open task or start a new task from it. A terminal's tab has the same item.

- **Collapsing a repo:** Click its header. A collapsed repo still shows a marker if a branch inside is waiting on you, so you cannot hide the one thing you needed to see.

- **Open in your editor:** Right-click a branch and choose **Open in ‹editor›** to open the branch's working copy. This is its own worktree when it has one, otherwise the repo it was checked out from. A repo's header has the same item, and it opens the repo folder. Terminator finds your editor itself. It looks for Cursor, VS Code, Windsurf, Zed, Sublime Text, WebStorm, IntelliJ and Xcode. It prefers an editor whose command-line launcher is installed, because that opens the folder in a window you already have. To pin one editor, set `ui.editor` in settings to its id (`cursor`, `vscode`, `windsurf`, `zed`, `sublime`, `webstorm`, `intellij`, `xcode`). Leave it empty to keep detecting. The menu item is hidden when no editor is found, and in the browser remote, which has no local editor to launch.
- **Per-workspace settings:** You can override the theme, scrollback limit and default shell for each workspace in Settings.

---

## 5. Terminal Sessions

![Terminal session](screenshots/02-terminal-session.png)

**xterm.js** powers terminal sessions, backed by **node-pty** in the main process. Terminator **never destroys** a session when you switch tabs or move around the sidebar. The buffer, scroll position and running process stay intact.

### Opening sessions

- **New tab on this branch:** Click `+` in the tab bar or press `Cmd+T`.
- **New scratch terminal:** Press `Cmd+Shift+T` or click the `~` button in the workspace rail (see [Scratch Terminals](#7-scratch-terminals)).

### Navigating tabs

- `Cmd+Left` / `Cmd+Right` — cycle through tabs.
- Click any tab to switch to it.
- Drag tabs left or right to reorder them. The order lasts for the app session.

### Clickable links

URLs and absolute file paths in terminal output are **underlined on hover**. `Cmd+click` a URL to open it in your system browser. `Cmd+click` a file path (for example `/Users/foo/bar.ts` or `~/project/file.go`) to open it with the default application. Terminator strips line:col suffixes such as `file.go:42:5` before it opens the file.

### Moving a terminal to its own window

Any terminal can live in its own window. Use this for a second screen, or to keep an agent in view while you work on another branch. The process, scrollback and agent state carry over. Nothing restarts.

- **Move it out:** Press `Cmd+Shift+O`, choose **Window → Move Terminal to Its Own Window**, run **Move to its own window** from Quick Actions (`Cmd+P`), or drag its tab and release it outside every Terminator window. The window opens when you let go. `Escape` cancels the drag.
- **Bring it back:** Drag its tab from the window's header onto the main window, press `Cmd+Shift+O` in that window, or close the window. Closing never ends the session.

The terminal always returns to the branch it came from, at its old tab position, even if you have moved to another branch since. `Cmd+W` in a terminal's own window closes that session.

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

Split panes show multiple terminals side by side without leaving the current branch.

- **Split vertically (side by side):** `Cmd+D`
- **Split horizontally (top / bottom):** `Cmd+Shift+D`

Splits are **recursive**: you can split each pane again. Drag the divider bar to resize. Click a pane to focus it. A blue border marks the focused pane. `Cmd+W` closes the focused pane (which collapses the split), or the active tab when there is no split.

A split belongs to the tab where you made it. A new tab opens on its own terminal, which takes the keyboard. When you go back to the split tab, its panes show again.

> **Note:** Split panes need an active branch session. Scratch sessions do not support splits.

---

## 7. Scratch Terminals

![Scratch terminal](screenshots/15-scratch-terminal.png)

A scratch terminal gives you an instant shell. You do not select a repo or branch first.

- **Open a scratch terminal:** Click the `~` button in the workspace rail or press `Cmd+Shift+T`.
- Scratch sessions appear as a **Scratch** group at the bottom of the sidebar, with a count like any other group.
- **Promote a scratch session:** Right-click its tab and choose **Move to branch…** to attach it to an existing branch or create a new branch.

---

## 8. Quick Actions

![Quick actions](screenshots/04-quick-actions.png)

Press **`Cmd+P`** from anywhere (a terminal, Home, Overview, or any extension view) to open Quick Actions. This panel lists every action on screen, in groups, with a one-letter mnemonic for each. It works the same way whether or not you remember the letter.

### The letter map

At the top level, each row is a group or a direct action. Its box shows the letter that reaches it:

| Key                     | Opens                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `t`                     | **Terminal…** — new tab, split right/down, close, clear, new scratch terminal, edit note, prev/next tab |
| `s`                     | **Sessions…** — jump to any open session, searchable                                                    |
| `w`                     | **Workspace…** — switch workspace, cycle, link/view/open the linked issue                               |
| `x`                     | **Custom…** — your own shell and prompt actions (below)                                                 |
| `g`                     | **Git** — commit, push, pull, create PR, open Git, open Code Reviews                                    |
| `n`                     | **Notes** — new note, open Notes                                                                        |
| `v`                     | **Task Vault** — capture to inbox, open Task Vault, open the calendar                                   |
| `f`                     | **Foundry** — new work order, open Foundry, jump to the run that needs you                              |
| `h` `o` `u` `a` `b` `,` | Home, Overview, Usage, next session waiting on you, toggle sidebar, Settings — direct, one press        |

A letter acts at once: `g` then `p` pushes the focused branch. You do not press `Enter`. `Backspace` goes back up one level. An action you cannot run now (no repository focused, no linked issue, and so on) still shows, dimmed, with the reason in place of its description. Press it to see the reason at the bottom of the panel. It does not run.

### Search

Press **`/`** (or `Cmd+P` again while the panel is open) to switch to fuzzy search. Search matches the action's label, its group and its description. Typing "push" finds **Git: Push** although "push" is not in the group name. Arrow keys move the highlight. `Enter` runs the action. `Backspace` on an empty query goes back to the letter map.

### Pins and recent

The actions you use most rise to a **Pinned & recent** row at the top, before any group. It shows your pins, then your most-used actions by recency and frequency. Highlight a row and press **`Cmd+.`** to pin or unpin it, or hover a row and click its pin icon. Terminator saves pins and usage locally and keeps them after a restart.

If the surface you are on has its own group (Foundry's tab, the Git view, Notes), that group's actions rank first, above the pinned/recent row. Those are almost always the actions you want next.

### Learning the direct shortcuts

Every action that also has a direct keyboard shortcut shows it (`⌘D` next to Split right, for example). Run an action from the panel three times and the reminder stops. Until then, running it shows a small "Next time: `⌘D`" toast, so you learn the shortcut without a second lookup.

### Custom actions

Add your own actions in **Settings → Quick actions**. Add them globally, or per workspace to scope one to a repo. Each action has:

- A **label** and an optional one-character **key**.
- A **kind**: a **shell command** or a **Claude prompt**.
- A **target**: a shell command runs in the **focused terminal** or opens a **new tab on the branch**. A prompt always goes to the **focused Claude session**.
- A **body**, with variables filled in when the action runs: `{cwd}` `{branch}` `{worktree}` `{repo}` `{issue}` `{selection}`.

They show up under **`x`** (Custom) in the panel, with all other actions.

**When a custom action does not run:**

- A variable with nothing to fill it (no linked issue, no text selected, and so on) disables the action and shows the specific reason. The body never runs with a variable left empty.
- Terminator refuses a shell action aimed at the focused terminal if that terminal runs Claude ("use a new tab" instead).
- Terminator refuses a prompt action if the focused session is not a Claude session, or if Claude is mid-turn ("Claude is mid-turn"). A prompt sent into the middle of a response would be typed over.
- Terminator refuses a shell command longer than 1024 bytes after its variables are filled in. It does not send the command. The terminal silently mangles a line that long, so Terminator tells you instead of corrupting it.

---

## 9. Settings

![Settings](screenshots/05-settings.png)

Open Settings with **`Cmd+,`** or **View → Open Settings**.

### Global settings

| Section            | Options                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| **Interface**      | Theme (dark/light), show CPU/Memory/Network bar, hide the branch tree on Home |
| **Terminal**       | Default shell, scrollback limit                                               |
| **Agents**         | Default agent and your own ACP agents — see below                             |
| **Integrations**   | Connect Linear — see below                                                    |
| **Extensions**     | Enable/disable individual extensions                                          |
| **Remote Control** | Enable local server, port, ngrok tunnel, session password                     |

### Integrations — connecting an issue tracker

**Settings → Integrations** is the only place where Terminator asks for a tracker credential. Every part of the app reads that one connection.

| Tracker    | What you provide                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| **Linear** | API key. Optionally an email, to list someone else's assigned issues instead of the key's own account. |

**Terminator checks the credential before it keeps it.** Terminator calls the tracker with the credential first. If you mistype a key, Terminator rejects it there and then, with the tracker's own message. You do not find out later from an empty issue list. Terminator stores nothing unless the credential works.

**Where it lives.** Terminator encrypts the credential with your operating system's keychain (`safeStorage`) in `integrations.json` in the app's data directory. Only the main process reads it. No part of the interface can ask for it back. Status only reports _whether_ a tracker is connected and _which account_ the credential proved to belong to. The connect and disconnect actions are also the only two settings that Remote Control deliberately does not allow. An authenticated browser on your LAN has no business writing your API keys.

**Disconnecting** destroys the credential. Anything you linked to a branch stays linked, because it is your association, not the tracker's. It works again as soon as you reconnect.

### Per-workspace overrides

Expand any workspace in Settings to override the global theme, scrollback limit and default shell for sessions in that workspace. A new terminal in one of its projects opens in the workspace's own shell. **Use global default** beside a setting hands that one setting back to the global value. It leaves the workspace's other overrides alone.

Themes switch at once across the entire app. You do not restart. Terminal colours re-apply live through a `MutationObserver`.

---

## 10. Issue Tracking

Terminator attaches a **Linear issue to a branch**. The thing you work on is on screen, and every agent session you start there already knows it.

Connect a tracker first: [Settings → Integrations](#9-settings).

### Attaching an issue to a branch

A branch can carry **one** issue at a time. A branch is a unit of work, and so is a ticket.

**To attach one**: right-click the branch in the sidebar → **Link issue…**. The picker opens on the issues assigned to you across every connected tracker, so the common case needs no typing. Type to search, or type an issue key exactly (`TAV-42`) to jump straight to it. Each row shows which tracker it came from, because two trackers can both have a `TAV-42` and they are different issues.

You can also reach it from [Quick Actions](#8-quick-actions) (`⌘P` → `w` → `l`) with **Link issue to project**, scoped to the branch you are in.

**The key.** Once attached, the branch's row in the sidebar carries the issue key as plain text. Click it to open the issue drawer. It used to be a bordered badge with its own state dot. The key alone already said what those said. The paragraph below describes the state colours as they appear in the drawer and the picker.

**The badge.** Once attached, the branch's row in the sidebar carries the issue key with a small dot:

| Dot            | Meaning                                       |
| -------------- | --------------------------------------------- |
| Dim            | Backlog or not started                        |
| Amber          | In progress                                   |
| Green          | Done or cancelled                             |
| Dashed outline | Terminator could not read the issue right now |

The dot is never the only signal. Hover the badge for the tracker, the state by name, and the issue title. Screen readers get the same text. Click the badge to open the issue.

**Changing it.** If you pick a different issue, it **replaces** the attached one. Terminator warns you before it happens. Right-click the branch for **Change linked issue…**, **Copy issue key**, **Open … in tracker**, or **Unlink**.

**Removing a branch** discards its association with the issue. Nothing is left behind.

### Reading an issue

Click the issue key on a branch to open the issue. Description and comments are **rendered**: headings, lists, task lists, tables, code blocks, links and emphasis all appear as formatted text.

Terminator treats issue text as untrusted. Embedded HTML never runs. Images are not loaded (a remote image in a ticket is a tracking pixel aimed at whoever opens it). Links open in your browser and do not navigate the app.

The panel also has **Refresh** (fetches current data and ignores the cache), **Comment**, and **Unlink**. If a comment fails to post, Terminator tells you, and what you typed stays in the box.

If the issue cannot be read now (tracker down, credential expired), the panel says so and keeps the attachment. Your link is yours. It does not disappear because a tracker had a bad minute.

### What your agent sessions are told

This is the point of attaching an issue. With one attached, **any agent session started in that project already knows it**. You do not paste the ticket in.

That includes a session you start yourself, at an ordinary shell prompt in the project directory, outside Terminator entirely. It is not a launch flag. It is a hook registered in the project.

**What it gets**, in this order: the issue key, title, tracker, state, assignee, labels and URL, then the description, then the most recent handful of comments. The header comes first on purpose. If the context must be shortened, the cut costs discussion and never the identity of what you work on.

**How much.** The agent runtime caps this at 10,000 characters. Terminator enforces that cap itself and shows you the number. Otherwise the runtime would silently swap your context for a file path. Terminator trims long descriptions near 4,000 characters, and a closing line tells the agent that the text was shortened and where to read the rest. You can see the exact text and its size before any session starts.

**Terminator tells you when it happens.** A notification names the issue and the character count. It is an ordinary notification, so you can turn it down to the notification centre, or off, in Settings.

**Turning it off** for a project stops it for new sessions and removes what Terminator wrote into that project's directory. Sessions that already run are unaffected.

### What Terminator writes into your project

To make the above work, Terminator adds one hook to **`.claude/settings.local.json`** in the project's directory. By convention, git ignores that file. It is not the shared, checked-in `.claude/settings.json`, which Terminator never reads or writes.

Terminator follows these rules:

- It **merges**. Any `SessionStart` hooks you already had stay, along with every other setting.
- If it cannot parse the file, it **refuses** and does not overwrite the file.
- **Unlinking removes it.** If the file is then empty, Terminator deletes it. If Terminator created the `.claude` directory, that goes too. Your project directory ends up exactly as it started.
- If the directory is not writable, **linking fails and tells you why**. It will not leave an issue that looks attached but silently feeds nothing.

The hook runs a small script that reads one file and prints it. It holds no credential, makes no network request, and knows nothing about your trackers.

Terminals opened in a linked project also carry `TERMINATOR_ISSUE_KEY` and `TERMINATOR_ISSUE_TRACKER` in their environment, for your own scripts and prompts.

### Writing back to your tracker

Terminator **never changes a field on an issue**: not its state, not its assignee, nothing. It can write only a comment, and only in two places:

- **You press Comment** in the issue panel.
- **A pull request opens** for a Foundry order whose issue is attached. This is **off by default**.

> **Behaviour change.** That pull-request comment used to fire whenever its setting happened to be on, and Terminator silently discarded its failures. Nobody could tell a comment that posted from one that never had. It is now off unless you turn it on, in the Foundry settings. When it fails, Terminator tells you. **If you relied on it, switch it back on.**

---

## 11. Home, the Overview Wall and Usage

### Home, the Tasks layout

Terminator opens on **Home**. Home answers two questions: what needs you, and what your tasks are doing. A **task** is one piece of work. It can span several repos, such as `rate-limits` in `terminator`, `api-gateway` and `web-console`, and it shows as one row. The header holds the **Today | Insights** switch, **Search** (`Cmd+K`) and **Start work** (`Cmd+N`).

![Home: one question in Needs you, and one task across three repos under it](screenshots/11a-home-tasks.png)

Top to bottom, Home holds:

- **The pulse line.** Each of the five states, with the number of tasks in it. Press a count to narrow Home to that state. Press it again to clear. Empty states are left out.
- **The plan strip.** One line until you plan the day or press **Skip today**. **Plan** (`P`) opens the plan sheet (see [Plan today](#plan-today)).
- **Needs you.** One queue across every task (see below). With nothing waiting, it is one line: "Nothing needs you.", and the number of running agents.
- **Tasks.** One row per task, grouped by state in a fixed order: needs you, running, waiting on others, quiet, done. Quiet and Done tasks each fold into one line. Press **Show** to open it. **Group** changes the grouping to repo or none. A row shows the state, the title, the repos the task touches, what is happening now and when it last moved. The star marks a task as today's focus.
- **The footer.** This week's shipped pull requests and how long agents waited on you, **Open Insights**, and **Archived tasks**.

While Home shows, the branch tree is hidden, so Home has the whole window. `Cmd+B` shows the tree for as long as you stay on Home. To keep the tree beside Home, turn off **Hide the branch tree on Home** in **Settings → Interface**.

#### The five states

Every surface draws a task's state with the same five shapes, so you can tell them apart without colour. A task takes the most urgent state among its lanes. Each state comes from something Terminator can see:

| State                 | What sets it                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Needs you**         | Claude Code reported a question or a permission request, a check failed on your pull request, or a review is yours to do |
| **Needs you**, hollow | A terminal rang its bell, or a numbered choice is on screen, and Claude Code did not report it                           |
| **Running**           | A Claude Code turn is in progress. For a terminal that is not Claude Code, it printed output in the last few seconds     |
| **Waiting on others** | Checks are running, a review was requested, or the pull request is in a merge queue                                      |
| **Quiet**             | None of the above                                                                                                        |
| **Done**              | Every lane's pull request is merged and its terminals are closed, or you pressed **Mark done**                           |

A hollow, dashed **Needs you** is a guess. Terminator saw a sign that an agent is waiting, but the agent did not say so. The row and the task drawer name the sign, for example "Inferred: a numbered choice is on screen". It sits in the queue below the reported questions. A missed question leaves an agent waiting for good, while a false one costs a glance. It goes away when the agent prints again or you type into its terminal. It turns solid if Claude Code then reports it.

No timer moves a task. A quiet task stays quiet until something happens on it. Only you mark a task done or archive it.

#### Needs you

The **Needs you** queue lists everything that waits on you, from Terminator and from extensions: an agent's question, an agent that finished while you were away, a failing check on your pull request, a review you owe, a Foundry decision, a task that is due. Asks that Claude Code reported come first, then guessed ones, oldest and hottest first. Each row says where it comes from, what it asks and how long it has waited. The **Home** icon counts the asks and reads out as "Home, 3 need you".

Open an ask (click it, or press `Enter`) and it expands. You see the agent's last screen as text, its numbered answers as buttons and a field to **Reply in your own words**. Press **1**–**9** to pick that answer, **R** to reply, **T** to open the terminal and `Esc` to close. Terminator types a numbered answer into the terminal as if you had typed the number. First it reads the screen again and checks that the question is still the same. If you already answered in the terminal, it sends nothing. **E** marks an ask done. **H** snoozes it until an hour from now, this afternoon or tomorrow. A snoozed ask wakes early if the work moves.

Claude Code reports through its hooks. On start, Terminator adds `SessionStart`, `Notification`, `UserPromptSubmit`, `Stop` and `StopFailure` entries to your own `~/.claude/settings.json`. Each entry runs one small script, `claude-hook.cjs`. The script records which terminal is asking, or that a turn started or ended, and writes nothing else. `UserPromptSubmit` and `Stop` make a thinking agent read **Running** even while it prints nothing. To remove the entries, quit Terminator. Then delete the entries under `hooks.SessionStart`, `hooks.Notification`, `hooks.UserPromptSubmit`, `hooks.Stop` and `hooks.StopFailure` whose command mentions `claude-hook.cjs`. A terminal that is not Claude Code still asks by ringing the bell or leaving a numbered choice on screen. It reads Running from its output.

#### Opening a task

Press a task row, or `Enter` on it, to open its **drawer**.

![A task's drawer: one lane per repo, the lane that is asking marked](screenshots/11c-home-task-drawer.png)

The drawer holds:

- a short written summary of what is happening and what blocks it (Terminator asks Claude Code, with no tools, to read the agents' latest messages and the pull request);
- **Lanes**: one row per repo and branch, with its state, the lines changed, and its pull request and checks when it has them. A lane with no pull request shows no pull request line. **Answer** or **Open** goes to that lane's terminal;
- **Add a repo** (makes a worktree on the same branch name in another repo) and **Add a branch I already have**;
- the terminals on the task, how long they have run and their tokens, and a timeline;
- the buttons **Open all lanes**, **Link a ticket**, **Rename**, **Mark done** and **Archive**.

**Mark done** finishes a task that will never have a pull request. **Archive** hides a task without finishing it. Both keep the task's records and list it under **Archived tasks** in the footer. There, **Restore** (or **Undo done**) brings it back. `Esc` closes the drawer. Right-click a row for the same actions and for **Dismiss**, which hides a row from Home. The toast has **Undo**.

#### Making a task

A branch that is in no task is still a task of one lane, so you do not have to make a task. To join work, use one of these:

- **Start work → Across repos** (`Cmd+N`, then the **Across repos** tab). Enter a title such as "Rate limits across services". The branch name follows the title (`rate-limits-across-services`) until you type your own. Tick the repos. Choose how to run it (**an agent in an agent tab**, **Claude in a terminal**, **Terminal only**, or **Foundry**). Optionally add a ticket and a first prompt for each agent. Press **Start 3 lanes**. Terminator makes a worktree on that branch in each repo, opens a terminal in each and records one task. If a repo already has the branch name, that repo says so, and nothing starts until you fix the name or untick the repo.
- **Add to task…** on work already under way. It is on a branch row in the sidebar, on a terminal's tab, on an Overview tile (right-click it), and on a Home row's menu. The picker lists open tasks and **+ New task from api-gateway/rate-limits**. If other repos have a branch of the same name, the picker offers to add them too. They join only when you confirm.

- **Drag one Home row onto another** to merge them. The row you drop on keeps its name and takes every lane of the row you dragged. The dragged task is gone afterwards. A toast says what moved, with **Undo**. You cannot merge a row with no branch.

A ticket linked to several branches joins them as a task, and Terminator stores nothing. The task becomes a stored task the first time you rename it, star it or add a lane.

#### Switching tasks

- **Lane switcher.** When the terminal on screen belongs to a task with two or more lanes, the tab bar shows the task's name and a button per repo. Press a button to move to that repo's branch. `Ctrl+1`–`Ctrl+9` (`Alt+1`–`Alt+9` on Windows and Linux; **Window → Switch Lane**) does the same, by the lane's place in the row. A lane that is asking carries the needs-you mark, even when the terminal on screen belongs to another lane.
- **`Cmd+J`** (**Window → Switch Task…**) opens a switcher over any screen. Tasks have the same order and shapes as on Home. `Enter` opens the task's most recent lane. `Cmd+Enter` opens its drawer.
- **Sidebar.** **Display → Group → Task** lists each task with its lanes beneath, and the branches in no task under **Not in a task**. **Workspace** stays the default. Terminator remembers your choice.

#### Start work

**Start work** (`Cmd+N`, the header button, or Quick Actions) opens a launcher with five tabs:

- **My tickets** lists your open Linear tickets by state. Type to search.
- **Prompt** starts from a sentence that describes the task.
- **Branch** starts on an existing branch.
- **Across repos** starts one task in several repos (see above).
- **Scratch terminal** opens a terminal that belongs to no branch.

Press `Tab` to choose how to run it: as an **agent in an agent tab** (the default agent, with a picker when you have more than one), **Claude in a terminal**, **Terminal only**, or a **Foundry** order. In an agent tab, the ticket is the agent's first prompt and has no length limit. The agent's questions show in the tab and on Home. **Claude in a terminal** types `claude '<prompt>'` into a shell and refuses a prompt over 1024 bytes. The **Workspace** button at the right of the tabs shows where the work will run and why Terminator suggested that workspace. Press the button or `Cmd+R` to pick another. Type to filter, and press `Enter` to choose. `Enter` starts the work, and Terminator opens what it started so you land in it.

#### Search

`Cmd+K` puts the cursor in **Search work**. It filters both Needs you and the task list by what a row says: the ticket key and title, the repo, the branch, the description and the question.

#### Keyboard

| Key          | Does                                              | Where                   |
| ------------ | ------------------------------------------------- | ----------------------- |
| `J` / `K`    | Next and previous item                            | Needs you, Tasks        |
| `Enter`      | Expand an ask, or open the task drawer            | Both                    |
| `1`–`9`      | Pick that numbered answer                         | An expanded ask         |
| `R`          | Reply in your own words                           | An expanded ask         |
| `E`          | Done: remove it from the queue                    | Needs you               |
| `H`          | Snooze: 1 hour, this afternoon, tomorrow          | Needs you               |
| `T`          | Open the terminal                                 | Any item with a session |
| `P`          | Open the plan sheet                               | Home                    |
| `G` then `I` | Switch to Insights; `G` then `D` returns to Today | Home                    |
| `Cmd+K`      | Search                                            | Home                    |
| `Cmd+J`      | Switch task                                       | Everywhere              |
| `Ctrl+1`–`9` | Switch to that lane of the task on screen         | Everywhere              |
| `Cmd+N`      | Start work                                        | Everywhere              |
| `Cmd+P`      | Quick actions                                     | Everywhere              |
| `Cmd+B`      | Show or hide the branch tree                      | Home                    |

The single-letter keys act only while focus is inside Home. They never act while a terminal or a text field has focus, so typing a reply never moves the selection.

#### The Classic layout

To keep the earlier layout, set **Settings → Interface → Home layout** to **Classic**. Classic is the Desk: a summary line, the **Your move** band, the **In flight** list and the **Today** rail, with the same answers and keys. Its rows use the same five states and the same drawer. Neither layout has a stage bar. Tasks, **Add to task…**, the sidebar's **Group → Task** and `Cmd+J` work with both.

### Insights

![Insights, a card for each question](screenshots/11b-home-insights.png)

**Insights** is the second view of Home, for looking back. The title of each card is the question it answers. No card compares you with anyone else. **This week**, **30 days**, **Quarter** and **Year** at the top choose the range that every card covers.

- **How much shipped?** Merged pull requests, against the range before. It comes from Git integration.
- **How long from start to merge?** The median days from a ticket's first session to its merge, and the middle half. It needs at least three merged tickets in the range. Until then the card says **Not enough merged work yet** and does not guess.
- **How long do agents wait on me?** The median time an agent waited for your answer, the number of asks, and the number that waited over 30 minutes.
- **How often does it pass first time?** The share of Foundry orders whose checks passed on the first try. It is hidden when Foundry publishes nothing.
- **How am I spending agent time?** Agent hours, the number of agents that ran at once, the share that finished without asking you, and Foundry orders shipped. Below them, **Tokens** and **Estimated cost** come from the agents' own conversation files. The cost is an estimate from public prices. It says **partial** when a model had no price.
- **When do I ship?** A view that an extension adds to Insights. Git integration's contribution heatmap lives here. **Show contributions on Insights** in Git Integration's settings switches it off.
- **Looking back** gathers the longest wait on you and the oldest review you owe.

A card with no number to show says why. It does not show a made-up number. Terminator keeps 90 days of how agents waited, so **Year** shows at most that much of it.

### Plan today

On the first view of Home each day, a one-line **Plan today** strip sits under the pulse line. **Plan** (`P`) opens it as a sheet. **Skip today** hides the strip until tomorrow. The sheet starts with a line such as "Yesterday you finished 2 of 3 focus items." It has up to three columns. A column with nothing to show is left out.

- **Carried over** lists focus items you picked yesterday and did not finish, and your open Task Vault tasks for today.
- **Tickets** lists your tickets, when an issue tracker is connected. Without a tracker, the sheet ends with a note to connect Linear in **Settings → Integrations**.
- **Open tasks** lists your open tasks. Press one to star it. **Today's focus** has three slots. A starred task fills the next free slot, and the star shows on the task's row on Home and in `Cmd+J`. A task that has been quiet for three days or more says so, for example "quiet 4 days", with an **Archive** button. Terminator archives nothing unless you press it.

A line under the columns says how many agents already run, across how many tasks. **Start the day** or **Skip today** closes the sheet and hides the strip until tomorrow. In the Classic layout, the same plan opens above the Desk.

### Saying what a session is for

A session with no ticket can say what it is for. Right-click its tab and choose **Add description…** (or press `Cmd+I`). Type an answer and press `Enter`. On Overview, the tile asks **What is this session doing?** in place. Terminator saves the description at once and keeps it after a restart. On Home, the description names the work: the row and its drawer show your words when no ticket does. Terminator keeps a described or linked session for 30 days after it ends.

**New terminal** on Overview and **Start work** on Home start a session on any branch, or a scratch terminal, without a trip to the sidebar. When you close a session, the terminal ends exactly as it does when you close its tab.

### Linking a session to a ticket

A session shows its branch's linked ticket by default. Right-click a session's tab or its tile and choose **Link issue…** to pin a different Linear ticket to that one session. This matters when two terminals on one branch serve different tickets. **Remove session link** hands the session back to its branch's ticket. You never change the branch's own link from here. With no tracker connected, the dialog tells you to connect one in **Settings → Integrations**. The ticket that briefs an agent at start-up still comes from the branch (see [What your agent sessions are told](#what-your-agent-sessions-are-told)).

### The Overview wall

![The Overview wall](screenshots/12-overview-screen.png)

**Overview** (`Cmd+Shift+E`) shows every open terminal as a live tile. The tile is named by repo, branch and session, with its ticket or description underneath. Sessions that wait on you are pinned double-width in a **Needs you** band at the top, with an amber border. Everything else follows, ordered by state unless **Then by** says otherwise. **Recently opened** orders by when you last opened each one. **Task** puts the tiles of one task together under a band with the task's name and the number of repos and terminals it spans. A change across `terminator`, `api-gateway` and `web-console` reads as one block. Terminals in no task follow. A tile still answers in place. Output never moves a tile.

Open a session from anywhere: a work thread's drawer, a tile, the sidebar, a tab, Quick Actions, or a notification. You land in its terminal with the cursor in it, ready to type.

A ticket linked to one terminal shows as its key on that terminal's sidebar row, on its tab, and on its branch's row while the branch is collapsed (with **+N** when its terminals carry more than one). Right-click either to link, change or remove the ticket. **Quick actions → Link issue** links the focused terminal, and **Link issue to branch** links the branch. An agent started in that terminal gets the terminal's own ticket as context, ahead of the branch's ticket.

When an agent waits on a numbered choice (a Claude Code permission prompt, for example), its options appear as buttons on the tile and in Home's Needs you queue. Press a button to answer as if you had typed the number. Terminator reads the screen again first. It sends nothing if the question has changed or you answered it in the terminal.

Terminator remembers tile size (**S**, **M**, **L**), **Pin sessions that need you** and **Then by**. Previews fill the tile's width and follow the cursor, so you see the newest line. On a very wide terminal, Large tiles are the readable size.

Terminator works out "Waiting on you" from what the terminal does: a bell, or a numbered choice left on screen when output stops. An agent that waits without either reads as idle.

### Agents

Terminator starts agents over the Agent Client Protocol (ACP) and shows each agent as an **agent tab**. Claude Code is built in. **Settings → Agents** sets the **Default agent** and lists your own. Any agent that speaks ACP works. Choose **Add agent** and give it an id, a label and the command line that starts it, for example `opencode acp`. Everywhere you start an agent (Start work, a thread's **New agent on this branch**, Send to agent), the agent tab is the default and **Claude in a terminal** stays available.

### Picking a Claude Code conversation back up

When a Claude Code session ends (you typed `/exit`, the terminal closed, or you quit Terminator), the conversation stays on disk. A **Resume** button appears on that session wherever it shows: its work thread's drawer on Home, and its Overview tile. Press it, and Terminator opens the conversation on the same branch, in the same folder. A conversation that ran in a terminal opens a terminal that runs `claude --resume`. A conversation that ran in an agent tab opens an agent tab. The new terminal takes over the old one's description and ticket link, and the exited tab closes, so there is one terminal per conversation.

After a restart, conversations from the last run wait with their Resume button. Terminator resumes nothing for you. A restart never starts agents on its own, so you choose which threads to pick up. A thread whose sessions have all ended stays in the task list until its pull request merges or closes, you archive it, or Terminator drops its records after 30 days. **Resume a conversation…** in Quick actions (`Cmd+P`) opens the drawer of the thread that holds the most recent conversation.

Resume appears only where it can work:

- Only for agent sessions: Claude Code in a terminal, or any agent in an agent tab. A plain shell has nothing to resume, and no button.
- Only once Terminator has seen the conversation. Terminator learns it from Claude Code itself, so the button appears a second or two after the agent starts. This includes a `claude` you typed yourself.
- If the conversation's transcript was deleted (agent tabs of agents that keep no transcript always offer Resume), or the record came from another machine, the session says **Conversation no longer available** in place of the button.

**How Terminator learns the conversation.** On first launch, Terminator adds a `SessionStart` entry (with the others described under Home) to your own `~/.claude/settings.json`. The entry runs a small script. The script records which conversation runs in which Terminator terminal, and writes nothing else. To turn the feature off, open that file and delete the entry under `hooks.SessionStart` whose command mentions `claude-hook.cjs`. Then restart Claude Code sessions. Terminator adds the entry again the next time it starts, so remove it after you quit Terminator if you want it to stay gone. Terminator touches nothing else in the file, and it never overwrites a settings file it cannot parse.

### Usage

**Usage** shows how much you use each feature of Terminator. Open it from its icon in the sidebar, with **Window → Usage**, or press `Cmd+P` and then `u`. To remove the icon, turn off **Show Usage in the sidebar** in **Settings → Appearance & Terminal**. The menu and `Cmd+P` still open it.

Terminator counts uses on this Mac only, in a local file, and sends nothing out. The header says **Counted on this Mac since** the first day it counted.

- **Period.** **7 days**, **30 days**, **90 days** or **All time** sets the range for every number. The default is 30 days.
- **Part.** The **All parts** menu narrows the screen to Core or to one extension.
- **Cards.** **Features used** counts the features used in the period, out of the features that exist now. **Not used** counts features used before the period but not inside it. **Never used** counts features never used since Terminator first saw them, and says how many more are new. **Active time** adds up the time you spent on screens and panels, with the three largest.
- **Table.** One group per part: Core first, then extensions by name. Each group says how many of its features were used and how many uses it had. Press a column header to sort. The default is **Uses**, highest first. **How it was reached** shows the path of each use: click, palette, shortcut or menu. **Failures** counts uses that failed.
- **Drawer.** Press a row to see the facts for that feature, a bar for each day, and how it was reached. A screen also lists the controls inside it, so you can see which parts of a screen nobody uses. `Esc` closes the drawer.

The state of a feature is a fact about the period, not a verdict:

| State                   | Meaning                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------- |
| **Used**                | One use or more inside the period.                                                      |
| **Not used in 30 days** | Used before the period, none inside it.                                                 |
| **Never used**          | No use since Terminator first saw the feature.                                          |
| **New**                 | Seen for the first time inside the period and not used yet, so a zero is not a verdict. |
| **Gone**                | An earlier version had the feature. This version does not.                              |
| **Extension off**       | The feature belongs to an extension that is installed and turned off.                   |

A state follows this order: Gone, Extension off, New, Never used, Not used in the period, Used. The chips above the table show how many features are in each state. Press one to narrow the table. Before anything is counted, the screen says **Nothing counted yet**.

---

## 12. Notification Center & Activity Indicators

### Notification center

Click the **bell icon** in the sidebar header to open the notification center panel. It lists all in-app notifications: toasts, extension events, and any persistent notifications that extensions create.

- Per-notification **×** button to dismiss.
- **Mark all read** and **Clear all** buttons.
- Press `Esc` or click the backdrop to close.
- An unread count badge appears on the bell icon when there are unread notifications.
- Every toast appears in the center automatically, so nothing is lost after it auto-dismisses.

### Activity indicators

- A **spinning indicator** appears on workspace tiles, project cards, and session tabs while a terminal runs a command or produces output (1.5 s idle debounce).
- An **alert badge** (red dot + count) appears next to the spinner for sessions that await input.
- A terminal bell fires an **OS-level system notification** and a Dock bounce.

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
| Move terminal to its own window      | `Cmd+Shift+O`            |
| Cycle tabs left/right                | `Cmd+Left` / `Cmd+Right` |
| Clear terminal                       | `Cmd+K`                  |
| Quick actions                        | `Cmd+P`                  |
| Settings                             | `Cmd+,`                  |
| Toggle Overview screen               | `Cmd+Shift+E`            |
| Open Home                            | `Cmd+~`                  |
| Switch task                          | `Cmd+J`                  |
| Switch to lane 1–9 of the task       | `Ctrl+1` – `Ctrl+9`      |
| Plan today (on Home)                 | `P`                      |
| Start work (on Home)                 | `Cmd+N`                  |
| Search Home                          | `Cmd+K` (on Home)        |
| Send newline (always)                | `Cmd+Enter`              |
| Send newline (bracketed paste mode)  | `Shift+Enter`            |
| Leave an extension, back to terminal | `Esc` `Esc`              |

### Leaving an extension

Press `Esc` twice in quick succession (within half a second) inside any extension (Notes, Task Vault, Git Integration, Foundry, Remote Control). Terminator returns you to the terminal session you were last in. Extension side panels close in place. Full-screen extension tabs close and reveal the terminal behind them.

It takes two presses because extensions use a single `Esc` for their own dismissals: closing a dropdown, cancelling a rename, dismissing a dialog. The first press still goes to the extension, so Terminator takes nothing from it. The second press leaves. `Esc` inside a terminal always goes to the shell and never exits anything.

---

## 14. Extensions Overview

Extensions install from any directory on disk through a `manifest.json`. They contribute UI without changing core code: sidebar items, sidebar panels, global tabs, workspace-scoped tabs, top-bar menu items, native View menu items, context menu entries, and terminal event hooks. Extension UIs run in their own frames inside the app window. An update needs no app rebuild.

Terminator ships five built-in extensions:

| Extension           | What it adds                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------ |
| **Git Integration** | Git tab for staging/committing, PR creation, MergeFlow conflict resolver, Code Reviews tab |
| **Foundry**         | A software factory: an idea becomes a work order that compiles, then a draft pull request  |
| **Notepad**         | Markdown notes, live preview, diagrams, tags, folders, full-text search                    |
| **Task Vault**      | GTD+BuJo+PARA productivity vault with recurring tasks                                      |
| **Remote Control**  | Local HTTP/WebSocket server + optional ngrok tunnel for browser-based terminal access      |

---

## 15. Extension: Git Integration

The Git integration is a workspace-scoped extension that puts git tooling inside the terminal window.

### Git tab

![Git tab](screenshots/07-git-tab.png)

Git lives in the **Git** tab above the terminal. The tab lists the changed files and names each state (**Changed**, **New**, **Added**, **Deleted**, **Renamed**, **Conflict**). It stages and unstages files, and it commits. It shows a syntax-highlighted diff of the selected file (red for removed lines, green for added). It refreshes on file changes.

Two settings in **Settings → Extensions → Git Integration** change the tab. **Max displayed changed files** (500 by default) sets how many changed files the list shows. With more files, the list says "Showing first N files." **Add sign-off to commits** commits with [`--signoff`](https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---signoff), which ends the message with a `Signed-off-by:` line that names you.

### The pull request queue

The queue opens with one line of triage: how many pull requests wait on you, how many are high risk, and roughly how long the reading is. Then it lists the open and draft pull requests, newest first. **Sort** switches to **Closest to merging** (approved with passing checks first, drafts last) or **Started by you** (reviews you have begun, most viewed first). Ties always fall back to newest first.

Search covers open pull requests. Add `is:merged`, `is:closed` or `is:all` to reach the rest, or type a number to open that pull request whatever its state. Those rows say **Merged** or **Closed**.

Each row has two lines: the title, then only what needs attention: Draft, Conflicts, **High risk**, CI failing, approvals, your progress. Medium and low risk say nothing. Click the row to open the diff. You approve after you have read the change, never from the list.

The count is the repository's real count, not the number loaded so far. Further pages arrive on their own, so you have no "load more" to press.

### The Reviews tab

**Reviews** in the app band lists every open pull request that needs you, across all your repositories, from GitHub search. **Needs you** groups them into **Re-review** (new commits since you reviewed), **Requested of you** and **Requested of your team**. **My PRs** shows what blocks your own pull requests (changes requested, CI failing, approved). **Involved** shows threads you are in. Each list is newest first, with the same **Sort** choices as the queue. A tab reads **50+** when GitHub returned its limit. The 50 shown are the newest. Click a row to open the PR in the review window. A repository you have not cloned opens diff-only. Set **Clone folder for reviews** in Git Integration's settings, and **Clone and review** appears on those rows.

### Reviewing a pull request

The review screen gives the code the room.

- **Header:** the back arrow to the overview, the title, the status checks, and your progress, drawn as one segment per chapter with the minutes left. Then **Ask agent**, then **Submit review**, which shows how many comments are pending. The **⋯** menu holds Focus mode, **Only my files**, Overview (`i`), Hide file list (`t`), Pause review, Refresh, Pop out and the keyboard sheet.
- **Only my files:** The **⋯** menu's **Only my files** shows only the changed files that the base branch's `CODEOWNERS` gives to you or to a team you are on, as GitHub's file filter does. A **My files** pill shows while the filter is on. Click the pill to turn the filter off. The item is off when you own none of the changed files, and the filter never leaves the review empty. It combines with Focus mode.
- **File list:** files grouped by chapter, with "2 of 3" viewed per chapter. Each row shows a mark (viewed, not viewed, or a red ring for a high-risk file you have not viewed yet), the name with its folder, its comment count and its size. Below 1,100px of width, the list folds to a rail of those marks.
- **File header:** the full path, size, and **High risk** only when the file really is (see [ADR-113](../adr/113-a-file-is-high-risk-by-fixed-thresholds.md)). A second line says why the file is here, which symbols from this PR it uses, and how often it changed in 90 days. **View** and **Viewed** (`v`) sit on the right.
- **Diff:** a gap of 20 lines or fewer is one control ("Show 8 unchanged lines"). A larger gap steps 20 lines above or below, or shows all of them. Each hunk names the function or class it sits in. Within a replaced line, the words that changed are tinted more strongly than the line. Comments are cards in the UI font, with a **Reply…** field.
- **Footer:** **? Shortcuts**, the previous file by name, and one primary button that names where it goes: **Viewed, next: api.py**, **Viewed, next chapter**, or on the last file **Viewed, submit review**.
- **Submit review:** lists your pending comments, takes a summary, and offers **Comment**, **Approve** or **Request changes**. It warns, without blocking, when files are still unviewed.
- **Side drawer:** **Ask agent** or a file's **High risk** chip opens a drawer over the right of the diff. Medium and low files open it from **Why this file** at the end of the file header's second line. It does not narrow the diff. **Why this file** lists each risk factor in words, the value, and the threshold it was compared with. **Agent** holds the review agent. Escape closes it.

- **Reading order.** Files come in the order you need them: a function before the code that calls it, a type before the code that uses it, a test right after what it tests. Each file says why it is where it is. **Uses** in the file header lists what the file uses and the step where you read it. **Peek definition** jumps there.
- **Unchanged lines.** A file opens on its changed lines only. The bar between two hunks, and above the first or below the last, shows **20 more lines** up or down, or **all** of them. Expansion resets when you open another file. Revealed lines take notes and agent questions but not GitHub comments, because GitHub's API accepts comments only on lines in the diff. You cannot expand files over 2 MB.
- **Tests for a block.** **Tests** on a hunk header, or on the bar under a selection, lists every line of a test file that mentions what that block defines (or the function it sits inside), searched at the PR's head. A test in the PR opens in the review at that line. Any other test opens in your editor.
- **Comments.** **All**, **Unresolved** or **Hidden** in the file header's **View** menu (`c` cycles), next to **Agent notes**, **Unified**/**Split** and **Hide formatting-only hunks**. A dot on **View** means something is off its default. Hidden leaves a count in the gutter. Click the count to bring the comments back. **Agent notes** has its own switch (`Shift+C`).
- **Overview.** The **⋯** menu's **Overview** opens the PR overview: a header with the title, people, size and **Start review**, a readiness strip (checks, reviews, merge), and **Overview** and **Discussion · N** tabs. The same overview opens from the Code Reviews tab. See the [Code Reviews tab](#code-reviews-tab) section below.
- **Agent.** Drag across line numbers, and a bar offers **Ask agent**, **Explain**, **Add note** and **Comment**. **Ask agent about this PR** reviews the whole PR. In the drawer, **This file** narrows a run to the file open in the diff, and **Whole PR** widens it again. The agent reads the PR in a private worktree with read-only tools. Its findings stay on your machine, as dashed notes in the diff and in the side panel, until you choose **Post as comment**. Sonnet is the default model. You can pick Opus per run.
- **Since your review.** When the author pushes, files you viewed that did not change stay viewed. Changed files show **Changed since you viewed** and open on just what changed since you looked (`s` toggles the whole PR). Terminator mirrors viewed marks to GitHub.
- **Where you left off.** If you come back after 15 minutes, a card shows your last position, your notes, unread agent findings, unsent drafts and what moved.
- **Drafts.** New comments collect as a pending review and go to GitHub together when you submit, so the author gets one notification.
- **Keyboard.** `?` shows every key: `k`/`j` next/previous hunk, `]`/`[` files, `n` next unviewed, `v` viewed, `a` ask agent, `m` note, `r` comment, `⌘↵` submit.

### MergeFlow conflict resolver

When a `git merge` produces conflicts, a **"Resolve conflicts →"** button appears in the Git tab. MergeFlow presents each conflict as a two-panel diff (yours vs. theirs) with author info and commit context for each side.

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

Resolution sessions persist across restarts. When you have resolved all conflicts, one click stages all files and runs the merge commit.

### Code Reviews tab

The Code Reviews tab is a **workspace-scoped tab**. Hover over a workspace card header to reveal the code review icon, then click it to open the tab in the content area.

Features:

- Paginated queue of open and draft PRs, newest first, with **Sort** and search (see "The pull request queue").
- In the queue, total lines changed classify a PR's risk (≥400 = high, ≥150 = medium). Opening a PR refines its risk with per-file analysis (churn, blast radius, coverage, complexity).
- PRs scored across six signals: tests, coverage, CI, lint, churn, and blast radius.
- **PR overview:** opening a PR shows, top to bottom:
  - **Header:** the title with its Draft or Open state, the author, `head → base`, when it was opened, files, `+added −removed` and the estimated reading time. **Start review** (or **Continue review · n of m viewed**) and, on a draft, **Mark as ready** sit at its right.
  - **Status strip:** three cells, **Checks**, **Reviews** and **Merge**, pinned under the header. A settled or quiet state is drawn faint. A blocker has a tinted cell with a red label and its own action (**Update from main** when the branch is behind, **Resolve conflicts** when it conflicts). Click **Checks** to see every check, failures first.
  - **Change tab:** the **Brief** (see Summarize), then the **Review plan**, one row per chapter with its risk, files, size and minutes. Click a row to start the review at that chapter. Then the author's **Description**, at a readable width and shortened. **Show full description** opens it. A rule separates each part.
  - **Discussion · N tab:** the conversation as a timeline, with the comment box at the end. Only the last three comments show. **Show N earlier comments** shows the rest. A long comment is shortened. **Show full comment** opens it.
  - **Properties rail:** beside both tabs, scrolling on its own. **Signals** (risk and its hotspot, tested functions, complexity, how hard it is to read, code-health flags; hover one for its source) and **Details** (author, branch with a copy button, base, opened date, head commit, linked issues).
    In a pane narrower than 900px, the rail becomes a third tab, **Properties**, the strip stacks and the two buttons move to a footer.
- **Summarize:** the Change and Discussion tabs offer to summarize the description or the discussion with the review agent's read-only `claude` (model, effort and timeout from the review agent settings). A description becomes a **Brief** of three parts: **Current state** and **What the change does** in one to three sentences each, then **Risks** as a bullet list, with a plain-text diagram only when the flow is hard to follow in words. A discussion becomes at most four points. Each shows when it was made and **Regenerate**. If it fails, the overview shows the reason in plain words with **Try again**. Terminator does not save the brief. Closing or reloading the overview drops it.
- Chapter-by-chapter review surface with syntax-highlighted diffs and inline comment threading.
- One-click review submission (Approve / Request Changes / Comment) through the `gh` CLI.
- **AI-era enhancements:** universal language-agnostic chapter grouping, semantic-only diff filter (hides formatting/whitespace-only hunks), DRY violation detection, large-PR cognitive load warning (>400 LOC) with estimated review time.
- **Pop-out window:** the ↗ button opens a dedicated focused review window that restores the exact PR, session, and view state.
- Review sessions (chapter position, file, scroll) persist across restarts.

---

## 16. Extension: Foundry

![Foundry](screenshots/08-foundry-tab.png)

Foundry is a **software factory**. You give it an idea, typed in or as a Linear issue. Foundry converges the idea into a **work order** that you can read and argue with. When the order compiles, Foundry hands it to an orchestration. The orchestration does the work, manages the agents, checks the result and opens a draft pull request.

Foundry replaces SpecKit Pilot's board and its ten-phase pipeline. The headline difference is how often it interrupts you. A one-line change used to cost nine decisions (eight phase approvals and a merge). It now costs **nought to two**, because nothing stops unless a **named rule** fires.

### Opening Foundry

Click the **Foundry** tab in the content area tab bar. Foundry has two surfaces, the Forge and the Ledger. You land on the Forge.

**The Forge tab carries a count when something waits on you.** Gates and waiting orders in the queue across its top, and open questions and held tool calls in the Forge itself, add to the count. The tab strip is above the scroll area, so the count is on screen whichever surface you look at.

### Waiting on you — the band across the top of the Forge

When a rule fires or an order waits on you, a band appears across the top of the Forge, above the list, the factory view or an open order. When nothing waits, there is no band. The band is one queue, always sorted by how much work each decision unblocks. Every row says:

- **which rule raised it** — `risk.p0`, `budget.exceeded`, `destructive`, `ready-for-review`, and five more;
- **what it asks**, on one line, with the risk, the pull request and ticket links and **what happens if you ignore it** (and whether it will wait for ever) under it;
- **the answers**, on the same line — the first is the recommended one;
- **why it fired**, and the evidence it looked at, when you click the row. The reason is formatted text. The evidence starts closed.

The gate that holds an order on its Floor uses the same line.

Above the gates, the band lists every order that waits on you without a gate: a draft **Ready to hand off**, a draft whose **Shaping stopped** (it names the check that still fails), or a run that **did not start** (it says why). Each row has an **Open** button that opens that order below. These rows count toward the Forge badge.

**The autonomy dial** (Settings → Foundry) decides which rules are live. Four are live at every setting: the highest risk grade, an exceeded budget, anything destructive, and marking a pull request ready. So **lights-out** opens a draft without you and still does not merge anything.

### Forge — where an idea becomes an order

Describe what you want built or fixed. Before Foundry asks you anything, it reads the repository: its manifests, its real commands, its house documents (`CLAUDE.md`, `AGENTS.md`, a constitution, `CONTRIBUTING.md`), and any past decision about a file that your idea names. A question that survives that is one the code could not answer.

An open order is a **frame**, not a page: **All orders** at the top, the order itself in the middle, and **Discard this order** / **Delete this order** along the foot. **Discard** marks an order cancelled and keeps its records. **Delete** removes the order and everything it made (its ledger, its run graph, its checkout and its branch). First it asks you to confirm in as many words.

Inside the frame, you **walk the order in steps**. The box has four parts:

- **The status strip** at the top says who holds the order now and what happens when they finish, for example **The red team is reviewing the plan · round 2 of 3 — When it finishes clean, you can hand off.** Foundry never starts new work on its own: nothing builds until you press **Hand off**. The one exception is an order you already handed off. If a defect sends it back and you press **Answer**, the amended order starts again by itself as soon as it passes every check. Blue means Foundry works and you need do nothing. Orange means only you can decide something. Red means something failed and needs a fix. Green means you can hand off, or Foundry has handed off the order.
- **The step list** on the left. Every step has a word under it that says its state: **Done**, **Reviewing, round 2 of 3**, **Needs you: 2 decisions**, **Needs a fix**. Steps after one that waits on something stay numbered until it clears.
- **The open step** on the right.
- **The bottom bar**: **Back**, a line that says why you cannot move on yet, and the way forward.

The steps:

1. **Intent** — the problem and the outcome the order is for.
2. **Plan** — the acceptance criteria and how each is proven, the coverage matrix, the assumptions the architect made, any question it needs you to answer, and the budgets.
3. **Red team** — what an adversarial pass found in the plan.
4. **Shape** — the shape of work.
5. **Tracker** — what goes back to the issue. Shown only for an order seeded from a tracker issue.
6. **Hand off** — seven rows that must all pass, and **Hand off**.

You can open any step from the step list at any time. An order opens where the next thing to do is.

**Every button that cannot be used says why.** Hover it, or move to it with Tab, and a tooltip gives the reason, for example "The red team is reviewing the plan (round 2 of 3, started 13:06:19). Hand-off opens when it finishes." Click it to show the same reason under the button.

**Questions** that the architect was less than 90% sure about appear on the Plan step under **Needs your answer**, and the status strip turns orange. The recommended answer is marked. Everything else that Foundry decided is a **strikeable assumption** on the Plan step, not a question. Click an assumption to strike it. Foundry redraws the parts of the order that depended on it.

**Draft the plan** is the first thing to press. It sits in the order's header on every step (it reads **Redraft** once there is a plan). Foundry seeds a draft with your problem statement and what it read in the repository. The architect turns that into criteria, units and a risk grade. It runs in a terminal you can watch, and it can only _propose_. It cannot mark its own work agreed. Type into the box at the bottom of any step to tell it what is wrong, and it redrafts. While someone works, the header offers **Watch the architect** (or the red team, or the scout), which takes you into that terminal.

**Foundry does most of the shaping on its own.** When a check fails that the architect can close, the architect gets up to two automatic turns to close it. A plan that the architect wrote in the wrong format goes back to it the same way. You see this only if those turns do not fix it. The strip then says which part was unreadable and offers **Start the turn over** or **Tell the architect what was wrong**. While the architect works, the step shows **Being revised** in blue, not a red cross, because nothing is wrong yet. Once the plan passes, the red team reviews it. Blocking findings go straight back to the architect. The order then hands off, unless the red team asked to review the fix or the architect left a blocking finding open. In that case the red team takes another look, up to three rounds. You see orange only when that loop stops: after three rounds without agreement, or when you press **Hold for me**.

**Hold for me**, in the status strip while Foundry works, stops Foundry from starting anything else on its own. The turn that already runs finishes. **Let it continue** picks up where Foundry would have gone.

**Six rows** on the Hand off step must all pass before Foundry hands off: no open questions, every criterion can be proven, plan and criteria cover each other, risk graded against _this_ plan, no blocking red-team findings, and nobody is changing the plan. A passing row says why it passed. A failing check also shows on the step that clears it, with what to do about it. The step offers either a button that takes you to the control that clears the check, or a button that redrafts with the instruction the architect needs.

**The base branch** is assumed to pass. Foundry runs nothing on it on its own, neither while it shapes the order nor after a failed check. A check that fails in the final check is this order's failure, and you decide what to do with it. To try one command on the base yourself, use **Prove** on the Checks step.

**Criteria falsifiable** on a change that somebody can see is the check that catches people. A plan that touches a `.tsx`, `.css` or `.html` file and has no criterion that asks for a picture of the running application fails, because a command cannot say whether a thing renders. **Ask for proof** has the architect add a `screenshot` criterion. If nothing here can take that picture (no display, no runner), mark the criterion **"Nothing here can prove this"** on the Plan step. That costs a written reason, which travels with the order and shows in the ledger.

**Budgets** are yours to set, not the architect's. Each new order starts with the limits in Settings → Foundry: agents at once and minutes. There is no limit on how many files an order touches. In Settings, 0 means no limit. To change the limits for one order, use the **Budgets** section at the bottom of the Plan step. Enter a number or tick **No limit**, then press **Save budgets**.

If a run goes past a budget, it stops and asks you what to do. **Raise the budget** asks for the new limit. It suggests about a quarter more than the run has already used, and it does not accept less than the run has already used. Foundry saves the new limit to the order and the run resumes. You can tick **No limit** there as well.

**Red team** findings are grouped by who acts on them:

- **The architect is fixing** — blocking findings that a fix turn handles now. You do nothing.
- **Needs your decision** — blocking findings that the loop left to you. Choose **Ask the architect** (it changes the order so the finding no longer holds), **Fix it…** (say how) or **Accept it** (keep it, with a written reason), then **Send** at the bottom. Everything you decided goes in one turn.
- **Notes, nothing to do** — findings that do not block hand-off: scope, process, setup, or something already true before this change. The builder sees them.
- **Resolved** — collapsed.

**Shape** offers every shape this repository can support, each with its whole description. A shape that cannot run here is locked, and its tooltip names the requirement it does not meet. Foundry proposes one shape and says why. **You can pick a different shape at any time before hand-off, even while Foundry works.** Foundry saves your choice to the order straight away and records it in the ledger. Your hand-off and the automatic one both use it. The card shows **Your choice**, and **Use the proposal** goes back.

There are three shapes. **Direct** is the shape for a single lane. It builds, lints, and checks the change with your project's own test command (or a fresh verifier when the repository has none). It has the change inspected when something risky was touched. It updates the documentation unless the change is the smallest grade. Then it ships. **Standard** is for work that spans more than one lane or is graded above ordinary risk. **Research** produces a document instead of a change.

**Research** is never proposed. It is there to be picked, for a question whose answer is a document. The author writes the document where the order says. A document in the repository ends in a draft pull request. A document that the order wants somewhere else, or in another repository, is written to the order's own outputs folder, or published and linked. The run finishes on it with **Finished · document ready** and no pull request. Write the acceptance criteria as statements about the document, so the verifier has something to check.

A change that only touches documentation (markdown, `docs/`, `specs/`, a readme or a changelog) gets a short final check: format and lint. The rest is marked not run, "documentation only".

A `research` order ends on its document, not on a pull request. When the session is signed in to claude.ai, the author publishes the document as a Claude artifact. Foundry checks that the link is one the author actually published. The order then reads **Finished · published as a Claude artifact**. The link is on the order's row, on the open order (**Open artifact**, **Open local copy**, **Copy link**), in the factory hall and on Home's drawer. The ticket moves to In Review with the link as a comment. Without a claude.ai sign-in, the document stays with the order, and **Open document** opens it.

Each shape also says how hard its agents think. `direct` and `research` run at `medium` effort. `standard` runs at `high`, because deeper reasoning pays in a second look. A recipe of your own sets the effort with one line, `effort: high`, on the recipe or on a single step.

**Tracker** lets you say which of _your_ workflow states each moment means: when work starts, when the draft opens, when it merges. If you leave it alone, the tracker decides. It also says, for this order alone, what goes back to the issue: the agreed order as a comment, the workflow state, and the pull request links. The issue moves to In Progress when the work starts. It moves to In Review as soon as the draft pull request opens (not after its checks finish). It moves to Done only once the pull request is merged. A team with a single "started" state has no review state, so its issue stays In Progress, and the order's history says why.

**Hand off** also says when the repository has no command for a check: **"Not measurable here"**. Those checks report **"not measured"** and do not pass. A green you did not earn is worse than a gap you can see. The three rungs that were never commands (independent verification, the security inspection, your own decision) say where they were decided and do not count as gaps.

![A work order in the Forge, open on its first step with the step list above it](screenshots/08b-foundry-forge.png)

**Hand off**, at the foot of the Hand off step, agrees the order and starts the work with the shape it names (**Hand off with Direct**). Beside it, **Hand off on its own when clean** is the same setting as Settings → Foundry. When it is on, an order whose red-team round finds nothing blocking hands itself off, and the status strip says so in advance. Afterwards the order says **Handed off automatically at 13:07:53**, and the ledger records that Foundry agreed it, not you.

If Claude cannot start an agent, the status strip says **"Claude could not start the architect."** (or the red team, or the scout) and quotes what Claude said. Nothing on the order changes. **Try again** asks again: the architect drafts again, and a red team that could not start gets its round. **Copy the error** copies Claude's words. The canary (`npm run canary`) and `npm run test:live` start every role against the real Claude, so a start failure that is Foundry's own shows there before a release. Until a plan exists, **Next: Red team** is locked with **Waits for a plan**, and the coverage check reads **Waits for a plan** instead of **Failing**.

In the list of orders, a row that waits on an answer says **"N waiting on you"** where the others say what blocks them. So the count on the Forge tab tells you which order to open.

A row also carries what you would otherwise open the order to find:

- the pull request (**#233**) and the ticket (**TAV-15**), each opening in your browser;
- while CI watches or fixes, a spinner with the same words the Floor uses (**First run · up to 2 fixes**) and **1 of 3 checks done**;
- when the move is yours, the gate's first two answers on the row itself (a shipped order that waits to be marked ready says **Mark ready** right there).

### Floor — watching a run

The Floor shows the run graph by repository, what is ready, and what is blocked and why. When an order spans several repositories, a **merge order** section names the files that the lanes share and which lane must land first.

The band at the top says where the run stands. While agents work, it also says what each agent does: its last few tool calls and messages, newest last, with how long ago it last did anything. It refreshes every two seconds. An agent that has just started says **Starting — nothing yet.**

Under the title sit the **pull request** (`#233`) and the **ticket** (`TAV-15`) that the order came from, once they exist. Each opens in your browser. Next to them, **Review** opens that pull request in the Git extension's review. With the Git extension turned off, the button says **Open on GitHub** and opens the pull request there instead. Foundry no longer draws a hunk-by-hunk review of its own.

Once the draft pull request is open, the **CI** card says in words where the checks stand (**First run · up to 2 fixes**, **Fix 1 of 2**, **Passed**). It shows a spinner while it still watches or sends failures back. It counts the checks that have finished (**1 of 2 checks done**) as they arrive. It links the pull request and each check.

Each step is a chip. A step that passed reads **done**. A skipped step says why when you hover it (**Skipped: runs only when risk triggers fire; this order has none**). The scroll icon (**Transcript**) opens that step's transcript directly under its row. The terminal icon appears only while the step runs, because a finished step's terminal is closed. If Foundry refuses to go to a terminal, the reason shows next to that step.

Two things you can do without leaving:

- **Waiting on you** sits above the run graph. It lists every tool call that an agent holds. Allow it, deny it, or hand it back to the terminal to answer where the agent is. Nothing in that run moves until you do. An agent stopped at a tool call looks exactly like an agent that has gone quiet. For that reason it is the first thing on the screen, not the last.
- Every piece of work is named by what it is: the role and the unit it builds, not the identifier that the run graph uses internally. **Blocked** says what each one waits on in the same words.
- **Watch** a unit to read its transcript, and **Redirect**, **Interrupt** or **Stop** it. The terminal is always there as the backstop. The agent runs in a real terminal in its own worktree project, and you can go and type at it.

In the factory hall, click the **whiteboard** on the back wall to open the **Run log**. It lists, in one list in time order, every agent's words and tool calls, every decision in the ledger, and every command's output. It refreshes every two seconds and follows the newest line until you scroll up. **Jump to latest** brings you back. Filter it by station or by kind, and click a station's name to open that station's monitor. **Esc** closes it.

### Autonomy — how much it asks you

There are three settings. They differ in which rules stop the line. Four things ask at every setting, including the most permissive: before anything is merged, before a destructive action, when a budget is exceeded, and when the change turns out to carry real risk. With **Let auto mode decide** on, an agent's destructive tool call is the exception: auto mode decides it (below).

Everything else depends on where the dial is. At **escorted**, every action that an agent takes waits for you. At **standard** and **lights-out**, Foundry takes ordinary work inside the unit's own worktree automatically and records it: editing the files the unit was given, running the project's tests. What reaches you is what the rules actually wanted a person for.

**Let auto mode decide** (Settings → Foundry, on by default) answers the rest. At standard and lights-out, Claude Code's auto mode decides a tool call on which Foundry's own rules have no opinion, such as a write outside the worktree. It also decides a destructive action. Auto mode behaves exactly as it does in any other Claude Code session. Without it, the call waits five minutes for you. Escorted still asks about everything.

Foundry reads "Destructive" generously: `rm`, a hard reset, `git clean`, a force push, deleting a branch, and anything the check cannot parse. Foundry treats a command it cannot read as destructive and does not assume it is safe.

### Ledger — the record, and the one place it argues back

The Ledger lists every decision, who or what rule took it, what it was about and why. Filter it by order, by who decided, and by action. The filters offer only values that occur.

It has one button: **What do I keep rejecting?** Foundry reads the record. When the same reason has turned work away three times, Foundry proposes a rule and cites the specific entries it derived the rule from. Accept the rule, and it applies to later work in every repository. Decline it, and Foundry never offers it again. Foundry proposes nothing until you press the button.

Below that, **Checks you accepted** lists the rules you put there. It never lists the rules that ship with Foundry or a rule that a repository carries, because neither is yours to delete. **Remove this check** takes one back out. Foundry keeps the removal with its reason, so it does not offer the same proposal back to you next week.

![The Ledger, with a check the operator accepted](screenshots/08c-foundry-ledger.png)

### Shipping

Work ends in a **draft pull request** without being asked. The draft carries a written summary, the verdict for every criterion (including the ones nothing could check) and any inspection findings. Under the verdicts, **What's left for you** lists everything that still needs a person: criteria that failed or were not measured, checks not measured, checks that failed and you accepted as a debt, red-team findings you accepted, assumptions nobody struck, and questions still open. It starts with a count ("**7 of 9** criteria pass. 2 need you."). Every item comes from the order's own record, never from an estimate. The decision you then get is whether to **mark it ready**, never whether to create it.

For an order graded at either of the two highest risk levels, Foundry takes your decision **before** anything reaches the remote. For every lower grade, the draft opens first, so review happens on a real change.

For a change that needs no inspection and is graded below the two highest levels, the draft opens as soon as the work is done. The final check runs while the draft's own checks run. "Mark it ready?" appears only when both are green. If the final check fails, the draft stays a draft, and Foundry asks what to do about the failed check. Until then, the recipe's last step reads as running, because shipping is still under way.

**Accept the debt** on a failed check is final. The run does not ask again. It records the debt in the ledger, opens or keeps the draft, and lists the failed check under **What's left for you**.

An order whose product is a document outside the repository, such as a research order that publishes a page, runs no repository checks. It ends when the author hands the document back and the verifier has read it.

### Where Foundry keeps its things

**Foundry writes nothing into the repositories it works on**: no scaffolding, no configuration, not even a `.gitignore` entry. Its own records go where you point **Settings → Foundry → Where Foundry keeps its records**. If you leave it empty, the records go to `<workdir>/.foundry/`, which leaves an untracked directory in each repository you run an order in. Foundry says so once and never edits your ignore file.

A repository _may_ carry its own `.foundry/recipes/…`, `.foundry/roles/…` or `.foundry/rules/…`, and those win. No repository must carry any of them.

---

## 17. Extension: Notepad

![Notes new note](screenshots/09-notes-tab.png)

Notepad is a markdown note-taking extension with live preview, tags, folders, and Excalidraw diagrams.

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
- **Outline** — the open note's headings, in the right rail above the comments, nested by heading level. Click a heading to jump the editor to it. With the comments open, the two split the rail evenly, half each, whatever either one holds. With one closed, the other takes the whole rail. Close the outline with the button in its header. Bring it back with the **Outline** icon in the toolbar. When you close both, the editor gets the whole width. A popped-out note window has the same panel. The outline does not list headings inside fenced code blocks. It measures depth from the note's own top heading, so a note that starts at `##` is not indented for it.
- **View modes** — the toolbar's **Live / Source / Read** control: edit the rendered note, edit its raw markdown, or read the note without editing.
- **Margin comments** — pin comments at any position in the note body.
- **Full-text search** — type in the search bar to filter notes by content.
- **Multi-tag filter** — click the Tags button in the sidebar to open a multiselect dropdown and filter by one or more tags simultaneously.
- **Import/export** — export all notes and diagrams as a zip (`.md` files + `.excalidraw.json` files).
- **Settings** — in **Settings → Extensions → Notepad**: **Editor font size** (14 px by default, 8–32) and **Autosave debounce**, how long typing must pause before Notepad saves a note (800 ms by default, 100–10000). Both apply as soon as you change them, in the panel and in popped-out note windows. Diagrams keep their own 1.2 s save delay.

### Diagram features

- Draw shapes, arrows, sticky notes, and freehand lines on an Excalidraw canvas.
- Double-click any shape to edit its label in place.
- **Canvas comments** — click the Comment button in the toolbar. Click anywhere on the canvas to place a pin, and write a comment. Reply to threads or resolve them inline. Comments follow the canvas as you zoom and pan.

---

## 18. Extension: Task Vault

![Task Vault with capture dialog](screenshots/10-task-vault-tab.png)

Task Vault is a **GTD + Bullet Journal + PARA** productivity extension. A SQLite database backs it.

### Opening Task Vault

Click the **calendar icon** in the sidebar header icon row. Or press **`Cmd+Shift+Space`**, the global quick-capture hotkey (works from any screen).

### Sidebar sections

| Section      | Contents                                                   |
| ------------ | ---------------------------------------------------------- |
| **Today**    | Daily log for the current date, mini calendar on the right |
| **Inbox**    | Quick-captured items awaiting triage                       |
| **Projects** | Named project containers for related tasks                 |
| **Areas**    | Ongoing responsibilities (PARA areas of focus)             |
| **History**  | Past daily logs                                            |

### Today

The date is the heading, with **Today** beside it when you look at today. An empty day says so and offers the two things you would do next, **Add task** or **Open inbox**. It does not leave a blank column.

The calendar on the right marks each day by what is on it. Hover a day to see it in words (`3 tasks, 1 overdue`), so a busy day and an overdue one are not the same dot.

### Stale tasks

An open task left on Today rolls over to the next day. Once it has rolled over for **Stale Task Threshold (days)** (Settings → Extensions → Task Vault, 7 by default), Today marks it **stale**. A project is stale for a different reason: it has no open next action.

### Quick capture

Press **`Cmd+Shift+Space`** from anywhere to open the capture dialog. Type in the natural syntax:

```
Task text… @project #area +context due:YYYY-MM-DD
```

Press `Enter` to save or `Esc` to dismiss.

### Task features

- **Recurring tasks** — set daily/weekly/biweekly/monthly recurrence. The engine ensures that exactly one future open instance exists at all times.
- **Task detail panel** — click any task to open a right-side panel with Description, Acceptance Criteria, and Dev Hints fields. The fields accept markdown.
- **Ghost subtask row** — a faint `· + Add subtask…` row at the bottom of each open task. Click it to expand it inline.
- **Bidirectional links** — link vault items to specific terminal sessions.

### Context filter

Click the **Context filter** button (always visible in the toolbar) to open a multiselect dropdown. Filter all views by one or more `+context` tags.

---

## 19. Extension: Remote Control

Remote Control lets you reach your Terminator terminals from **any web browser**, on your own network or over the internet.

### Turning it on

Open the **Remote Control** tab. The top of the screen answers the question you came to ask: whether Remote Control is on, and how to reach it.

| It says                                 | Meaning                                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Off**                                 | No browser can reach your terminals. **Turn on** starts the server.                                                               |
| **Starting…**                           | Terminator opens the port and creates an address.                                                                                 |
| **On — reachable on this network**      | The address works for devices on your network. To go further, add an account token in Settings.                                   |
| **On — reachable from any browser**     | There is a public address.                                                                                                        |
| A failure, in words                     | What went wrong and what fixes it. For example, the port is already in use: pick another, or quit                                 |
|                                         | whatever is listening on it.                                                                                                      |
| **The public address stopped working.** | The tunnel dropped. **Reconnect** makes a new public address without a server restart, so devices on your network stay connected. |

When it is on, you get the address, a **QR code**, and the password. Point a phone camera at the code to connect. The code carries the password, so on the everyday path the credential never has to appear on screen. If you type the password by hand, use the eye button to reveal it.

Below the address is the sentence that matters: **anyone with this address and password can type into your terminals.**

### Who is connected

**Connected now** lists every device that watches, by a name you will recognise ("iPhone", "Chrome on Mac"), the terminal it is on, and how long it has been there. Each row has **Disconnect**. The list is live. It changes as devices come and go, because a stale list is the wrong answer to "who currently has shell access".

A device you disconnect is told so ("The desktop app disconnected this device.") and does not reconnect by itself. It can only come back through its own **Retry**. To keep it out, change the password.

### Settings

Port, viewer limit, password and the account token for a public address are under **Settings** at the bottom of the screen. The section stays collapsed until you open it. The summary line shows the port and viewer limit without opening it.

The viewer limit is how many browsers can watch one terminal at once. Terminator turns away one more and tells it why, with a **Retry** for when someone leaves.

### Accessing terminals in a browser

Go to the URL on any device. Log in with the session password. The server adapts to the viewport:

| Viewport                        | Experience                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Desktop / tablet** (≥ 768 px) | The full Electron renderer through `/app/` — the complete Terminator UI.                                                                                                                                                                                                             |
| **Mobile** (< 768 px)           | A mobile UI at `/mobile/`: scrollable workspace/terminal list, full-screen xterm.js terminal view with a control-key toolbar (Ctrl+C, Ctrl+D, Tab, Esc, ↑, ↓), and automatic reconnect through the Page Visibility API (3 attempts × 2 s). Tested on iOS 16+ / Android 12+ (Chrome). |

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

Scaffold a new extension:

```bash
npm run create-extension -- my-extension
```

See [docs/EXTENSION-DEVELOPMENT.md](../EXTENSION-DEVELOPMENT.md) for the full API reference including global tabs, global shortcuts, and the Extension SDK at `packages/extension-sdk/`.

---

_For architecture details see [docs/ARCHITECTURE.md](../ARCHITECTURE.md). For contributing guidelines see [docs/CONTRIBUTING.md](../CONTRIBUTING.md)._
