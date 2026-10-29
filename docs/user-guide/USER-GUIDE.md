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

Terminator is a developer-focused terminal emulator that organises work into a two-level hierarchy — **Workspaces** (repository-level) and **Projects** (task-level) — with persistent terminal sessions that stay alive as you navigate between them. Extensions add capabilities such as Git integration, spec-driven AI coding pipelines, markdown notes, task management, and remote terminal access, all without modifying the core application.

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

**Prerequisites:** Node.js 24.21.0 (`.nvmrc`), Python setuptools for packaging (`pip3 install setuptools --break-system-packages` on macOS with Python 3.12+), and `git` on your `PATH`. The `gh` CLI is optional but required for GitHub PR features.

---

## 3. The Interface at a Glance

![Main overview](screenshots/01-main-overview.png)

The window is divided into three zones:

| Zone             | Description                                                                                                                                                                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Left rail**    | Collapsed workspace group names. Click to expand a workspace in the main sidebar.                                                                                                                                                                                                                                       |
| **Main sidebar** | A compact row of app icons at the top (Home, Overview, Notes, Remote Control, Task Vault, and the notification bell), then search with the Filter and Display menus, then every repo with its branches. Terminals are not listed here — they are tabs above the terminal, rows on Home, and tiles on the Overview wall. |
| **Content area** | Tabbed area on the right showing the active terminal session and extension tabs (Terminal, Foundry, Git).                                                                                                                                                                                                               |

The **status bar** at the bottom of the window shows live CPU, Memory, and Network figures when the global metrics bar is enabled in Settings.

---

## 4. Repos & Branches

![Sidebar workspaces](screenshots/03-sidebar-workspaces.png)

### Workspaces

A workspace maps to a directory on disk — typically a git repository. Each workspace appears as a named, colour-coded card in the left rail. Click a workspace name to expand it in the main sidebar.

- **Create a workspace:** Click `+` in the sidebar header and choose a directory.
- **Color coding:** Each repo has a distinct accent colour, and it appears in exactly two places: a thin rail down the left edge of that repo's branches, and a small swatch beside the repo's name. Everything else in the column is neutral — hovering and selecting a row look the same whichever repo it belongs to, so what draws your eye is a branch's state rather than its colour. Scratch terminals belong to no repo and draw no rail.
- **Keyboard access:** `Cmd+1`–`Cmd+9` focuses and expands the corresponding workspace; `Cmd++` / `Cmd+-` cycles through them.
- **Toggle sidebar:** `Cmd+B`.

### Projects

Projects live inside a workspace and hold one or more terminal sessions scoped to a task or branch.

- **Create a branch:** Hover a repo's header and click `+`. A branch is usually its own git worktree; the sidebar marks the exception — a plain checkout gets a small branch glyph, and a worktree is left unmarked.
- **Naming:** A branch is named by its branch — there is nothing else to name and nothing to rename. Check out a different branch in a plain checkout's own terminal and its card follows within a moment. A worktree's branch is fixed when you create it. (A workspace whose folder is not a git repository has no branch to take a name from, so there you are asked for one and can rename it.)
- **Terminals per branch:** A branch can hold several named terminal tabs. They are listed in the tab bar above the terminal, not in the sidebar — each tab carries its own state glyph and unread bell count, and its description on hover. The tab bar states which branch's terminals it is showing.

- **What a branch row tells you:** its state, folded from its terminals — waiting on you beats working, working beats idle, idle beats exited — plus its name, any linked issue key, how much has changed on it, and either how many terminals share that state or how long since it was last active. A branch with no terminals is still listed, and reads as idle.

- **Ordering the list:** **Display → Sort** orders the whole column — the repo headers as well as the branches under each one. **Name** is alphabetical, **Recent** and **Oldest** go by when a branch last did something (a repo takes the most recent of its branches), **Status** puts what is waiting on you at the top, and **Manual** is whatever order you dragged things into. Drag a repo header to move a repo, or a branch row to move it within its repo; dropping switches the view to **Manual**, since any other sort would recompute the order and discard the drag. Your order is saved and survives a restart. Branches cannot be dragged under **Display → Group → None**, where one list spans every repo and there is no per-repo order to write.

- **Grouping by task:** **Display → Group → Task** lists each task as a header, marked with its state glyph (the same five as Home), with its lanes beneath it, one row per repo, and puts the branches that are in no task under **Not in a task**. **Workspace** is the default; the choice is remembered. A task's lanes are named by repo and branch. See [Making a task](#making-a-task).
- **Add to task…:** right-click a branch and choose **Add to task…** to put it in an open task or start a new one from it. A terminal's tab has the same item.

- **Collapsing a repo:** click its header. A collapsed repo still shows a marker if a branch inside is waiting on you, so hiding a repo cannot hide the one thing you needed to see.

- **Open in your editor:** right-click a branch and choose **Open in ‹editor›** to open that branch's working copy — its own worktree when it has one, otherwise the repo it was checked out from. The same item is on a repo's header, and opens the repo folder. Terminator finds your editor itself: it looks for Cursor, VS Code, Windsurf, Zed, Sublime Text, WebStorm, IntelliJ and Xcode, preferring one whose command-line launcher is installed, since that opens the folder in a window you already have. To pin a particular one, set `ui.editor` in settings to its id (`cursor`, `vscode`, `windsurf`, `zed`, `sublime`, `webstorm`, `intellij`, `xcode`); leave it empty to keep detecting. The menu item is hidden when no editor is found, and in the browser remote, which has no local editor to launch.
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

### Moving a terminal to its own window

Any terminal can live in a window of its own, for a second screen or to keep an agent in view while you work on another branch. The process, scrollback and agent state carry over; nothing restarts.

- **Move it out:** press `Cmd+Shift+O`, choose **Window → Move Terminal to Its Own Window**, run **Move to its own window** from Quick Actions (`Cmd+P`), or drag its tab and release it outside every Terminator window. The window opens the moment you let go; `Escape` cancels the drag.
- **Bring it back:** drag its tab from the window's header onto the main window, press `Cmd+Shift+O` in that window, or close the window. Closing never ends the session.

The terminal always returns to the branch it came from, at its old tab position, even if you have since moved to another branch. `Cmd+W` in a terminal's own window closes that session.

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

A split belongs to the tab it was made in. A new tab opens on its own terminal, which takes the keyboard; going back to the split tab shows its panes again.

> **Note:** Split panes require an active branch session. Scratch sessions do not support splits.

---

## 7. Scratch Terminals

![Scratch terminal](screenshots/15-scratch-terminal.png)

Scratch terminals give you an instant shell without selecting any repo or branch first.

- **Open a scratch terminal:** Click the `~` button in the workspace rail or press `Cmd+Shift+T`.
- Scratch sessions appear as a **Scratch** group at the bottom of the sidebar, with a count like any other group.
- **Promote a scratch session:** Right-click its tab and choose **Move to branch…** to attach it to an existing branch or create a new one.

---

## 8. Quick Actions

![Quick actions](screenshots/04-quick-actions.png)

Press **`Cmd+P`** from anywhere — a terminal, Home, Overview, or any extension view — to open Quick Actions: a panel of every action on screen, grouped, with a one-letter mnemonic for each. It works the same way whether you remember the letter or not.

### The letter map

At the top level, each row is a group or a direct action, and its box shows the letter that reaches it:

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

A letter acts immediately: `g` then `p` pushes the focused branch, with no `Enter` needed. `Backspace` steps back up a level. An action you can't run right now (no repository focused, no linked issue, …) still shows — dimmed, with the reason in place of its description — rather than disappearing; pressing it shows the reason at the bottom of the panel instead of running.

### Search

Press **`/`** (or `Cmd+P` again while the panel is open) to switch to fuzzy search. It matches against the action's label, its group, and its description — typing "push" finds **Git: Push** even though "push" isn't in the group name. Arrow keys move the highlight, `Enter` runs it, `Backspace` on an empty query goes back to the letter map.

### Pins and recent

The actions you actually use rise to a **Pinned & recent** row at the top, before any group: your pins, then your most-used actions by recency and frequency. Highlight a row and press **`Cmd+.`** to pin or unpin it, or hover a row and click its pin icon. Pins and usage are saved locally and survive a restart.

