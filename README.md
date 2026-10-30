# Terminator

An extension-first, AI-focused terminal emulator built on Electron. It organizes work into Workspaces (repository-level) and Projects (task-level). Persistent tabbed terminal sessions stay alive while you navigate between them.

## Features

- **Workspaces & Projects** — Two-level hierarchy. Workspaces map to local directories. Projects hold terminal sessions.
- **A branch-first sidebar** — The sidebar lists repos and their branches, one row each. Terminals are not in it: they are tabs above the terminal, rows on Home, and tiles on the Overview wall. A branch row carries at most six things:

  - its state, in a fixed gutter down the left edge, so "what needs me" is one vertical scan;
  - its branch name;
  - a linked issue key;
  - its `+n/−n`;
  - either how many terminals share its state, or how long since it last did anything.

  A branch with no terminals is still listed. The kind glyph marks the exception, not the rule: a plain checkout is marked and a worktree is not. Repo colour is one 2px rail and a small swatch. State is a small chip, amber when a branch needs you and green while it works, so the eye goes to state first. Four views ship built in — **Everything**, **Needs me**, **Active**, **Stale**. They sit behind a **Filter** menu that also counts what it hides and offers the way back. Grouping and sort live in **Display**. Sort orders the whole column, repo headers included. **Manual** is the order you dragged repos and branches into. Dropping one switches the view to Manual, because any other sort would recompute over it. The sidebar has two menus and two bands of chrome, and the first row of work sits 98px from the top instead of 165px. `⌘P` lists terminals alongside commands. `⌘]` / `⌘[` cycle recently used terminals across branches. (`⌘⇧A`, "jump to the next session waiting on you", reads a stale copy of session state and does not currently find anything. This is a known defect, tracked separately.)

- **Stale session cleanup** — A session goes stale once it has exited, or once it has been quiet longer than your threshold (default 2 hours, configurable in settings). **A session waiting on you is never stale, however long it waits.** In the Stale view you can shift-click a range and close it in one action. If any of those sessions live in a git worktree, the confirmation names the exact paths that will leave disk before you agree.

  _One honest limitation:_ "waiting on you" is inferred from the terminal bell, because that is the only signal the core app has. An agent that waits without ringing the bell reads as idle, so **Needs me** under-reports. Core cannot read the Claude Code hooks: they belong to the Foundry extension, and by design extension internals are off-limits to core. A shell-launched agent emits no signal at all. The state machine sits behind a single swappable source, so a better signal can replace it without a UI change.

