# Code Review Guide

Published with full-size screenshots: https://claude.ai/artifact/3RW524t3qAKLk61mhLWM4d

A full walkthrough of a review, from the queue to a submitted verdict and back after an interruption, with every screen and control shown.

> Everything tagged `#214` ships in [PR #214](https://github.com/andytavares/terminator/pull/214). Untagged features are on `main` today.

## About the screenshots

Every screenshot is the real Git Integration UI, built from PR #214 (`extensions/git-integration/dist`) and rendered in Chromium with the app's own theme tokens. The data behind it was recorded from the running app against `andytavares/terminator`: PR #68, its five files, diffs, metrics, reading order, insights, checks and comments. Where the recording could not produce a state, sample data was injected. Each caption says which:

- **[Real data]** recorded from GitHub and this repository, unchanged.
- **[Real PR, sample text]** real threads and files; PR #68's own comment text is placeholder ("CommentComment…"), so the words are samples.
- **[Sample data]** a state this account never reached, such as a review request, a finished agent run or a push since your review.

```mermaid
flowchart LR
  A["1 Reviews tab"] --> B["2 Overview + brief"]
  B --> C["3 Read in order"]
  C --> D["4 Comments your way"]
  C --> E["5 Ask the agent"]
  D --> F["6 Drafts and notes"]
  E --> F
  F --> G["7 Submit once"]
  C -. interrupted .-> H["8 Resume + since your review"]
  H -.-> C
```

## STEP 1 · Find what needs you

### Reviews tab `#214`

Open **Reviews** in the app band. It searches GitHub for every open PR that involves you, in every repository. Work down **Needs you**: **Re-review** first (you know the code and only the new commits matter), then **Requested of you**, then **Requested of your team**. The band totals what's waiting, how much is high risk, and the reading time. Rows are sorted closest-to-merging first.

![Reviews dashboard, Needs you tab](code-review-guide/01-dashboard-needs-you.jpg)

**[Sample data]** Each row: repository, title, what changed since you looked, size, risk, estimated minutes and the action. **Re-review** is the primary button. `journal-kb` is not cloned here, so it opens diff-only; because a clone folder is set, **Clone and review** appears beside it. Real PR titles and sizes; their placement in these sections is sample.

![Reviews dashboard, My PRs tab](code-review-guide/02-dashboard-my-prs.jpg)

**[Real data]** **My PRs** labels what blocks each of your own PRs: **CI failing**, **Changes asked**, **Approved** or **Waiting**. **Involved** lists PRs where you are mentioned or have commented.

### Code Reviews tab (one repository)

Hover a workspace header and click the code review icon for one repository's queue: **Needs your review**, **Read these first**, **Quick wins**, **Larger reviews**, with anything in progress pinned on top. Search, **Open only** and **Open more than 3 days** narrow it; **Pop out** opens a separate window.

![Code Reviews queue](code-review-guide/03-code-reviews-queue.jpg)

**[Real data]** The terminator queue as it stands: 53 open PRs, risk in words, estimated minutes, conflicts flagged.

## STEP 2 · Read the brief before the code

Opening a PR shows the overview. Read it top to bottom; it takes a minute and tells you where to spend the next twenty.

![PR overview with review brief](code-review-guide/04-overview-brief.jpg)

**[Real data]** **Header**: author, age, branches, and **Your review requested**. **Status checks** expand to each check. **Approved by**. The **Review brief** `#214`: complexity (branches added per function, tree-sitter), risk (0–100 and what drives it), test coverage (changed functions that no test references), code health, and understandability. Each row names its source on the right.

![PR overview discussion](code-review-guide/05-overview-hotspots-discussion.jpg)

**[Real PR, sample text]** Further down: **Hotspots — focus here first**, **Description**, and the **Discussion** with a composer (`⌘↵` posts). The codecov report is the real bot comment.

![Overview actions for a draft behind main](code-review-guide/29-overview-draft-behind.jpg)

**[Sample data]** A draft that is behind its base shows **Behind main**, **Update from main** and **Mark as Ready**.

![Overview with merge conflicts](code-review-guide/30-overview-conflicts.jpg)

**[Sample data]** A PR that cannot merge shows **Conflicts** and **Resolve conflicts**, which opens MergeFlow.

## STEP 3 · Read in order

Press **Start Review**. Files come definitions first `#214`: a type before the code that uses it, a function before its callers, a test right after what it tests. Each file says why it is where it is.

![Review surface with reading order](code-review-guide/06-review-reading-order.jpg)

**[Real data]** `types.ts` is step 1 of 5 ("Defines Priority · depends on nothing in this PR"), then `utils.ts` (uses BatchItem50 from step 1), `constants.ts`, the hook, and the panel last. The header shows the step, the risk with **Why?**, and the health chips; the warning below the hunk is a complexity hotspot.

![File header with Uses row](code-review-guide/07-review-uses-peek.jpg)

**[Real data]** The **Uses** row `#214` lists every symbol this file uses that the PR defines, and the step you read it in ("BatchItem50 · step 1, not read yet"). **Peek definition** (`g` `d`) jumps there.

![Risk breakdown panel](code-review-guide/08-risk-why.jpg)

**[Real data]** **Why?** opens the risk breakdown: score, change size, churn, blast radius with the importing files, test file, complexity.

![Large PR banner](code-review-guide/31-large-pr-banner.jpg)

**[Sample data]** Past 400 lines a banner estimates the reading time and suggests a split. The list groups files into chapters.

![Guided chapter view](code-review-guide/32-guided-chapters.jpg)

**[Sample data]** **Guided** steps through one chapter at a time, with the chapters as tabs; **All ↗** returns to every file.

![Focus mode](code-review-guide/27-focus-mode.jpg)

**[Real data]** **Focus mode** keeps only medium and high risk files.

![Split diff view](code-review-guide/26-split-view.jpg)

**[Real PR, sample text]** **Split** puts old and new side by side; **Semantic** hides whitespace-only hunks.

![Moved code row and gutter chip](code-review-guide/24-moved-code-and-gutter.jpg)

**[Sample data]** A block moved unchanged collapses to one row `#214`: "Moved · PRIORITY_COLOR · 6 lines, unchanged, from …". **Show** expands it; **Go to origin** opens the other end. The gutter chip on line 18 marks `BatchPanel50` as **untested**: no test references it. A function with a test would show its added branches instead, for example `+5`.

When a file is done, press `v` or **Mark viewed, go to next**. On a chapter's last file the button becomes **Finish chapter ↵**, then **Finish review ↵**.

## STEP 4 · Comments your way `#214`

On a first pass, other people's comments can get in the way. The **Comments** control in the file header, or `c`, switches between three views and is remembered.

![Comments, All](code-review-guide/09-comments-all.jpg)

**[Real PR, sample text]** **All**: every thread. The resolved thread on line 16 is dimmed and says **Resolved**.

![Comments, Unresolved](code-review-guide/10-comments-unresolved.jpg)

**[Real PR, sample text]** **Unresolved**: resolved and outdated threads are gone; the open one on line 23 stays.

![Comments, Hidden](code-review-guide/11-comments-hidden.jpg)

**[Real PR, sample text]** **Hidden**: no threads, just a count in the gutter (lines 16, 23, 39). Click one to bring them back.

## STEP 5 · Ask the agent `#214`

Drag across line numbers. A bar appears under the selection.

![Selection with float bar](code-review-guide/12-selection-bar.jpg)

**[Real data]** Lines 45–62 selected: **Ask agent** `a`, **Explain** `e`, **Add note** `m`, **Comment** `r`. With nothing selected, `a` asks about the current hunk.

![Agent panel, ask](code-review-guide/13-agent-ask.jpg)

**[Real data]** **Ask about lines 45–62**. Pick **Review**, **Explain** or **Ask…**, the model (Sonnet by default, or Opus), then **Run**. The agent reads the PR head in a private worktree with read-only tools: it cannot run commands or post.

![Agent panel, running](code-review-guide/14-agent-running.jpg)

**[Real data]** While it runs: elapsed time, **Cancel**, and **Continue in terminal** to talk to the same session.

![Agent findings inline and in the panel](code-review-guide/15-agent-findings.jpg)

**[Sample data]** Findings arrive in the panel and as dashed **Agent note · private** blocks under their lines, tagged **must-fix**, **suggestion**, **nit** or **question**. Each card: **Post as comment**, **Dismiss**, **Ask follow-up**. They stay on your machine. The findings are samples written against PR #68’s real code; the must-fix one is a real bug in it.

![Agent notes off](code-review-guide/16-agent-notes-off.jpg)

**[Sample data]** **Agent notes: Off** (`⇧C`) folds them into dashed gutter counts.

![Whole-PR agent walkthrough](code-review-guide/25-agent-pr-walkthrough.jpg)

**[Sample data]** **Ask agent about this PR** reviews everything and adds a walkthrough: what each chapter changes, then what it affects.

## STEP 6 · Capture, don't post `#214`

Nothing you write goes to GitHub until you submit. New comments collect as drafts; notes are for you alone.

![Composer prefilled from a finding](code-review-guide/17-post-as-comment.jpg)

**[Sample data]** **Post as comment** on a finding opens the composer prefilled ("edited from agent finding"). Edit it, then **Add to pending review**. Replies to existing threads still post immediately.

![Private note and drafts bar](code-review-guide/18-note-and-draft.jpg)

**[Sample data]** A **Private note** under line 23. A note with `??` is a question the resume card offers to send to the agent. The drafts bar at the bottom counts what will go out.

## STEP 7 · Submit once

![Submit bar](code-review-guide/19-submit-bar.jpg)

**[Sample data]** The bar `#214` counts drafts and how many came from agent findings. **Review drafts** jumps to the first. Choose **Comment**, **Approve** or **Request changes**; **Submit review** (`⌘↵`) sends the verdict and every draft as one review, so the author gets one notification.

![Submit review dialog](code-review-guide/20-submit-dialog.jpg)

**[Real data]** **Submit review** in the bottom bar opens the dialog with an optional summary. On your own PR, as here, GitHub only lets you comment.

## STEP 8 · Come back later `#214`

Leave whenever you're interrupted; **Pause review** or just close it. Position, viewed files, notes and drafts are saved per PR, and viewed marks are mirrored to GitHub.

![Resume card](code-review-guide/22-resume-card.jpg)

**[Sample data]** **Where you left off** appears after 15 minutes away: your last file, notes (with the question and **Ask agent**), unread agent findings, unsent drafts, and pushes since. **Continue** dismisses it.

![Since your review](code-review-guide/23-since-your-review.jpg)

**[Sample data]** **3 commits since you last looked · 3 files changed · 2 still viewed**. Files you viewed that did not change stay viewed; changed ones say **changed**, and one added since is a **new file**. **Changed since you viewed** opens only what changed since your review ("Showing a1b2c3d4 … head"); **Since my review** / **Whole PR** (`s`) switches. After a force-push it reads **History rewritten**.

## Keyboard `#214`

![Keyboard sheet](code-review-guide/21-keyboard.jpg)

**[Real data]** `?` opens this sheet. Keys are ignored while typing; Escape is left alone because a double Escape leaves the extension.

| Key     | Action                     | Key     | Action                         |
| ------- | -------------------------- | ------- | ------------------------------ |
| `j` `k` | Next / previous hunk       | `a`     | Ask agent on selection or hunk |
| `]` `[` | Next / previous file       | `e`     | Explain selection              |
| `n`     | Next unviewed file         | `r`     | Comment on line                |
| `v`     | Mark file viewed           | `m`     | Private note                   |
| `s`     | Since my review / whole PR | `g` `d` | Peek definition                |
| `c`     | Cycle comments             | `t`     | Hide file list                 |
| `⇧C`    | Agent notes on / off       | `i`     | Back to the overview           |
| `?`     | This sheet                 | `⌘↵`    | Submit review                  |

![Light theme](code-review-guide/28-light-theme.jpg)

**[Real PR, sample text]** Everything follows the app theme; this is the light theme.

## Settings

Settings › Git Integration.

| Setting                         | Default   | What it does                                                              |
| ------------------------------- | --------- | ------------------------------------------------------------------------- |
| gh CLI path                     | empty     | Path to `gh`; empty auto-detects.                                         |
| GitHub token                    | empty     | Used as `GH_TOKEN` when set; otherwise `gh`'s own login.                  |
| Clone folder for reviews `#214` | empty     | Where **Clone and review** puts repositories. Empty keeps them diff-only. |
| Review agent model `#214`       | sonnet    | Default model; each run can switch.                                       |
| Review agent effort `#214`      | empty     | Passed as `--effort` when set.                                            |
| Review agent timeout `#214`     | 5 minutes | A run past this is stopped and marked failed.                             |

## Not yet verified

- No agent run against a real `claude` was captured; the running and findings states were fed through the panel's event channel. The spawn, read-only flags and worktree are covered by `extensions/git-integration/tests/unit/review-agent*.spec.ts` and `worktree.spec.ts`, which runs real git.
- This account has no review requests, so **Needs you** is shown with real PRs in sample sections. Grouping is covered by `ReviewDashboard.spec.tsx` and `dashboard-search.spec.ts`.
- That a team review request appears under **Requested of your team** (query `team-review-requested-user:<login>`) has not been observed.
- Screenshots come from the built renderer in Chromium, not the Electron window; the live app was checked separately for the dashboard, overview, reading order, selection bar, agent panel and key sheet.