If the surface you're on has its own group — Foundry's tab, the Git view, Notes — that group's actions rank first, above the pinned/recent row, because that's almost always what you want next.

### Learning the direct shortcuts

Every action that also has a direct keyboard shortcut shows it (`⌘D` next to Split right, for example). Run one from the panel three times and it stops reminding you — until then, running it shows a small "Next time: `⌘D`" toast, so the shortcut sticks without you having to look it up twice.

### Custom actions

Add your own actions in **Settings → Quick actions** (global, or per-workspace to scope one to a repo). Each one has:

- A **label** and an optional one-character **key**.
- A **kind** — a **shell command**, or a **Claude prompt**.
- A **target** — a shell command runs in the **focused terminal** or opens a **new tab on the branch**; a prompt always goes to the **focused Claude session**.
- A **body**, with variables filled in when the action runs: `{cwd}` `{branch}` `{worktree}` `{repo}` `{issue}` `{selection}`.

They show up under **`x`** (Custom) in the panel, alongside everything else.

**When a custom action won't run:**

- A variable with nothing to fill it (no linked issue, no text selected, …) disables the action with the specific reason — the body never runs with a variable silently left empty.
- A shell action aimed at the focused terminal is refused if that terminal is running Claude ("use a new tab" instead).
- A prompt action is refused if the focused session isn't a Claude session, or if Claude is mid-turn ("Claude is mid-turn") — sending a prompt into the middle of a response would just get typed over.
- A shell command longer than 1024 bytes after its variables are filled in is refused outright, rather than sent — a line that long gets silently mangled by the terminal, so Terminator would rather tell you than corrupt it.

---

## 9. Settings

![Settings](screenshots/05-settings.png)

Open Settings with **`Cmd+,`** or via **View → Open Settings**.

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

**Settings → Integrations** is the only place Terminator asks for a tracker credential, and every
part of the app reads that one connection.

| Tracker    | What you provide                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| **Linear** | API key. Optionally an email, to list someone else's assigned issues instead of the key's own account. |

**The credential is checked before it is kept.** Terminator calls the tracker with it first, so a
mistyped key is rejected there and then, with the tracker's own message, rather than turning up
later as an empty issue list. Nothing is stored unless it works.

**Where it lives.** Encrypted with your operating system's keychain (`safeStorage`) in
`integrations.json` in the app's data directory, and read only inside the main process. No part of
the interface can ask for it back — status only ever reports _whether_ a tracker is connected and
_which account_ the credential proved to belong to. The connect and disconnect actions are also
the only two settings deliberately unavailable over Remote Control: an authenticated browser on
your LAN still has no business writing your API keys.

**Disconnecting** destroys the credential. Anything you
had linked to a branch stays linked — it is your association, not the tracker's — and starts
working again as soon as you reconnect.

### Per-workspace overrides

Expand any workspace in Settings to override the global theme, scrollback limit, and default shell for sessions in that workspace. A new terminal in one of its projects opens in the workspace's own shell. **Use global default** beside a setting hands that one setting back to the global value and leaves the workspace's other overrides alone.

Themes switch immediately across the entire app — no restart required. Terminal colours re-apply live via a `MutationObserver`.

---

## 10. Issue Tracking

Terminator attaches a **Linear issue to a branch**, so the thing you are working on is on
screen — and so every agent session you start there already knows it.