- **Persistent terminal sessions** — xterm.js `Terminal` instances are never destroyed on tab switch. Buffer, scroll position, and running process survive navigation.
- **Theme system** — Dark and light themes switch immediately app-wide through CSS custom properties (`[data-theme="light"]` token overrides). Terminal colours re-apply live through a `MutationObserver`, so no restart is needed. Per-workspace theme overrides are supported.
- **Settings** — Global and per-workspace configuration for theme, scrollback limit, and default shell.
- **Quick Actions** — `Cmd+P` opens a leader + which-key panel. A letter acts immediately (`g` opens the Git group, then `p` pushes). `/` (or `Cmd+P` again) switches to fuzzy search over label, category and description. Every action that cannot run right now shows dimmed with its reason, not hidden. Pinned actions (`Cmd+.`) sit first, then your most-used actions in a "Pinned & recent" row. Both survive a restart. The panel covers core terminal, session and workspace actions and the v1 extensions (Git, Notepad, Task Vault, Foundry). You can also define your own shell and Claude-prompt actions in Settings, with the variables `{cwd} {branch} {worktree} {repo} {issue} {selection}`. See [ADR-057](docs/adr/057-quick-actions-are-a-leader-panel.md) and the [user guide](docs/user-guide/USER-GUIDE.md#8-quick-actions).
- **Extension system** — Extensions install from **any directory on disk**. Without a change to core code they contribute settings sections, sidebar panels, global tabs, workspace-scoped tabs (hover-reveal icons on repo headers), top-bar menu items, native View menu items, quick-action commands, and terminal event hooks. Extension UIs run in isolated `WebContentsView` contexts. Extensions can use any React version or framework, and an update needs no app rebuild. See [Extension Development Guide](docs/EXTENSION-DEVELOPMENT.md) and [`packages/extension-sdk/`](packages/extension-sdk/) for type-safe third-party development.
- **Shared extension UI** — [`packages/extension-ui`](packages/extension-ui/) is the single implementation of the dialog, confirm, popover, toast and empty-state behaviour. It is published to the bundled extensions, to third parties, and to the core itself. It is source-only, with React as a peer dependency. An extension view is a separate document, so a dialog renders inside it ([ADR-038](docs/adr/038-dialogs-render-in-the-extension-view.md)). Escape closes only the innermost surface. Stacking comes from a named four-step scale, not raw `z-index` numbers. Extension views carry both light and dark themes. Tests assert WCAG AA by rendering every surface in both themes, not by reading the stylesheet. House rules: [Extension Style Guide](docs/EXTENSION-STYLE.md), with ESLint enforcing the vocabulary rules.
- **Git Integration** — Built-in first-party extension: a Git tab for staging and committing, and PR creation through the `gh` CLI. Configurable per workspace. Refreshes automatically on file changes.
- **MergeFlow** — Intent-first, card-based conflict resolver built into the git-integration extension. When a `git merge` produces conflicts, a "Resolve conflicts →" button appears in the Git tab. MergeFlow shows each conflict as a two-panel diff (yours vs. theirs) with author info and commit context for each side. It offers Keep Mine / Keep Theirs / Keep Both / Edit manually / Ask AI actions. Navigation is keyboard-first: `M` (keep mine), `T` (keep theirs), `B` (keep both modal), `E` (manual editor), `Enter` (confirm), `←`/`→` (prev/next conflict), `Cmd+Z` (undo last decision), `Cmd+Shift+A` (AI suggestion panel), `Esc` (close modal). Session state persists across restarts, so you can resume an interrupted resolution session. The commit flow stages all resolved files and runs the merge commit in one click.
- **Reviews list** — The global Reviews view lists pull requests that need you (requested of you first, then re-reviews and team requests), your own, and ones you are involved in. **Repositories** in its header opens a picker of every repository your account can reach, grouped by owner, with search and select-all per owner. The list then searches only those repositories (empty means all). If GitHub fails to answer a section, that section shows its own short error and Retry while the rest still load.
- **Code Reviews tab** — PR review workflow inside the git-integration extension. Open it with a hover-reveal icon inside each workspace card header. It is a workspace-scoped tab: the icon appears on hover and is scoped to that workspace's repository. The queue lists open and closed PRs, with search by title or PR number, and a one-line summary: the repository's real waiting count, how many PRs are high risk, and roughly how long the reading takes. Pages load on their own; there is no "load more". The list groups itself into Read these first / Quick wins / Larger reviews, so the only filter left is the one the groups cannot express (open more than 3 days). Each row names its risk in words, and its action is **Review**. Approval happens after the diff, never from the list. PRs are scored across six signals: tests, coverage, CI, lint, churn, and blast radius. The review surface goes chapter by chapter. It has syntax-highlighted diffs, word-level highlighting inside replaced lines, compact gutters, comment cards, and a file list grouped by chapter. **Submit review** is always in the header with its pending-comment count (Approve / Request changes / Comment through the `gh` CLI). A file reads **High risk** only past fixed thresholds ([ADR-113](docs/adr/113-a-file-is-high-risk-by-fixed-thresholds.md)). **Why this file** explains each factor in a drawer that overlays the diff and does not narrow it. Review sessions (chapter position, file, scroll) persist across restarts. In-progress PRs appear at the top of the queue even when they fall on a later pagination page. The queue prunes closed and merged PRs from the in-progress list automatically. Hover a paused or in-progress row to show a dismiss (×) button that removes it from the list. The pop-out button opens a dedicated focused review window and restores the exact PR, session, and view state. **AI-era enhancements**:

  - universal, language-agnostic chapter grouping from git co-change history (works in Go, Python, Ruby, Rust, Java, Swift, and any language);
  - a semantic-only diff filter that hides formatting-only and whitespace-only hunks (in the file header's View menu);
  - DRY violation detection across files, with an inline chip indicator;
  - a cognitive-load warning for large PRs (>400 LOC) with estimated review time, and a focus mode that shows only medium and high risk files (both in the review header).

  Opening a PR shows its overview:

  - a header with the title, author, branches, size, reading time and **Start review**;
  - a readiness strip for checks (failures first), reviews and merge state, each blocker with its own action;
  - a **Brief** from the review agent, the **Review plan** (click a chapter to start there) and the description at a readable width;
  - a right rail of risk, test, complexity and readability signals, plus the PR's details ([ADR-112](docs/adr/112-the-pr-overview-shows-status-before-story.md)).

  **Summarize** asks the review agent's read-only `claude` for a brief of at most four points. Terminator keeps the brief only while the overview is open (see [ADR-111](docs/adr/111-pr-summaries-run-the-review-agents-claude.md)). **Keyboard**: `]` / `[` move to the next / previous file across chapter boundaries. `}` / `{` jump to the next / previous chapter. `n` goes to the next unviewed file. `v` marks the file viewed. `?` lists every key. In the chapter list, Up/Down/Home/End move between chapters. The file you are in is a solid accent row, so it reads at a glance in both themes. Diffs are cached per pull request head, so switching files after the first takes milliseconds, not a network round trip. `npx tsx scripts/perf/git-integration.mts <pr>` measures each step. Requires `gh auth login`.

- **Foundry** — A software factory. An idea, typed in or taken from a Linear issue, is converged with an agent until there is a work order that **compiles**. An orchestration then does the work. There are two loops and one contract.

  - **The Forge** reads the repository before it asks you anything (its manifests, its house documents, its real commands). It will not hand off until six mechanical checks pass: no open questions, every acceptance criterion falsifiable, coverage complete in both directions, risk graded against _this_ plan, adversarial findings resolved, budgets set. Every failing check carries the move that clears it: the control that answers it, or a redraft carrying the instruction. This includes the written escape for a criterion nothing here can prove.
  - **The Line** picks a shape of work, a _recipe_ (a YAML file, not a hardcoded pipeline), and runs it. It uses typed agent roles, verdicts produced by somebody other than whoever did the work, a verification ladder that stops at the first failure, and a security inspection when the change warrants one.

  A check that fails in the lane (the repository's own lint or test command, run in a terminal tab) sends the work back to its builder once, with the failing output, before Foundry asks you anything (see [ADR-063](docs/adr/063-a-failed-check-sends-the-work-back.md)). Once a draft is open, Foundry watches its CI. A red CI goes back to the builder with the failed logs twice before Foundry asks you. A draft with no checks says "not measured", never green (see [ADR-064](docs/adr/064-ci-is-a-check-with-rounds.md)). You can give agents Claude Code skills: a role or step names them, and Foundry mounts them for that agent from your data directory, the repository's `.foundry/skills/` or Foundry's own. It never writes them into the repository (see [ADR-065](docs/adr/065-skills-are-mounted-never-installed.md)). **Sensors** watch what the product itself says while the app is open: CI failing on the base branch, issues piling up under a label, your tracker. They list what they find in the queue across the top of the Forge, under the gates, ranked by how often and how badly. Promoting one seeds a draft order from its evidence. Nothing starts until you agree. Sensors are off until you enable them in Settings (see [ADR-066](docs/adr/066-sensors-propose-never-start.md)). Orders that change the same files **queue** behind each other. When you merge one, Foundry rebases the drafts queued behind it onto the new base and checks their CI again, or tells you which files conflict (see [ADR-067](docs/adr/067-the-refinery-restacks-it-never-merges.md)). Work ends in a **draft pull request** without being asked, and you decide whether to mark it ready. Interruptions come from **named rules**, not from phase boundaries: nought to two decisions on an ordinary change, against nine before. Every decision says which rule raised it, what it looked at and what happens if you ignore it. The Forge's tab counts everything that waits on a person, and the Forge shows it at the top:

  - gates and waiting orders, in a band that is there only while something is waiting;
  - the Forge's open questions, across the width of the screen above the document;
  - a held tool call, above the run graph.

  So no decision Foundry needs from you sits below a fold. Foundry **picks back up** a run that was in flight when you quit. An agent's terminal is a child of the application and dies with it. On reopening, the Floor names every step whose agent is gone. The queue raises one row per order within one poll of opening, not hours later. Foundry restarts each step from where it stopped, continuing the agent's own conversation and not starting cold. Stopping a run stops it: Foundry ends the agents, cancels the order, and leaves the worktrees alone. An **autonomy dial** selects which rules are live. Five stay live at every setting, so lights-out never merges anything and never hides a run that has stopped moving. Each order is **one sidebar project** per repository. The architect, the agents and the checks all run in it. The project is named after its Linear ticket's recommended branch and linked to that ticket. A typed idea offers to create the ticket first. Without a ticket, the project is `foundry/wo-…` (see [ADR-061](docs/adr/061-one-project-per-order.md)). Deleting an order removes its projects and closes every terminal session in them. The Forge stops you only for what the architect cannot settle. The architect takes a choice it is at least 90% sure of and shows it as an assumption you can strike. A plan that still fails its checks goes back to the architect on its own, up to twice (see [ADR-062](docs/adr/062-the-forge-decides-what-it-is-sure-of.md)). Foundry shows everything an agent writes as rendered markdown. One order can span several repositories, merged in an order derived from the files they share. The **ledger** records every decision, by whom or by what rule, and why. The factory measures itself from the ledger: lead time, your time, first-pass yield, reworks, CI rounds, and how often you strike a decision the Forge made for you. It shows these under the Ledger's **Factory** tab and on the factory's status wall. When you ask it, and never before, it tells you what you keep rejecting and offers a rule for it. Foundry **writes nothing into the repositories it works on**: no scaffolding, no configuration, not even a `.gitignore` entry. Its own records go to `terminator.foundry.dataDir`, or to `<workdir>/.foundry/` if you have not set it. A repository _may_ carry its own `.foundry/recipes/…`, and those win. No repository is ever required to carry them. **Factory view** — you can switch the Forge's order list and Line to a lit, detailed pixel-art hall. The crew visibly walks to its station, works, calls a tool and carries work down the belt to the next station. The hall is drawn live from the same run graph as the list. Its front door lists the orders still in play under **Active**, and the finished ones, tinted green, under **Completed**, each newest first. Nothing moves without a graph transition, a tool call or a gate behind it (see [ADR-060](docs/adr/060-a-factory-is-a-projection.md) and [ADR-079](docs/adr/079-a-station-shows-its-own-work.md)). The hall says status inside the scene:

  - each station's name is stencilled on the floor beside it;
  - a station shows the work it is doing (a terminal, a page being read, code being edited, a press stroking);
  - a callout rises where something happened;
  - a station opens into a pixel-art green-screen monitor that shows its agent's transcript live (see [ADR-081](docs/adr/081-a-station-opens-into-its-monitor.md));
  - a card pinned over whatever is waiting on you can be answered in place.

  You can **replay** a run afterwards from what Foundry recorded as it went (`run-timeline.jsonl` beside the order's run graph). The toggle sits in the Forge's app bar and as the **Toggle factory view** quick action (`Cmd+P`, then `v`). The preference (`terminator.foundry.view`) is per operator and survives a restart. The queue above the hall, the Ledger and Settings are the same in both views.

- **Notepad** — Markdown notes with live preview, margin comments, full-text search, tags, and import/export. **Folders** — organise notes and diagrams into named folders. Create folders from the sidebar header, rename or delete them with right-click, and drag items between folders or to the root. **Multi-tag filter** — click the Tags button in the sidebar to open a multi-select dropdown and filter by one or more tags at once (it replaces the old single-tag sidebar). **Diagrams** — embed freehand whiteboard diagrams alongside your notes using the [Excalidraw](https://excalidraw.com/) canvas (shapes, arrows, sticky notes, freehand drawing, in-place text editing by double-clicking shapes). Diagrams appear in the same note list as a distinct item type, sorted together by last-updated time. Open one in a focused pop-out window with the ↗ button. **Diagram export** — the bulk export dialog includes diagrams (as `.excalidraw` files alongside note `.md` files). **Canvas comments** — pin Miro-style comments at any coordinate on a diagram. Click the Comment button in the toolbar, click anywhere on the canvas to place a pin, write your comment, and reply or resolve threads inline. Comments follow the canvas when you zoom and pan.
- **Task Vault** — GTD + Bullet Journal + PARA productivity extension. It is a SQLite-backed vault with daily logs, inbox, projects, areas, and someday list. Global quick-capture hotkey: `Cmd+Shift+Space`. **Recurring tasks** — set daily, weekly, biweekly or monthly recurrence on any task. The engine ensures that exactly one future open instance exists at all times (idempotent, UNIQUE INDEX-enforced). Vault items and terminal sessions link to each other in both directions. **Context filter** button is always visible in the toolbar. Click it to open a multiselect dropdown that filters all views by one or more `+context` tags. Toolbar action buttons are right-aligned. **Task detail panel** — click any task (daily log) to open a right-side panel with markdown-capable Description, Acceptance Criteria, and Dev Hints fields (stored in task metadata). **Ghost subtask row** — a faint `· + Add subtask…` row at the bottom of each open task's subtask list expands into an inline input on click.
- **View menu** — Toggle Sidebar and Open Settings (`Cmd+,`) are in the core View menu. Extensions add more items: the git-integration extension adds Code Reviews in New Window.
- **Split panes** — Split the current terminal vertically (`Cmd+D`, side by side) or horizontally (`Cmd+Shift+D`, top/bottom). Splits are recursive: you can split each pane further. Drag the divider bar to resize. Click a pane to focus it; keyboard input goes to the focused pane. `Cmd+W` closes the focused pane (collapsing the split), or the active tab when not in split mode. Each pane shows a blue focus border.
- **Notification center** — The bell icon in the tab bar opens a panel that lists all in-app notifications (toasts, extension events). An unread count badge sits on the bell. You can dismiss each notification (×), "Mark all read," and "Clear all." ESC or a click on the backdrop closes the panel. Extensions create persistent notifications with action buttons through `api.notifications.createNotification({ type, title, message, key, actions })`. Action callbacks run in the extension's backend, in the extension host. Every toast also appears in the center, so nothing is lost after auto-dismiss.
- **Activity indicators** — A spinning indicator shows on workspace tiles, project cards, and session tabs while a terminal runs a command or produces output (1.5 s idle debounce). An alert badge (red dot + count) shows next to the spinner for sessions awaiting input. A terminal bell fires an OS-level system notification and a Dock bounce.
- **Open in your editor** — Right-click a branch to open its working copy in your editor, or a repo header to open the repo. Terminator detects Cursor, VS Code, Windsurf, Zed, Sublime Text, WebStorm, IntelliJ or Xcode. It prefers one with a CLI launcher, so the folder opens in a window you already have. `ui.editor` pins a specific editor. The renderer sends only a folder. The command comes from a fixed list in the main process and is launched with `execFile`, not a shell, so a directory name can never become a second command.

- **Home, Tasks** — The app opens on Home: what needs you, then your tasks, on one screen. A **task** is one piece of work and can span repos (`rate-limits` in three repos is one row). Start one with **Start work → Across repos**, or put existing work in one with **Add to task…**. Every task has one of five states (needs you, running, waiting on others, quiet, done), each from a fact Terminator can see. A guessed ask is drawn hollow. **Mark done** and **Archive** are yours; nothing moves by a timer. `Cmd+J` switches task, the sidebar can group by task, and Overview can band tiles by task. **Settings → Home layout → Classic** keeps the earlier Desk. The **Needs you** queue lists everything waiting on you, from Terminator and from extensions: an agent's question, an agent that finished while you were away, a failing check, a review you owe, a Foundry decision, a due task. It lists the oldest and hottest first, and you answer in place. Open an ask to read the agent's last screen. Press `1`–`9` for a numbered answer, `R` to reply in your own words, `E` for done, `H` to snooze. The Home tab counts the asks. A task row opens a drawer with a written summary, its lanes, its agents and their token use, its pull request and a timeline. **Plan today** is a sheet (`P`), and starred tasks are today's focus. **Search** (`Cmd+K`) filters both lists. **Start work** (`Cmd+N`) starts a ticket, a prompt, a branch or a scratch terminal. It starts them as an agent in an agent tab (any ACP agent, set in **Settings → Agents**), Claude in a terminal, a plain terminal or a Foundry order. **Insights** is the second view. Its cards are titled by the question they answer: how much shipped, how long from start to merge, how long agents wait on you, where the time went. Token cost is read from the agents' own transcripts. Terminator reads agent questions and turns from Claude Code's `Notification`, `UserPromptSubmit` and `Stop` hooks, which it adds to your `~/.claude/settings.json`. While Home shows, the branch tree is hidden. `Cmd+B` brings it back for that visit. **Hide the branch tree on Home** in Settings turns this off. Extensions send Home plain data through `api.home` and core draws it (ADR 117). A view an extension adds to Insights is `contributes.insightsSection`. A session with no ticket asks **What is this session doing?** from its tab. **Link** pins a Linear ticket to one session, over whatever its branch is linked to. Opening a session from anywhere, including a notification, puts the cursor in its terminal.
- **Resume a Claude Code conversation** — When an agent session ends, the conversation it held does not. A **Resume** button in a work thread's drawer on Home, or on the session's Overview tile, opens a terminal on the same branch and in the same folder. If the conversation ran in an agent tab, the button opens an agent tab. The conversation carries on where it left off, and takes over that session's description and ticket link. Conversations from before a restart wait with their Resume button. Terminator resumes nothing for you, because a restart must not start several agents unasked. A conversation whose transcript has gone says so, and shows no button that would fail. Terminator learns which conversation is in which terminal by adding one `SessionStart` entry to your own `~/.claude/settings.json`. The [user guide](docs/user-guide/USER-GUIDE.md#picking-a-claude-code-conversation-back-up) says how to remove it.
- **Monitor wall** — The Overview tab (`Cmd+Shift+E`) shows every open terminal as a live tile large enough to read. Each tile is named by repo and branch and footed with its ticket or description. Sessions waiting on you are pinned double-width in a **Needs you** band at the top. When an agent shows a numbered choice (Claude Code's permission prompts, for example), its options become buttons on the tile. A press re-reads the screen and types the number only if the same question is still there. Terminator remembers tile size (S/M/L), pinning and the order of the rest. Previews fill their tile's width and follow the cursor. On a very wide terminal, Large tiles are the readable size.
- **Global metrics bar** — Optional CPU / Memory / Network bar pinned to the bottom of every screen. Enable it in Settings → Interface → "Show CPU / Memory / Network bar".
- **Scratch sessions** — Create a terminal instantly without first selecting a workspace or project. Click the `~` button in the workspace rail or press `Cmd+Shift+T`. Scratch sessions appear in a dedicated sidebar section beneath the branch list. A scratch terminal belongs to no branch, so it is the one terminal that is still a sidebar row. Move any scratch (or regular) session to an existing project, or create a new one, by right-clicking its tab and choosing "Move to project…".

- **Tab reordering** — Drag session tabs left or right within the tab bar to reorder them. The order persists for the lifetime of the app session.

- **About** — Show app version and runtime details (Electron, Node, Chrome, platform) with **Help → About Terminator** (or the **Terminator** app menu on macOS).

- **Remote Control** — Enable a local HTTP/WebSocket server (default port 7681) and optionally an ngrok tunnel to access your Terminator terminals from any browser. The server checks the password once at login and keeps it only as a scrypt hash. The browser then holds a session cookie, so the browser never stores the password, never sends it again, and the QR code never carries it (the QR code carries the address only). Configure it in the Remote Control tab: toggle on/off, choose the port, copy the public URL or LAN URL, and set or generate the password (a generated password is shown once). The public tunnel requires `ngrok` (`brew install ngrok`). **Mobile browser support** — when you log in on a phone (viewport < 768 px), the server redirects you to a purpose-built mobile UI at `/mobile/`. It has a scrollable workspace/terminal list, a full-screen xterm.js terminal view with a control-key toolbar (Ctrl+C, Ctrl+D, Tab, Esc, ↑, ↓), and automatic reconnect through the Page Visibility API (3 attempts × 2 s). Tested on iOS 16+ / Android 12+ (Chrome). Desktop and tablet (≥ 768 px) keep using the full Electron renderer through `/app/`. Extension views work there only for the channels an extension has declared remote-accessible. Every other extension channel (Task Vault's SQL console, Notepad's file import and export, the repository and Foundry channels) stays local to the desktop app.

- **Clickable terminal links** — URLs and file paths in terminal output are underlined on hover. `Cmd+click` a URL to open it in the system browser. `Cmd+click` an absolute path (for example `/Users/foo/bar.ts` or `~/project/file.go`) to open it with the default application. Terminator strips line:col suffixes such as `file.go:42:5` before opening. All links throughout the app (PR comments, CI check links, issue refs) always open in the system browser.

- **Keyboard shortcuts** — `Cmd+B` (toggle sidebar), `Cmd+1–9` (switch workspace + expand it), `Cmd++/-` (cycle workspaces), `Cmd+T` (new tab), `Cmd+Shift+T` (new scratch terminal), `Cmd+Shift+H` (Home), ``Cmd+` `` (next window, e.g. a pop-out), `Cmd+W` (close focused pane / active tab), `Cmd+D` (split pane vertically), `Cmd+Shift+D` (split pane horizontally), `Cmd+Left/Right` (cycle tabs), `Cmd+K` (clear terminal), `Cmd+P` (quick actions), `Cmd+,` (settings), `Cmd+Shift+E` (toggle Overview), `Cmd+~` (open Home), `Esc Esc` (leave any extension and return to the last terminal session), `Cmd+Enter` (send newline to running program — always intercepted), `Shift+Enter` (send newline — active only when the running program has enabled bracketed paste mode, for example the `claude` CLI; passes through normally in a plain shell).

### Foundry on any repository

Foundry assumes no toolchain. For each check (test, lint, format, coverage, e2e, build), plus a prepare command and extra checks, it takes the first of these that answers: **your word** (set on the Forge's **Checks** step), the repository's own `.foundry/profile.yaml`, what the scout read from the README and proved, then the shipped **hints** (`extensions/foundry/hints/*.yaml`, one per ecosystem). Foundry assumes the base branch passes and runs nothing on it on its own (ADR 137). It reports a check with no command as **not measured**, never as passed. A check runs once in the final check and its result stands: a check that fails is a failure, and Foundry never reruns it to see whether it passes.

A repository can carry `.foundry/profile.yaml`. Every field is optional:

```yaml
schemaVersion: 1
prepare: { command: ./glyph fetch, source: repository }
share: [vendor]
checks:
  test: { command: ./glyph test, source: repository }
  lint: { command: ./glyph lint, source: repository }
additional:
  - { name: Type check, command: ./glyph check, rung: L0, source: repository }
paths:
  interface: [src/ui]
  manifests: [glyph.toml]
```

## Tech Stack

| Layer                  | Technology                                  |
| ---------------------- | ------------------------------------------- |
| Framework              | Electron 44.x                               |
| Extension backends     | Electron `utilityProcess` (extension host)  |
| Language               | TypeScript 5.x (strict)                     |
| UI                     | React 18.x + Zustand + Lucide React (icons) |
| Terminal rendering     | @xterm/xterm 6.x + @xterm/addon-fit         |
| PTY management         | node-pty 1.x (main process only)            |
| Persistence            | electron-store 8.x                          |
| Application database   | `node:sqlite` (SQLite, built into Node 24)  |
| Schema validation      | Zod 3.x                                     |
| Remote server          | Fastify 5.x + @fastify/websocket 11.x       |
| Browser SPA            | @xterm/xterm 6.x + @xterm/addon-fit         |
| Password hashing       | Node `crypto.scrypt` (random salt)          |
| Build                  | electron-vite 5.x + vite 7.x (remote SPA)   |
| Unit/integration tests | Vitest 4.x                                  |
| E2E tests              | Playwright 1.x                              |
| Design system          | `@terminator/extension-ui` + Storybook      |
| Fonts                  | IBM Plex Sans and Mono (@fontsource)        |

Exact versions are in `package.json` (one version per package across the repository, [ADR-097](docs/adr/097-one-version-per-dependency.md)). Each extension declares its own dependencies in its own `package.json`: CodeMirror and Excalidraw in notepad, Fastify in remote-control, web-tree-sitter in git-integration.

## Documentation

- **[User Guide](docs/user-guide/USER-GUIDE.md)** — End-to-end walkthrough of every feature and extension, with screenshots.
- **[Architecture](docs/ARCHITECTURE.md)** — Process model, IPC, extension system deep-dive.
- **[Extension Development Guide](docs/EXTENSION-DEVELOPMENT.md)** — Building extensions with the Extension SDK.
- **[Contributing](docs/CONTRIBUTING.md)** — Development setup, conventions, PR process.

## Prerequisites

- **Node.js 24.21.0**, the version in `.nvmrc` and the one Electron 44 ships. Use [nvm](https://github.com/nvm-sh/nvm) (`nvm use`).
- **Python setuptools** — node-pty's native compilation requires it. On macOS with Python 3.12+:
  ```bash
  pip3 install setuptools --break-system-packages
  ```
- **git** — The git integration extension requires it. Terminator assumes it is on your PATH.
- **gh CLI** (optional) — GitHub PR creation and the Code Reviews tab require it. [Install gh](https://cli.github.com/). Authenticate with `gh auth login`.
- macOS 13+ (primary), Windows 11, Ubuntu 22.04 LTS.

## Quick Start

```bash
git clone <repo-url>
cd terminator

# Install dependencies (all versions pinned)
# node-pty is NAPI-based (ABI-stable), so no per-Electron rebuild step is needed.
npm install

# Start in development mode (hot-reload via electron-vite)
npm run dev
```

## Installing the Packaged App (macOS)

Download the `.dmg` from the [latest release](https://github.com/andytavares/terminator/releases/latest), mount it, and drag Terminator to your Applications folder.

The app is signed and notarized, so it opens normally.

After that, the app updates itself. It checks for a new release at launch and every four hours, downloads it, and installs it the next time you quit. Keep the app in Applications: an app run from the DMG or from Downloads cannot update. **Terminator → Check for Updates…** checks at once and shows the result in a dialog.

## Available Scripts

| Script                           | Description                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`                    | Build extensions + remote SPA, then development mode with hot reload             |
| `npm run build`                  | Build extensions + remote SPA + production build                                 |
| `npm run package`                | Production build packaged as a macOS arm64 app (electron-builder)                |
| `npm run build:extensions`       | Build every extension: backend → `src/index.js` (esbuild), view → `dist/` (Vite) |
| `npm run build:remote`           | Build the browser remote-control SPA → `out/renderer-remote/`                    |
| `npm run preview`                | Preview the production build                                                     |
| `npm test`                       | Unit + integration tests (Vitest) with coverage                                  |
| `npm run test:watch`             | Tests in watch mode                                                              |
| `npm run test:coverage`          | Tests with V8 coverage and a JUnit report                                        |
| `npm run test:live`              | Tests against real services (`vitest.live.config.ts`)                            |
| `npm run test:e2e`               | E2E tests (Playwright, launches Electron)                                        |
| `npm run storybook`              | The design system's Storybook                                                    |
| `npm run test:stories`           | The design system's stories run as tests                                         |
| `npm run test:visual`            | The design system's screenshot tests (Playwright)                                |
| `npm run lint`                   | ESLint                                                                           |
| `npm run lint:deps`              | syncpack: one exact version per dependency                                       |
| `npm run lint:unused`            | knip: no unused files, exports or dependencies                                   |
| `npm run lint:unused:production` | knip --production: no code that only tests reach                                 |
| `npm run lint:duplicates`        | jscpd: no copy-pasted code                                                       |
| `npm run typecheck`              | TypeScript check of the core, packages and extensions, specs included (no emit)  |
| `npm run format`                 | Prettier format                                                                  |
| `npm run format:check`           | Check formatting without writing files (CI)                                      |
| `npm run create-extension`       | Scaffold a new extension                                                         |

## Project Structure

```
src/
├── main/                     # Electron main process
│   ├── index.ts              # Entry point: window, menu, startup, lifecycle
│   ├── ipc/                  # IPC handlers, one invoke table per domain
│   ├── terminal/             # PtyManager, output batching and flow control
│   ├── extensions/           # ExtensionHost, the Extension API, extension views
│   │   └── host/             # The extension host process (utilityProcess)
│   ├── db/                   # app.sqlite (node:sqlite)
│   └── storage/              # electron-store files (workspaces, settings)
├── renderer/                 # Desktop UI: React, Zustand stores, sidebar view model
├── renderer-remote/          # Browser login page and phone client for Remote Control
└── shared/                   # electron-api manifest, zod schemas, shared types

packages/
├── extension-sdk/            # @terminator/extension-sdk: the Extension API
└── extension-ui/             # @terminator/extension-ui: the design system + Storybook

extensions/
├── foundry/                  # The software factory: Forge, Line, ledger
├── git-integration/          # Git status, pull requests, Code Reviews, MergeFlow
├── notepad/                  # Markdown notes and diagrams
├── remote-control/           # Browser and phone access over LAN or ngrok
└── task-vault/               # GTD+BuJo+PARA productivity vault

tests/                        # Core tests: unit/, integration/, e2e/ (Playwright)
extensions/*/tests/           # Each extension's own tests

docs/
├── ARCHITECTURE.md           # How the app is built
├── CONTRIBUTING.md           # Development setup, conventions, PR process
├── EXTENSION-DEVELOPMENT.md  # Building an extension
├── EXTENSION-STYLE.md        # UI rules for extensions
└── adr/                      # Architectural Decision Records

```

## Architecture Overview

- **Main process** owns the windows, terminal processes (`node-pty`), the core's settings files and the app database, and answers IPC.
- **Extension host**, an Electron `utilityProcess`, runs every extension backend, so extension work never shares the event loop that relays terminal output.
- **Renderers** (`contextIsolation: true`, `nodeIntegration: false`): the main window runs React + xterm.js and calls `window.electronAPI.*` (exposed by `preload.ts`); each extension view is its own `WebContentsView`.
- **Shared layer** (`src/shared/`) declares `window.electronAPI` once and holds the zod schemas every IPC payload is parsed with.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full breakdown.

## Developing an Extension

An extension is a directory under `extensions/` with a `manifest.json`, a backend that exports `activate(api)`, and optionally a view. It imports only `@terminator/extension-sdk`, `@terminator/extension-ui` and its own npm packages.

```bash
npm run create-extension -- my-extension
```

The built-in extensions in `extensions/` are the working examples, and `tests/fixtures/sample-extension/` is a minimal one. See [docs/EXTENSION-DEVELOPMENT.md](docs/EXTENSION-DEVELOPMENT.md) for the full guide.

## Key Design Decisions

| Decision                                              | Record                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| PTY processes live in main process only               | [ADR-001](docs/adr/001-pty-in-main-process.md)                              |
| electron-store for persistence                        | [ADR-003](docs/adr/003-electron-store-for-persistence.md)                   |
| xterm.js instances are never destroyed on tab switch  | [ADR-004](docs/adr/004-xterm-instances-persist-on-tab-switch.md)            |
| Native fs.watch instead of chokidar                   | [ADR-005](docs/adr/005-native-fswatcher-over-chokidar.md)                   |
| Sandboxed shell execution for extensions              | [ADR-006](docs/adr/006-sandboxed-shell-exec-for-extensions.md)              |
| Bundled-first extension distribution (no marketplace) | [ADR-007](docs/adr/007-bundled-first-extension-distribution.md)             |
| Extensions compile to CommonJS with esbuild           | [ADR-008](docs/adr/008-extension-commonjs-compilation.md)                   |
| `gh` CLI for all GitHub PR review operations          | [ADR-009](docs/adr/009-gh-cli-for-review-ops.md)                            |
| Heuristic file ordering for code review (v1)          | [ADR-010](docs/adr/010-heuristic-file-ordering-v1.md)                       |
| Sanitised HTML in PR comments                         | [ADR-091](docs/adr/091-sanitised-html-in-pr-comments.md)                    |
| The Inbox is a band on the Forge                      | [ADR-092](docs/adr/092-the-inbox-is-a-band-on-the-forge.md)                 |
| Stay on Electron and TypeScript                       | [ADR-093](docs/adr/093-stay-on-electron-and-typescript.md)                  |
| Extensions follow the VS Code model (extension host)  | [ADR-094](docs/adr/094-extensions-follow-the-vs-code-model.md)              |
| Coverage is gated by Codecov                          | [ADR-095](docs/adr/095-coverage-is-gated-by-codecov.md)                     |
| Every IPC channel has a schema                        | [ADR-096](docs/adr/096-every-ipc-channel-has-a-schema.md)                   |
| One version per dependency                            | [ADR-097](docs/adr/097-one-version-per-dependency.md)                       |
| One design system, documented in Storybook            | [ADR-098](docs/adr/098-one-design-system-documented-in-storybook.md)        |
| `node:sqlite` replaces PGlite                         | [ADR-099](docs/adr/099-node-sqlite-replaces-pglite.md)                      |
| Remote Control credentials                            | [ADR-100](docs/adr/100-remote-control-credentials.md)                       |
| No native terminal daemon                             | [ADR-101](docs/adr/101-no-terminal-daemon.md)                               |
| Extension shell commands run only in declared roots   | [ADR-102](docs/adr/102-shell-exec-runs-in-declared-roots.md)                |
| Each extension has its own data folder                | [ADR-103](docs/adr/103-each-extension-has-its-own-data-folder.md)           |
| Unused code is a CI gate (knip)                       | [ADR-104](docs/adr/104-unused-code-is-a-ci-gate.md)                         |
| Duplicate code is a CI gate (jscpd)                   | [ADR-105](docs/adr/105-duplicate-code-is-a-ci-gate.md)                      |
| TypeScript 6.0.3 until typescript-eslint supports 7   | [ADR-106](docs/adr/106-typescript-6-until-the-lint-toolchain-supports-7.md) |
| Temporal in extension backends, not in views          | [ADR-108](docs/adr/108-temporal-in-extension-backends-not-in-views.md)      |
| A file watch belongs to the view that asked           | [ADR-109](docs/adr/109-a-file-watch-belongs-to-the-view-that-asked.md)      |
| Modal surfaces use the native dialog element          | [ADR-110](docs/adr/110-modal-surfaces-use-the-native-dialog-element.md)     |

## Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## License

Private — all rights reserved.
