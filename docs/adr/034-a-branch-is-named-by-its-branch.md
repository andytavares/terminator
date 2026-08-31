# ADR 034: A branch is named by its branch

**Status**: Accepted

**Date**: 2026-08-30

**Supersedes**: the naming half of `032-branch-vocabulary-ui-only`

## Context

ADR 032 renamed the "project" to a **branch** in every string a user reads. It did not change what a branch is _called_: `Project.name` stayed a free-text field, prefilled by the create dialog, editable through a Rename item on the header context menu, and set from an issue's title when a branch was created from a ticket.

That left one thing carrying two names. `branch-display.ts` reconciled them by leading with the stored name and demoting the branch to secondary text beside it:

```
TAV-14 Make all text red   andrew/tav-14-make-text-red
```

Two problems followed.

The first is that neither name is reliably the answer to the question the header is asked. An operator looking at a branch card wants to know what the terminal inside it will run against. That is the branch, and only the branch. A label is a claim about the branch that nothing keeps true.

The second is that nothing kept it true in the literal sense either. `useBranchSync` — the hook that reads `git rev-parse --abbrev-ref HEAD` and writes the answer back to `Project.gitBranch` — lost its only caller when `030` replaced `ProjectCard` with the flat session list. From then on a plain checkout's branch was frozen at creation, and the only thing still writing it was the sidebar's branch switcher, which was removed on 2026-08-30 for being a redundant strip. So the branch shown was a snapshot from whenever the card was made, while the operator switched branches in the terminal a few pixels below it.

## Decision

**A branch card is named by the branch it is on.** `branchLabel(project)` returns `project.gitBranch`, and every surface that names a branch goes through it: the group header, a session row's branch badge, the scope menu, the move-session and link-issue dialogs, the removal confirmation, the overview tiles, and the command palette.

Three things follow from that:

- **There is no second name to enter.** The create dialog's Name field is gone wherever the workspace folder is a repository; the branch chosen or created below it is the name. Creating a branch from an issue prefills the branch (`branchFromIssue`) and nothing else — `projectNameFromIssue` is deleted.
- **There is no second name to edit.** Rename is offered only on a project that has no `gitBranch`.
- **`useBranchSync` is wired again**, from `App`, over every non-worktree project. A worktree's branch is fixed when it is created and is not polled.

It polls, at five seconds, and only while the window is visible. There is no event to listen to instead: the hook's old `fs.onChanged` subscription was decoration, because nothing in the app calls `fs.watchStart`, so `fs:changed` never fires. `git branch --show-current` reads `.git/HEAD`, which is cheap enough to ask for on a timer.

`Project.name` stays in the stored shape and stays required. A workspace whose folder is not a git repository has projects with no branch at all, and there the stored name is the only name there is — that is the one case where the field is still read, still asked for, and still editable.

## Consequences

**Good**

- One name per thing, and it is the name git would give you.
- The name is live. `git switch` in a branch's own terminal renames its card, because the card is only ever reporting `HEAD`.
- The issue link survives the change: a branch created from `TAV-42` shows `andrew/tav-42-unify-linear` and carries the issue badge, which is what the badge is for.

**Bad**

- A long branch name is a long header. `andrew/tav-42-unify-linear-connections` is wider than `TAV-42 Unify Linear connections` and the header ellipsises it. The branch is what the operator typed, so it is at least their own length; `branchFromIssue` already caps a generated one at 60 characters.
- Existing branch cards with a custom stored name change label on upgrade. No migration runs — the name is simply no longer read — so the change is reversible by reverting the code, and nothing on disk is lost.

**Neutral**

- Two plain checkouts of the same folder now show the same name, because they are on the same branch. That was always true of the underlying tree; the labels were what disguised it.