Connect a tracker first: [Settings → Integrations](#9-settings).

### Attaching an issue to a branch

A branch can carry **one** issue at a time — a branch is a unit of work, and so is a ticket.

**To attach one**: right-click the branch in the sidebar → **Link issue…**. The picker opens on
the issues assigned to you across every connected tracker, so the common case needs no typing.
Type to search, or type an issue key exactly (`TAV-42`) to jump straight to it. Each row shows
which tracker it came from, because two trackers can both have a `TAV-42` and they are different
issues.

You can also reach it from [Quick Actions](#8-quick-actions) (`⌘P` → `w` → `l`) with **Link issue to project**, scoped to whichever branch you are in.

**The key.** Once attached, the branch's row in the sidebar carries the issue key as plain text — click it to open the issue drawer. It used to be a bordered badge with its own state dot; the key alone already said what those said. The paragraph below describes the state colours as they appear in the drawer and the picker.

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
lists, task lists, tables, code blocks, links and emphasis all appear as formatted text.

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
- **A pull request opens** for a Foundry order whose issue is attached — and this is
  **off by default**.

> **Behaviour change.** That pull-request comment used to fire whenever its setting happened to be
> on, and its failures were discarded silently — so nobody could tell a comment that posted from
> one that never had. It is now off unless you turn it on, in the Foundry settings, and when
> it fails you are told. **If you were relying on it, switch it back on.**

---

## 11. Home, the Overview Wall and Usage

### Home, the Tasks layout

Terminator opens on **Home**. Home answers two questions: what needs you, and what are your tasks doing. A **task** is one piece of work. It can span several repos, such as `rate-limits` in `terminator`, `api-gateway` and `web-console`, and it shows as one row. The header holds the **Today | Insights** switch, **Search** (`Cmd+K`) and **Start work** (`Cmd+N`).

![Home: one question in Needs you, and one task across three repos under it](screenshots/11a-home-tasks.png)

Top to bottom, Home holds:

- **The pulse line.** Each of the five states, with how many tasks are in it. Press a count to narrow Home to that state, and press it again to clear. Empty states are left out.
- **The plan strip.** One line until you plan the day or press **Skip today**. **Plan** (`P`) opens the plan sheet (see [Plan today](#plan-today)).
- **Needs you.** One queue across every task (see below). With nothing waiting it is one line: "Nothing needs you.", and how many agents are running.
- **Tasks.** One row per task, grouped by state in a fixed order: needs you, running, waiting on others, quiet, done. Quiet and Done tasks each fold into one line; press **Show** to open it. **Group** changes the grouping to repo or none. A row shows the state, the title, the repos the task touches, what is happening now and when it last moved. The star marks a task as today's focus.
- **The footer.** This week's shipped pull requests and how long agents waited on you, **Open Insights**, and **Archived tasks**.

While Home shows, the branch tree is hidden, so Home has the whole window. `Cmd+B` shows it for as long as you stay on Home. To keep the tree beside Home, turn off **Hide the branch tree on Home** in **Settings → Interface**.

#### The five states

Every surface draws a task's state with the same five shapes, so they read apart without colour. A task takes the most urgent state among its lanes. Each state comes from something Terminator can see:

| State                 | What sets it                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Needs you**         | Claude Code reported a question or a permission request, a check failed on your pull request, or a review is yours to do |
| **Needs you**, hollow | A terminal rang its bell, or a numbered choice is on screen, and Claude Code did not report it                           |
| **Running**           | A Claude Code turn is in progress. For a terminal that is not Claude Code, it printed output in the last few seconds     |
| **Waiting on others** | Checks are running, a review was requested, or the pull request is in a merge queue                                      |
| **Quiet**             | None of the above                                                                                                        |
| **Done**              | Every lane's pull request is merged and its terminals are closed, or you pressed **Mark done**                           |

A hollow, dashed **Needs you** is a guess. Terminator saw a sign that an agent is waiting but the agent did not say so, and its row and the task drawer name the sign, for example "Inferred: a numbered choice is on screen". It sits in the queue below the reported questions: a missed question leaves an agent waiting for good, while a false one costs a glance. It goes away when the agent prints again or you type into its terminal, and turns solid if Claude Code then reports it.

Nothing moves a task by a timer. A quiet task stays quiet until something happens on it, and only you mark a task done or archive it.

#### Needs you

The **Needs you** queue lists everything waiting on you, from Terminator and from extensions: an agent's question, an agent that finished while you were away, a failing check on your pull request, a review you owe, a Foundry decision, a task that is due. Asks Claude Code reported come first, then guessed ones, oldest and hottest first. Each row says where it comes from, what it asks and how long it has waited. The **Home** icon counts the asks and reads out as "Home, 3 need you".

Open an ask (click it, or press `Enter`) and it expands. You see the agent's last screen as text, its numbered answers as buttons and a field to **Reply in your own words**. Press **1**–**9** to pick that answer, **R** to reply, **T** to open the terminal and `Esc` to close. A numbered answer is typed into the terminal as if you had typed the number, after Terminator reads the screen again and checks the question is still the same; nothing is sent if you answered it in the terminal first. **E** marks an ask done and **H** snoozes it until an hour from now, this afternoon or tomorrow; a snoozed ask wakes early if the work moves.

Claude Code reports through its hooks. On start Terminator adds `SessionStart`, `Notification`, `UserPromptSubmit`, `Stop` and `StopFailure` entries to your own `~/.claude/settings.json`. Each runs one small script, `claude-hook.cjs`, that records which terminal is asking, or that a turn started or ended, and writes nothing else. `UserPromptSubmit` and `Stop` are what make a thinking agent read **Running** even while it prints nothing. To remove them, delete the entries under `hooks.SessionStart`, `hooks.Notification`, `hooks.UserPromptSubmit`, `hooks.Stop` and `hooks.StopFailure` whose command mentions `claude-hook.cjs` after quitting Terminator. A terminal that is not Claude Code still asks by ringing the bell or leaving a numbered choice on screen, and reads Running from its output.

#### Opening a task

Press a task row, or `Enter` on it, to open its **drawer**.

![A task's drawer: one lane per repo, the lane that is asking marked](screenshots/11c-home-task-drawer.png)

The drawer holds:

- a short written summary of what is happening and what blocks it (Terminator asks Claude Code, with no tools, to read the agents' latest messages and the pull request);
- **Lanes**: one row per repo and branch, with its state, the lines changed, and its pull request and checks when it has them. A lane with no pull request shows no pull request line. **Answer** or **Open** goes to that lane's terminal;
- **Add a repo** (makes a worktree on the same branch name in another repo) and **Add a branch I already have**;
- the terminals on the task, how long they have run and their tokens, and a timeline;
- the buttons **Open all lanes**, **Link a ticket**, **Rename**, **Mark done** and **Archive**.

**Mark done** finishes a task that will never have a pull request. **Archive** hides a task without finishing it. Both keep its records and list it under **Archived tasks** in the footer, where **Restore** (or **Undo done**) brings it back. `Esc` closes the drawer. Right-click a row for the same actions and for **Dismiss**, which hides a row from Home; its toast has **Undo**.

#### Making a task

A branch that is in no task is still a task of one lane, so you do not have to make one. To join work, either:

- **Start work → Across repos** (`Cmd+N`, then the **Across repos** tab). Enter a title such as "Rate limits across services"; the branch name follows it (`rate-limits-across-services`) until you type your own. Tick the repos, choose how to run it (**an agent in an agent tab**, **Claude in a terminal**, **Terminal only**, or **Foundry**), optionally add a ticket and a first prompt for each agent, and press **Start 3 lanes**. Terminator makes a worktree on that branch in each repo, opens a terminal in each and records one task. If a branch name is taken in a repo, that repo says so and nothing starts until you fix or untick it.
- **Add to task…** on work already under way. It is on a branch row in the sidebar, on a terminal's tab, on an Overview tile (right-click it), and on a Home row's menu. The picker lists open tasks, and **+ New task from api-gateway/rate-limits**. If other repos have a branch of the same name, it offers to add them too; they join only when you confirm.

- **Drag one Home row onto another** to merge them. The row you drop on keeps its name and takes every lane of the row you dragged; a dragged task is gone afterwards. A toast says what moved, with **Undo**. A row with no branch cannot be merged.

A ticket linked to several branches joins them as a task without anything stored, and becomes a stored task the first time you rename it, star it or add a lane.

#### Switching tasks

- **Lane switcher.** When the terminal on screen belongs to a task with two or more lanes, the tab bar shows the task's name and a button per repo. One press moves to that repo's branch, and so does `Ctrl+1`–`Ctrl+9` (`Alt+1`–`Alt+9` on Windows and Linux; **Window → Switch Lane**) by its place in the row. A lane that is asking carries the needs-you mark, even when the terminal on screen is another lane's.
- **`Cmd+J`** (**Window → Switch Task…**) opens a switcher over any screen. Tasks are in the same order and with the same shapes as Home. `Enter` opens the task's most recent lane, and `Cmd+Enter` opens its drawer.
- **Sidebar.** **Display → Group → Task** lists each task with its lanes beneath, and the branches in no task under **Not in a task**. **Workspace** remains the default, and the choice is remembered.

#### Start work

**Start work** (`Cmd+N`, the header button, or Quick Actions) opens a launcher with five tabs:

- **My tickets** lists your open Linear tickets by state; type to search.
- **Prompt** starts from a sentence describing the task.
- **Branch** starts on an existing branch.
- **Across repos** starts one task in several repos (see above).
- **Scratch terminal** opens a terminal that belongs to no branch.

Choose how to run it — as an **agent in an agent tab** (the default agent, with a picker when you have more than one), **Claude in a terminal**, **Terminal only**, or a **Foundry** order — with `Tab`. In an agent tab the ticket is the agent's first prompt and has no length limit; its questions show in the tab and on Home. **Claude in a terminal** types `claude '<prompt>'` into a shell and refuses a prompt over 1024 bytes. The **Workspace** button at the right of the tabs shows where the work will run and why that workspace was suggested; press it or `Cmd+R` to pick another, type to filter, and `Enter` to choose. `Enter` starts it, and Terminator opens what it started so you land in it.

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

The single-letter keys act only while focus is inside Home, and never while a terminal or a text field has it, so typing a reply never moves the selection.

#### The Classic layout

To keep the earlier layout, set **Settings → Interface → Home layout** to **Classic**. Classic is the Desk: a summary line, the **Your move** band, the **In flight** list and the **Today** rail, with the same answers and keys. Its rows use the same five states and the same drawer; there is no stage bar in either layout. Tasks, **Add to task…**, the sidebar's **Group → Task** and `Cmd+J` work with both.

### Insights

![Insights, a card for each question](screenshots/11b-home-insights.png)

**Insights** is the second view of Home, for looking back. Each card is titled by the question it answers, and none compares you with anyone else. **This week**, **30 days**, **Quarter** and **Year** at the top choose the range every card covers.

- **How much shipped?** Merged pull requests, against the range before. It comes from Git integration.
- **How long from start to merge?** The median days from a ticket's first session to its merge, and the middle half. It needs at least three merged tickets in the range; until then the card says **Not enough merged work yet** rather than guess.
- **How long do agents wait on me?** The median time an agent sat waiting for your answer, how many asks that was, and how many waited over 30 minutes.
- **How often does it pass first time?** The share of Foundry orders whose checks passed on the first try. It is hidden when Foundry publishes nothing.
- **How am I spending agent time?** Agent hours, how many agents ran at once, the share that finished without asking you, and Foundry orders shipped. Below them, **Tokens** and **Estimated cost** come from the agents' own conversation files. The cost is an estimate from public prices, and says **partial** when a model had no price.
- **When do I ship?** A view an extension adds to Insights; Git integration's contribution heatmap lives here. **Show contributions on Insights** in Git Integration's settings switches it off.
- **Looking back** gathers the longest wait on you and the oldest review you owe.

A card with no number to show says why instead of showing a made-up one. Terminator keeps 90 days of how agents waited, so **Year** shows at most that much of it.

### Plan today

On the first view of Home each day, a one-line **Plan today** strip sits under the pulse line. **Plan** (`P`) opens it as a sheet; **Skip today** hides the strip until tomorrow. The sheet starts with a line such as "Yesterday you finished 2 of 3 focus items." and has up to three columns. A column with nothing to show is left out.

- **Carried over** lists focus items you picked yesterday and did not finish, and your open Task Vault tasks for today.
- **Tickets** lists your tickets, when an issue tracker is connected. Without one, the sheet ends with a note to connect Linear in **Settings → Integrations**.
- **Open tasks** lists your open tasks. Press one to star it. **Today's focus** has three slots; a starred task fills the next free one, and the star shows on the task's row on Home and in `Cmd+J`. A task that has been quiet for three days or more says so, for example "quiet 4 days", with an **Archive** button. Nothing is archived unless you press it.

A line under the columns says how many agents are already running across how many tasks. **Start the day** or **Skip today** closes the sheet and hides the strip until tomorrow. In the Classic layout the same plan opens above the Desk.

### Saying what a session is for

A session with no ticket can say what it is for. Right-click its tab and choose **Add description…** (or press `Cmd+I`), type an answer and press `Enter`; on Overview the tile asks **What is this session doing?** in place. The description is saved at once and survives a restart. On Home it names the work: the row and its drawer show your words when no ticket does. A described or linked session is kept for 30 days after it ends.

**New terminal** on Overview, and **Start work** on Home, start one on any branch, or a scratch terminal, without going to the sidebar. A session you close ends the terminal exactly as closing its tab would.

### Linking a session to a ticket

A session shows its branch's linked ticket by default. Right-click a session's tab or its tile and choose **Link issue…** to pin a different Linear ticket to that one session, which matters when two terminals on one branch serve different tickets. **Remove session link** hands the session back to its branch's ticket; the branch's own link is never changed from here. With no tracker connected, the dialog tells you to connect one in **Settings → Integrations**. The ticket an agent is briefed with at start-up still comes from the branch (see [What your agent sessions are told](#what-your-agent-sessions-are-told)).

### The Overview wall

![The Overview wall](screenshots/12-overview-screen.png)

**Overview** (`Cmd+Shift+E`) shows every open terminal as a live tile, named by repo, branch and session, with its ticket or description underneath. Sessions waiting on you are pinned double-width in a **Needs you** band at the top, with an amber border; everything else follows, ordered by state unless **Then by** says otherwise. **Recently opened** orders by when you last opened each one. **Task** puts the tiles of one task together under a band with the task's name and how many repos and terminals it spans, so a change across `terminator`, `api-gateway` and `web-console` reads as one block; terminals in no task follow. A tile still answers in place. Output never moves a tile.

Opening a session from anywhere — a work thread's drawer, a tile, the sidebar, a tab, Quick Actions, or a notification — takes you to its terminal with the cursor in it, ready to type.

A ticket linked to one terminal shows as its key on that terminal's sidebar row, on its branch's row while the branch is collapsed (with **+N** when its terminals carry more than one), and on its tab. Right-click either to link, change or remove it; **Quick actions → Link issue** links the focused terminal, and **Link issue to branch** links the branch. An agent started in that terminal is given the terminal's own ticket as context, over the branch's.

When an agent is waiting on a numbered choice — a Claude Code permission prompt, for example — its options appear as buttons on the tile and in Home's Needs you queue. Pressing one answers it as if you had typed the number. Terminator reads the screen again first, and sends nothing if the question has changed or been answered in the terminal.

Tile size (**S**, **M**, **L**), **Pin sessions that need you** and **Then by** are remembered. Previews fill the tile's width and follow the cursor, so the newest line is the one you see; on a very wide terminal, Large tiles are the readable size.

"Waiting on you" is worked out from what the terminal does: a bell, or a numbered choice left on screen when output stops. An agent that waits without either reads as idle.

### Agents

Terminator starts agents over the Agent Client Protocol (ACP) and shows each as an **agent tab**. Claude Code is built in. **Settings → Agents** sets the **Default agent** and lists your own. Any agent that speaks ACP works: choose **Add agent**, give it an id, a label and the command line that starts it, for example `opencode acp`. Everywhere you start an agent (Start work, a thread's **New agent on this branch**, Send to agent), the agent tab is the default and **Claude in a terminal** stays available.

### Picking a Claude Code conversation back up

When a Claude Code session ends — you typed `/exit`, the terminal closed, or you quit Terminator — the conversation itself is still on disk. A **Resume** button appears on that session wherever it is shown: its work thread's drawer on Home, and its Overview tile. Press it and Terminator opens it on the same branch, in the same folder: a terminal running `claude --resume` for a conversation that ran in a terminal, an agent tab for one that ran in an agent tab. The new terminal takes over the old one's description and ticket link, and the exited tab closes, so there is one terminal per conversation.

After a restart, conversations from the last run wait with their Resume button. Nothing is resumed for you: a restart never starts agents on its own, so you choose which threads to pick up. A thread whose sessions have all ended stays in the task list until its pull request merges or closes, or you archive it, or its records are dropped after 30 days. **Resume a conversation…** in Quick actions (`Cmd+P`) opens the drawer of the thread holding the most recent one.

Resume appears only where it can work:

- Only for agent sessions: Claude Code in a terminal, or any agent in an agent tab. A plain shell has nothing to resume, and no button.
- Only once the conversation has been seen. Terminator learns it from Claude Code itself, so it appears a second or two after the agent starts — including a `claude` you typed yourself.
- If the conversation's transcript has been deleted (agent tabs of agents that keep no transcript always offer Resume), or the record came from another machine, the session says **Conversation no longer available** in place of the button.

**How Terminator learns the conversation.** On first launch it adds a `SessionStart` entry (with the others described under Home) to your own `~/.claude/settings.json`. The entry runs a small script that records which conversation is running in which Terminator terminal, and writes nothing else. To turn the feature off, open that file and delete the entry under `hooks.SessionStart` whose command mentions `claude-hook.cjs`, then restart Claude Code sessions. Terminator will add it again the next time it starts, so remove it after quitting Terminator if you want it to stay gone. Nothing else in the file is touched, and a settings file Terminator cannot parse is never overwritten.

### Usage

**Usage** shows how much you use each feature of Terminator. Open it from its icon in the sidebar, with **Window → Usage**, or press `Cmd+P` and then `u`. To remove the icon, turn off **Show Usage in the sidebar** in **Settings → Appearance & Terminal**; the menu and `Cmd+P` still open it.

Terminator counts uses on this Mac only, in a local file, and sends nothing out. The header says **Counted on this Mac since** the first day it counted.

- **Period.** **7 days**, **30 days**, **90 days** or **All time** sets the range for every number. The default is 30 days.
- **Part.** The **All parts** menu narrows the screen to Core or to one extension.
- **Cards.** **Features used** counts the features used in the period, out of the features that exist now. **Not used** counts features used before the period but not inside it. **Never used** counts features never used since Terminator first saw them, and says how many more are new. **Active time** adds up the time you spent on screens and panels, with the three largest.
- **Table.** One group per part, Core first, then extensions by name. Each group says how many of its features were used and how many uses it had. Press a column header to sort. The default is **Uses**, highest first. **How it was reached** shows the path of each use: click, palette, shortcut or menu. **Failures** counts uses that failed.
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

A state follows this order: Gone, Extension off, New, Never used, Not used in the period, Used. The chips above the table show how many features are in each state; press one to narrow the table. Before anything is counted, the screen says **Nothing counted yet**.

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

Press `Esc` twice in quick succession (within half a second) inside any extension — Notes, Task Vault, Git Integration, Foundry, Remote Control — and Terminator returns you to the terminal session you were last in. Extension side panels close in place; full-screen extension tabs close and reveal the terminal behind them.

It takes two presses because extensions use a single `Esc` for their own dismissals — closing a dropdown, cancelling a rename, dismissing a dialog. The first press still goes to the extension, so nothing is stolen; the second is what leaves. `Esc` inside a terminal always goes to the shell and never exits anything.

---

## 14. Extensions Overview

Extensions install from any directory on disk via a `manifest.json`. They contribute UI without modifying core code: sidebar items, sidebar panels, global tabs, workspace-scoped tabs, top-bar menu items, native View menu items, context menu entries, and terminal event hooks. Extension UIs run in their own frames inside the app window — no app rebuild required after updates.

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

The Git integration is a workspace-scoped extension that surfaces git tooling directly inside the terminal window.

### Git tab

![Git tab](screenshots/07-git-tab.png)

The **Git** tab above the terminal is where git lives. It lists the changed files, each state named (**Changed**, **New**, **Added**, **Deleted**, **Renamed**, **Conflict**); stages and unstages them; commits; and shows a syntax-highlighted diff of the selected file (red for removed lines, green for added). It refreshes on file changes.

Two settings in **Settings → Extensions → Git Integration** change it. **Max displayed changed files** (500 by default) is how many changed files the list shows; with more, it says "Showing first N files." **Add sign-off to commits** commits with [`--signoff`](https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---signoff), which ends the message with a `Signed-off-by:` line naming you.

### The pull request queue

The queue opens with one line of triage — how many are waiting on you, how many are high risk,
and roughly how long the reading is — and then lists the open and draft pull requests, newest
first. **Sort** switches to **Closest to merging** (approved with passing checks first, drafts last)
or **Started by you** (reviews you have begun, most viewed first); ties always fall back to newest first.

Search covers open pull requests. Add `is:merged`, `is:closed` or `is:all` to reach the rest, or type
a number to open that pull request whatever its state; those rows say **Merged** or **Closed**.

Each row is two lines: the title, then only what needs attention — Draft, Conflicts, **High risk**,
CI failing, approvals, your progress. Medium and low risk say nothing. Clicking the row opens the
diff. Approving happens after you have read the change, never from the list.

The count is the repository's real count, not the number loaded so far, and further pages arrive on
their own — there is no "load more" to press.

### The Reviews tab

**Reviews** in the app band lists every open pull request that needs you, across all your repositories, from GitHub search. **Needs you** groups them into **Re-review** (new commits since you reviewed), **Requested of you** and **Requested of your team**. **My PRs** shows what blocks your own (changes requested, CI failing, approved), and **Involved** shows threads you are in. Each list is newest first, with the same **Sort** choices as the queue. A tab reads **50+** when GitHub returned its limit; the 50 shown are the newest. Clicking a row opens the PR in the review window. A repository you have not cloned opens diff-only. Set **Clone folder for reviews** in Git Integration's settings and **Clone and review** appears on those rows.

### Reviewing a pull request

The review screen gives the code the room.

- **Header:** the back arrow to the overview, the title, the status checks, and your progress, drawn as one segment per chapter with the minutes left. Then **Ask agent**, then **Submit review**, which shows how many comments are pending. The **⋯** menu holds Focus mode, **Only my files**, Overview (`i`), Hide file list (`t`), Pause review, Refresh, Pop out and the keyboard sheet.
- **Only my files:** the **⋯** menu's **Only my files** shows only the changed files that the base branch's `CODEOWNERS` gives to you or to a team you are on, as GitHub's file filter does. A **My files** pill shows while it is on, and clicking it turns it off. The item is off when you own none of the changed files, and the filter never leaves the review empty. It combines with Focus mode.
- **File list:** files grouped by chapter, with "2 of 3" viewed per chapter. Each row shows a mark (viewed, not viewed, or a red ring for a high-risk file you have not viewed yet), the name with its folder, its comment count and its size. Below 1,100px of width the list folds to a rail of those marks.
- **File header:** the full path, size, and **High risk** only when the file really is (see [ADR-113](../adr/113-a-file-is-high-risk-by-fixed-thresholds.md)). A second line says why the file is here, which symbols from this PR it uses, and how often it changed in 90 days. **View** and **Viewed** (`v`) sit on the right.
- **Diff:** a gap of 20 lines or fewer is one control ("Show 8 unchanged lines"); a larger gap steps 20 lines above or below, or shows all of them. Each hunk names the function or class it sits in. Within a replaced line, the words that changed are tinted more strongly than the line. Comments are cards in the UI font, with a **Reply…** field.
- **Footer:** **? Shortcuts**, the previous file by name, and one primary button that names where it goes: **Viewed, next: api.py**, **Viewed, next chapter**, or on the last file **Viewed, submit review**.
- **Submit review:** lists your pending comments, takes a summary, and offers **Comment**, **Approve** or **Request changes**. It warns, without blocking, when files are still unviewed.
- **Side drawer:** **Ask agent** or a file's **High risk** chip opens a drawer over the right of the diff. Medium and low files open it from **Why this file** at the end of the file header's second line. It does not narrow the diff. **Why this file** lists each risk factor in words, the value, and the threshold it was compared with. **Agent** holds the review agent. Escape closes it.

- **Reading order.** Files come in the order you need them: a function before the code that calls it, a type before the code that uses it, a test right after what it tests. Each file says why it is where it is, and **Uses** in the file header lists what it uses and the step where you read it. **Peek definition** jumps there.
- **Unchanged lines.** A file opens on its changed lines only. The bar between two hunks, and above the first or below the last, shows **20 more lines** up or down, or **all** of them. Expansion resets when you open another file. Revealed lines take notes and agent questions but not GitHub comments, because GitHub's API only accepts comments on lines in the diff. Files over 2 MB can't be expanded.
- **Tests for a block.** **Tests** on a hunk header, or on the bar under a selection, lists every line of a test file that mentions what that block defines (or the function it sits inside), searched at the PR's head. A test in the PR opens in the review at that line; any other test opens in your editor.
- **Comments.** **All**, **Unresolved** or **Hidden** in the file header's **View** menu (`c` cycles), next to **Agent notes**, **Unified**/**Split** and **Hide formatting-only hunks**. A dot on **View** means something is off its default. Hidden leaves a count in the gutter; click it to bring them back. **Agent notes** has its own switch (`Shift+C`).
- **Overview.** The **⋯** menu's **Overview** opens the PR overview: a header with the title, people, size and **Start review**, a readiness strip (checks, reviews, merge), and **Overview** and **Discussion · N** tabs. The same overview opens from the Code Reviews tab; see the [Code Reviews tab](#code-reviews-tab) section below.
- **Agent.** Drag across line numbers and a bar offers **Ask agent**, **Explain**, **Add note** and **Comment**. **Ask agent about this PR** reviews the whole PR; in the drawer, **This file** narrows a run to the file open in the diff and **Whole PR** widens it again. The agent reads the PR in a private worktree with read-only tools. Its findings stay on your machine, as dashed notes in the diff and in the side panel, until you choose **Post as comment**. Sonnet is the default model, and you can pick Opus per run.
- **Since your review.** When the author pushes, files you viewed that did not change stay viewed. Changed ones show **Changed since you viewed** and open on just what changed since you looked (`s` toggles the whole PR). Viewed marks are mirrored to GitHub.
- **Where you left off.** Come back after 15 minutes and a card shows your last position, your notes, unread agent findings, unsent drafts and what moved.
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

Resolution sessions persist across restarts. Once all conflicts are resolved, a single click stages all files and runs the merge commit.

### Code Reviews tab

The Code Reviews tab is a **workspace-scoped tab** — hover over a workspace card header to reveal the code review icon, then click to open it in the content area.

Features:

- Paginated queue of open and draft PRs, newest first, with **Sort** and search (see "The pull request queue").
- In the queue, a PR's risk is classified by total lines changed (≥400 = high, ≥150 = medium); opening a PR refines its risk with per-file analysis (churn, blast radius, coverage, complexity).
- PRs scored across six signals: tests, coverage, CI, lint, churn, and blast radius.
- **PR overview:** opening a PR shows, top to bottom:
  - **Header:** the title with its Draft or Open state, the author, `head → base`, when it was opened, files, `+added −removed` and the estimated reading time. **Start review** (or **Continue review · n of m viewed**) and, on a draft, **Mark as ready** sit at its right.
  - **Readiness strip:** three cells, **Checks**, **Reviews** and **Merge**. A settled state is quiet; a waiting one is amber; a blocker is red and carries its own action (**Update from main** when the branch is behind, **Resolve conflicts** when it conflicts). Click **Checks** to see every check, failures first.
  - **Overview tab:** the **Brief** (see Summarize), then the **Review plan**, one row per chapter with its risk, files, size and minutes; click a row to start the review at that chapter. Then the author's **Description**, at a readable width.
  - **Right rail:** **Signals** (risk and its hotspot, tested functions, complexity, how hard it is to read, code-health flags; hover one for its source) and **Details** (author, branch with a copy button, base, opened date, head commit, linked issues).
  - **Discussion · N:** the conversation as a timeline, with the comment box at the end.
    In a narrow pane the strip stacks, signals become a row of chips and the two buttons move to a footer.
- **Summarize:** the Overview and Discussion tabs offer to summarize the description or the discussion with the review agent's read-only `claude` (model, effort and timeout from the review agent settings). A description becomes a **Brief** of three parts: **Current state** and **What the change does** in one to three sentences each, then **Risks** as a bullet list, with a plain-text diagram only when the flow is hard to follow in words. A discussion becomes at most four points. Each shows when it was made and **Regenerate**. Once a brief exists the description below it is shortened; **Show full description** opens it. If it fails, the reason is shown in plain words with **Try again**. The brief is not saved: closing or reloading the overview drops it.
- Chapter-by-chapter review surface with syntax-highlighted diffs and inline comment threading.
- One-click review submission (Approve / Request Changes / Comment) via `gh` CLI.
- **AI-era enhancements:** universal language-agnostic chapter grouping, semantic-only diff filter (hides formatting/whitespace-only hunks), DRY violation detection, large-PR cognitive load warning (>400 LOC) with estimated review time.
- **Pop-out window:** the ↗ button opens a dedicated focused review window restoring the exact PR, session, and view state.
- Review sessions (chapter position, file, scroll) persist across restarts.

---

## 16. Extension: Foundry

![Foundry](screenshots/08-foundry-tab.png)

Foundry is a **software factory**. You give it an idea — typed in, or a Linear
issue — and it converges that into a **work order** you can read and
argue with. When the order compiles, it is handed to an orchestration that does
the work, manages the agents, checks the result and opens a draft pull request.

It replaces SpecKit Pilot's board and its ten-phase pipeline. The headline
difference is how often it interrupts you: a one-line change used to cost nine
decisions — eight phase approvals and a merge — and now costs **nought to two**,
because nothing stops unless a **named rule** fires.

### Opening Foundry

Click the **Foundry** tab in the content area tab bar. Two surfaces — the
Forge and the Ledger — and the one you land on is the Forge.

**The Forge tab carries a count when something is waiting on you** — gates and
waiting orders in the queue across its top, open questions and held tool calls
in the Forge itself. The tab strip is above the scroll area, so the count is on
screen whichever surface you are looking at.

### Waiting on you — the band across the top of the Forge

When a rule fires or an order is waiting on you, a band appears across the top
of the Forge, above the list, the factory view or an open order. When nothing
is waiting, there is no band. One queue, always sorted by how much work each
decision unblocks. Every row says:

- **which rule raised it** — `risk.p0`, `budget.exceeded`, `destructive`,
  `ready-for-review`, and five more;
- **what it asks**, on one line, with the risk, the pull request and ticket
  links and **what happens if you ignore it** (and whether it will wait for
  ever) under it;
- **the answers**, on the same line — the first is the recommended one;
- **why it fired**, and the evidence it looked at, when you click the row. The
  reason is formatted text; the evidence starts closed.

The same line is used for the gate holding an order on its Floor.

Above the gates, the band lists every order that is waiting on you without a
gate: a draft **Ready to hand off**, a draft whose **Shaping stopped** (it
names the check that still fails), or a run that **did not start** (it says
why). Each row has an **Open** button that opens that order below. These rows
count toward the Forge badge.

**The autonomy dial** (Settings → Foundry) decides which rules are live.
Four are live at every setting — the highest risk grade, an exceeded budget,
anything destructive, and marking a pull request ready — so **lights-out** will
open a draft without you and still will not merge anything.

### Forge — where an idea becomes an order

Describe what you want built or fixed. Before you are asked anything, Foundry
reads the repository: its manifests, its real commands, its house documents
(`CLAUDE.md`, `AGENTS.md`, a constitution, `CONTRIBUTING.md`), and any past
decision about a file your idea names. A question that survives that is one the
code genuinely could not answer.

An open order is a **frame**, not a page: **All orders** at the top, the order
itself in the middle, and **Discard this order** / **Delete this order** along
the foot. **Discard** marks an order cancelled and keeps its records; **Delete**
removes the order and everything it made — its ledger, its run graph, its
checkout and its branch — and asks you to confirm that in as many words first.

Inside the frame the order is **walked in steps**. The box has four parts:

- **The status strip** at the top says who holds the order right now and what
  happens when they finish, for example **The red team is reviewing the plan ·
  round 2 of 3 — When it finishes clean, you can hand off.** Foundry never
  starts new work on its own: nothing builds until you press **Hand off**. The
  one exception is an order you already handed off: if a defect sends it back
  and you press **Answer**, the amended order starts again by itself as soon as
  it passes every check. Blue means Foundry is working and you don't need to do
  anything. Orange means only you can decide something. Red means something
  failed and needs a fix. Green means you can hand off, or the order has been
  handed off.
- **The step list** on the left. Every step has a word under it that says its
  state: **Done**, **Reviewing, round 2 of 3**, **Needs you: 2 decisions**,
  **Needs a fix**. Steps after one that is waiting on something stay numbered
  until it clears.
- **The open step** on the right.
- **The bottom bar**: **Back**, a line saying why you can't move on yet, and
  the way forward.

The steps:

1. **Intent** — the problem and the outcome the order is for.
2. **Plan** — the acceptance criteria and how each is proven, the coverage
   matrix, the assumptions the architect made, any question it needs you to
   answer, and the budgets.
3. **Red team** — what an adversarial pass found in the plan.
4. **Shape** — the shape of work.
5. **Tracker** — what goes back to the issue. Shown only for an order seeded
   from a tracker issue.
6. **Hand off** — seven rows that must all pass, and **Hand off**.

Any step can be opened from the step list at any time. An order opens where the
next thing to do is.

**Every button that can't be used says why.** Hover it, or move to it with Tab,
and a tooltip gives the reason, for example "The red team is reviewing the plan
(round 2 of 3, started 13:06:19). Hand-off opens when it finishes." Clicking it
shows the same reason under the button.

**Questions** the architect was less than 90% sure about appear on the Plan step
under **Needs your answer**, and the status strip turns orange. The recommended
answer is marked. Everything else Foundry decided is a **strikeable assumption**
on the Plan step rather than a question. Click it to strike it, and the parts of
the order that depended on it are redrawn.

**Draft the plan** is the first thing to press, and it sits in the order's
header on every step (it reads **Redraft** once there is a plan). Foundry seeds
a draft with your problem statement and what it read in the repository; the
architect turns that into criteria, units and a risk grade. It runs in
a terminal you can watch, and it can only _propose_. It cannot mark its own
work agreed. Type into the box at the bottom of any step to tell it what is
wrong, and it redrafts. While someone is working, the header offers **Watch the
architect** (or the red team, or the scout), which takes you into that
terminal.

**Foundry does most of the shaping on its own.** When a check fails that the
architect can close, it gets up to two automatic turns to close it. A plan the
architect wrote in the wrong format goes back to it the same way, and you see
it only if those turns don't fix it: the strip then says which part was
unreadable and offers **Start the turn over** or **Tell the architect what was
wrong**. While it
works, the step shows **Being revised** in blue rather than a red cross, because
nothing is wrong yet. Once the plan passes, the red team reviews it. Blocking
findings go straight back to the architect. The order then hands off unless the
red team asked to review the fix, or the architect left a blocking finding
open, in which case the red team takes another look, up to three rounds. You
only see orange when that loop stops: after three rounds without agreement, or
when you press **Hold for me**.

**Hold for me**, in the status strip while Foundry is working, stops it from
starting anything else on its own. The turn already running finishes. **Let it
continue** picks up where it would have gone.

**Seven rows** on the Hand off step, and it will not hand off until all seven pass:
no open questions, every criterion can be proven, plan and criteria cover each
other, risk graded against _this_ plan, no blocking red-team findings, the base
branch builds and passes its checks, and nobody is changing the plan. A passing
row says why it passed. A failing check
also shows on the step that clears it, with what to do about it: either a
button that takes you to the control that clears it, or one that redrafts with
the instruction the architect needs.

**The base branch** is checked as soon as the order is created. While the
architect drafts, Foundry checks out the base branch and runs its format, lint,
test and build commands, each in its own terminal tab. A broken install is
reinstalled once. If a check fails there, the row says which one, with its exit
code and command, and offers **Check again** (after you fix the branch or the
setup) or **Skip this check**. Skipping it is recorded in the ledger,
and a check that fails on the base branch then reads **failing on base** in the
pull request, not as this change's fault. A bug fix whose only failure there is
its tests passes this row: a failing test is where a bug fix starts. A
base branch where nothing could be measured does not pass either.

The one that catches people is **criteria falsifiable** on a change somebody
can see: a plan that touches a `.tsx`, `.css` or `.html` file and has no
criterion asking for a picture of the running application fails, because a
command cannot say whether a thing renders. **Ask for proof** has the architect
add a `screenshot` criterion. If nothing here can take that picture — no
display, no runner — mark the criterion **"Nothing here can prove this"** on the
Plan step. That costs a written reason, which travels with the order and shows
in the ledger.

**Budgets** are yours to set, not the architect's. Each new order starts with
the limits in Settings → Foundry: agents at once and minutes. There is no
limit on how many files an order touches. In Settings, 0 means no limit. To change the limits for one order, use the
**Budgets** section at the bottom of the Plan step: enter a number or tick
**No limit**, then press **Save budgets**.

If a run goes past a budget, it stops and asks you what to do. **Raise the
budget** asks for the new limit. It suggests about a quarter more than the run
has already used, and won't accept less than what the run has already used.
The new limit is saved to the order and the run resumes. You can tick **No
limit** there as well.

**Red team** findings are grouped by who acts on them:

- **The architect is fixing** — blocking findings a fix turn is handling now.
  Nothing to do.
- **Needs your decision** — blocking findings the loop left to you. Choose
  **Ask the architect** (it changes the order so the finding no longer holds),
  **Fix it…** (say how) or **Accept it** (keep it, with a written reason), then
  **Send** at the bottom. Everything you decided goes in one turn.
- **Notes, nothing to do** — findings that don't block hand-off: scope,
  process, setup, or something already true before this change. The builder
  sees them.
- **Resolved** — collapsed.

**Shape** offers every shape this repository can support, each with its whole
description. A shape that can't run here is locked, and its tooltip names the
requirement it doesn't meet. Foundry proposes one and says why. **You can pick
a different shape at any time before hand-off, even while Foundry is working.**
Your choice is saved to the order straight away, recorded in the ledger, and
used by both your hand-off and the automatic one. The card shows **Your
choice**, and **Use the proposal** goes back.

There are six shapes. **Direct** is the one for a single lane: it builds,
lints, checks the change with your project's own test command (or a fresh
verifier when the repository has none), has the change inspected when
something risky was touched, updates the documentation unless the change is
the smallest grade, and ships. **Standard** is for work spanning more than one
lane or graded above ordinary risk. **Bugfix** proves the bug first,
**refactor** proves behaviour unchanged, and **speckit** runs the Spec Kit
pipeline where it is installed.

**Research** is never proposed and is there to be picked: a question whose
answer is a document. The author writes it where the order says. A document in
the repository ends in a draft pull request. A document the order wants
somewhere else, or in another repository, is written to the order's own
outputs folder, or published and linked, and the run finishes on it with
**Finished · document ready** and no pull request. Write the acceptance
criteria as statements about the document, so the verifier has something to
check.

A change that only touches documentation (markdown, `docs/`, `specs/`, a
readme or a changelog) gets a short final check: format and lint, and the
rest is marked not run, "documentation only".

A `research` order ends on its document, not on a pull request. When the
session is signed in to claude.ai, the author publishes the document as a
Claude artifact and Foundry checks that the link is one the author actually
published. The order then reads **Finished · published as a Claude artifact**,
and the link is on the order's row, on the open order (**Open artifact**,
**Open local copy**, **Copy link**), in the factory hall and on Home's drawer.
The ticket moves to In Review with the link as a comment. Without a claude.ai
sign-in the document stays with the order, and **Open document** opens it.

Each shape also says how hard its agents think. `direct` and `research` run at
`medium` effort; `standard`, `bugfix`, `refactor` and `speckit` run at `high`,
because a second look, a root cause or a refactor that must prove behaviour
unchanged is where deeper reasoning pays. A recipe of your own sets it with
one line, `effort: high`, on the recipe or on a single step.

**Tracker** lets you say which of _your_ workflow states each moment means —
when work starts, when the draft opens, when it merges. Left alone, the tracker
decides. It also says, for this order alone, what goes back to the issue: the
agreed order as a comment, the workflow state, and the pull request links.
The issue moves to In Progress when the work starts, to In Review as soon as the
draft pull request opens (not after its checks finish), and to Done only once the
pull request is merged. A team with a single "started" state has no review state,
so its issue stays In Progress, and the order's history says why.

**Hand off** also says when the repository has no command for a check — **"Not
measurable here"**. Those report **"not measured"** rather than passing. A green
you did not earn is worse than a gap you can see — and the three rungs that
were never commands (independent verification, the security inspection, your
own decision) say where they were decided instead of counting as gaps.

![A work order in the Forge, open on its first step with the step list above it](screenshots/08b-foundry-forge.png)

**Hand off**, at the foot of the Hand off step, agrees the order and starts the
work with the shape it names (**Hand off with Direct**). Beside it, **Hand off on
its own when clean** is the same setting as Settings → Foundry. When it is on,
an order whose red-team round finds nothing blocking hands itself off, and the
status strip says so in advance. Afterwards it says **Handed off automatically
at 13:07:53**, and the ledger records that Foundry agreed it, not you.

If Claude cannot start an agent, the status strip says **"Claude could not start
the architect."** (or the red team, or the scout) and quotes what Claude said.
Nothing on the order changes. **Try again** asks again: the architect drafts
again, and a red team that could not start gets its round; **Copy the error**
copies Claude's words. The canary (`npm run canary`) and `npm run test:live`
start every role against the real Claude, so a start failure that is Foundry's
own shows there before a release. Until a plan exists, **Next: Red team** is locked with **Waits
for a plan**, and the coverage check reads **Waits for a plan** instead of
**Failing**.

In the list of orders, a row that is waiting on an answer says **"N waiting on
you"** where the others say what is blocking them — so the count on the Forge
tab tells you which order to open.

A row also carries what you would otherwise open the order to find: the pull
request (**#233**) and the ticket (**TAV-15**), each opening in your browser;
while CI is watching or fixing, a spinner with the same words the Floor uses
(**First run · up to 2 fixes**) and **1 of 3 checks done**; and, when the move is
yours, the gate's first two answers on the row itself (a shipped order waiting to
be marked ready says **Mark ready** right there).

### Floor — watching a run

The run graph by repository, what is ready, what is blocked and why. When an
order spans several repositories there is a **merge order** section naming the
files the lanes share and which lane must land first.

The band at the top says where the run stands and, while agents are working,
what each one is doing: its last few tool calls and messages, newest last, with
how long ago it last did anything. It refreshes every two seconds. An agent that
has just started says **Starting — nothing yet.**

Under the title sit the **pull request** (`#233`) and the **ticket** (`TAV-15`)
the order came from, once they exist; each opens in your browser. Next to them,
**Review** opens that pull request in the Git extension's review. With the Git
extension turned off the button says **Open on GitHub** and opens the pull
request there instead. Foundry no longer draws a hunk-by-hunk review of its
own.

Once the draft pull request is open the **CI** card says where the checks
stand in words (**First run · up to 2 fixes**, **Fix 1 of 2**, **Passed**), shows
a spinner while it is still watching or sending failures back, counts the
checks that have finished (**1 of 2 checks done**) as they arrive, and links
the pull request and each check.

Each step is a chip. A step that passed reads **done**; a skipped step says why
when you hover it (**Skipped: runs only when risk triggers fire; this order has
none**). The scroll icon (**Transcript**) opens that step's transcript directly
under its row; the terminal icon appears only while the step is running, since
a finished step's terminal is closed. If going to a terminal is refused, the
reason shows next to that step.

Two things you can do without leaving:

- **Waiting on you** sits above the run graph and lists every tool call an
  agent is holding — allow it, deny it, or hand it back to the terminal to
  answer where the agent is. Nothing in that run moves until you do, and an
  agent stopped at one looks exactly like an agent that has gone quiet, which
  is why it is the first thing on the screen rather than the last.
- Every piece of work is named by what it is — the role and the unit it is
  building, not the identifier the run graph uses internally — and **Blocked**
  says what each one is waiting on in the same words.
- **Watch** a unit to read its transcript, and **Redirect**, **Interrupt** or
  **Stop** it. The terminal is always there as the backstop: the agent runs in
  a real terminal in its own worktree project, and you can go and type at it.

### Autonomy — how much it asks you

Three settings, differing in which rules stop the line. Four things ask at
every one of them, including the most permissive: before anything is merged,
before a destructive action, when a budget is exceeded, and when the change
turns out to carry real risk. With **Let auto mode decide** on, an agent's
destructive tool call is the exception: auto mode decides it (below).

Everything else depends on where the dial is. At **escorted** every action an
agent takes waits for you. At **standard** and **lights-out** ordinary work
inside the unit's own worktree is taken automatically and recorded — editing
the files the unit was given, running the project's tests — and what reaches
you is what the rules actually wanted a person for.

**Let auto mode decide** (Settings → Foundry, on by default) answers the rest.
At standard and lights-out, a tool call Foundry's own rules have no opinion
on, such as a write outside the worktree, is decided by Claude Code's auto
mode, and so is a destructive action: auto mode behaves exactly as it does in
any other Claude Code session. Without it, the call waits five minutes for
you. Escorted still asks about everything.

"Destructive" is read generously: `rm`, a hard reset, `git clean`, a force
push, deleting a branch, and anything the check cannot parse. A command it
cannot read is treated as destructive rather than assumed safe.

### Ledger — the record, and the one place it argues back

Every decision, who or what rule took it, what it was about and why, filtered
by order, by who decided, and by action. The filters only offer values that
actually occur.

One button: **What do I keep rejecting?** Foundry reads the record and, when
the same reason has turned work away three times, proposes a rule — citing the
specific entries it derived from. Accept it and it applies to later work in
every repository; decline it and it is never offered again. It proposes nothing
until you press the button.

Below that, **Checks you accepted** lists the rules you put there — never the
ones that ship with Foundry, and never a rule a repository carries, because
neither is yours to delete. **Remove this check** takes one back out, and the
removal is kept with its reason so the same proposal is not offered back to you
next week.

![The Ledger, with a check the operator accepted](screenshots/08c-foundry-ledger.png)

### Shipping

Work ends in a **draft pull request** without being asked, carrying a written
summary, the verdict for every criterion (including the ones nothing could
check) and any inspection findings. Under the verdicts, **What's left for
you** lists everything that still needs a person: criteria that failed or were
not measured, checks not measured, checks that fail on the base branch,
red-team findings you accepted, assumptions nobody struck and questions still
open. It starts with a count ("**7 of 9** criteria pass. 2 need you."), and
every item comes from the order's own record, never from an estimate. The
decision you are then offered is whether to **mark it ready** — never whether
to create it.

For an order graded at either of the two highest risk levels, your decision is
taken **before** anything reaches the remote. For everything lower the draft
opens first, so review happens on a real change.

For a change that needs no inspection and is graded below the two highest
levels, the draft opens as soon as the work is done, and the final check runs
while the draft's own checks do. "Mark it ready?" appears only when both are
green; if the final check fails, the draft stays a draft and you are asked what
to do about the failed check. The recipe's last step reads as running until
then, because it is: shipping is still under way.

### Where Foundry keeps its things

**It writes nothing into the repositories it works on** — no scaffolding, no
configuration, not even a `.gitignore` entry. Its own records go wherever you
point **Settings → Foundry → Where Foundry keeps its records**; leave it empty
and they go to `<workdir>/.foundry/`, which leaves an untracked directory in
each repository you run an order in. Foundry says so once and never edits your
ignore file.

A repository _may_ carry its own `.foundry/recipes/…`, `.foundry/roles/…` or
`.foundry/rules/…` and those win. None is ever required to.

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
- **Outline** — the open note's headings, in the right rail above the comments, nested by heading level. Click one to jump the editor to that heading. With the comments open the two split the rail evenly — half each, whatever either one holds; with one closed the other takes the whole rail. Close the outline from the button in its header and bring it back with the **Outline** icon in the toolbar; closing both gives the whole width to the editor. The same panel is in a popped-out note window. Headings inside fenced code blocks are not listed, and depth is measured from the note's own top heading, so a note that starts at `##` is not indented for it.
- **View modes** — the toolbar's **Live / Source / Read** control: edit the rendered note, edit its raw markdown, or read it without editing.
- **Margin comments** — pin comments at any position in the note body.
- **Full-text search** — type in the search bar to filter notes by content.
- **Multi-tag filter** — click the Tags button in the sidebar to open a multiselect dropdown and filter by one or more tags simultaneously.
- **Import/export** — export all notes and diagrams as a zip (`.md` files + `.excalidraw.json` files).
- **Settings** — in **Settings → Extensions → Notepad**: **Editor font size** (14 px by default, 8–32) and **Autosave debounce**, how long typing must pause before a note is saved (800 ms by default, 100–10000). Both apply as soon as they are changed, in the panel and in popped-out note windows. Diagrams keep their own 1.2 s save delay.

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

| Section      | Contents                                                   |
| ------------ | ---------------------------------------------------------- |
| **Today**    | Daily log for the current date, mini calendar on the right |
| **Inbox**    | Quick-captured items awaiting triage                       |
| **Projects** | Named project containers for related tasks                 |
| **Areas**    | Ongoing responsibilities (PARA areas of focus)             |
| **History**  | Past daily logs                                            |

### Today

The date is the heading, with **Today** beside it when that is what you are looking at. An empty
day says so and offers the two things you would do next — **Add task**, or **Open inbox** — rather
than leaving a blank column.

The calendar on the right marks each day by what is on it, and hovering a day says it in words
(`3 tasks, 1 overdue`), so a busy day and an overdue one are not the same dot.

### Stale tasks

An open task left on Today rolls over to the next day. Once it has rolled over for **Stale Task
Threshold (days)** (Settings → Extensions → Task Vault, 7 by default), Today marks it **stale**. A
project is stale for a different reason: it has no open next action.

### Quick capture

Press **`Cmd+Shift+Space`** from anywhere to open the capture dialog. Type using the natural syntax:

```
Task text… @project #area +context due:YYYY-MM-DD
```

Press `Enter` to save or `Esc` to dismiss.

### Task features

- **Recurring tasks** — set daily/weekly/biweekly/monthly recurrence; the engine automatically ensures exactly one future open instance exists at all times.
- **Task detail panel** — click any task to open a right-side panel with markdown-capable Description, Acceptance Criteria, and Dev Hints fields.
- **Ghost subtask row** — a faint `· + Add subtask…` row at the bottom of each open task expands inline on click.
- **Bidirectional links** — link vault items to specific terminal sessions.

### Context filter

Click the **Context filter** button (always visible in the toolbar) to open a multiselect dropdown and filter all views by one or more `+context` tags.

---

## 19. Extension: Remote Control

Remote Control lets you reach your Terminator terminals from **any web browser**, on your own
network or over the internet.

### Turning it on

Open the **Remote Control** tab. The top of the screen answers the question you came to ask —
whether it is on, and how to reach it:

| It says                                 | Meaning                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Off**                                 | Your terminals are not reachable from any browser. **Turn on** starts the server.                                                      |
| **Starting…**                           | Opening the port and creating an address.                                                                                              |
| **On — reachable on this network**      | The address works for devices on your network. Add an account token in Settings to go further.                                         |
| **On — reachable from any browser**     | There is a public address.                                                                                                             |
| A failure, in words                     | What went wrong and what fixes it — e.g. the port is already in use, so pick another or quit                                           |
|                                         | whatever is listening on it.                                                                                                           |
| **The public address stopped working.** | The tunnel dropped. **Reconnect** makes a new public address without restarting the server, so devices on your network stay connected. |

When it is on you get the address, a **QR code**, and the password. Point a phone camera at the
code and it connects — the code carries the password, so on the everyday path the credential never
has to appear on screen. Use the eye button to reveal it if you are typing it by hand.

Below the address is the sentence that matters: **anyone with this address and password can type
into your terminals.**

### Who is connected

**Connected now** lists every device watching, by something you will recognise ("iPhone",
"Chrome on Mac"), which terminal it is on, and how long it has been there — with **Disconnect**
on each row. The list is live: it changes as devices come and go, because "who currently has
shell access" is not a question to answer with a stale list.

A device you disconnect is told so ("The desktop app disconnected this device.") and does not
reconnect by itself; it can only come back by its own **Retry**. To keep it out, change the
password.

### Settings

Port, viewer limit, password and the account token for a public address are under **Settings**
at the bottom of the screen, collapsed until you want them. The summary line shows the port and
viewer limit without opening it.

The viewer limit is how many browsers may watch one terminal at once. One more is turned away and
told why, with a **Retry** for when someone leaves.

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
