# ADR 034: A branch is named by its branch

**Status**: Accepted

**Date**: 2026-08-30

**Supersedes**: the naming half of `032-branch-vocabulary-ui-only`

## Context

ADR 032 renamed the "project" to a **branch** in every string a user reads. It did not change what a branch is _called_. `Project.name` stayed a free-text field. The create dialog prefilled it, a Rename item on the header context menu edited it, and the issue's title set it when the user created a branch from a ticket.

That left one thing with two names. `branch-display.ts` reconciled them. It led with the stored name and demoted the branch to secondary text beside it:

```
TAV-14 Make all text red   andrew/tav-14-make-text-red
```

Two problems followed.

The first problem: neither name is reliably the answer to the question the header is asked. An operator who looks at a branch card wants to know what the terminal inside it will run against. That is the branch, and only the branch. A label is a claim about the branch, and nothing keeps it true.

The second problem: nothing kept it true in the literal sense either. `useBranchSync` reads `git rev-parse --abbrev-ref HEAD` and writes the answer back to `Project.gitBranch`. It lost its only caller when `030` replaced `ProjectCard` with the flat session list. From then on, a plain checkout's branch was frozen at creation. The only thing that still wrote it was the sidebar's branch switcher, and the team removed that on 2026-08-30 for being a redundant strip. The branch shown was a snapshot from whenever the user made the card, while the operator switched branches in the terminal a few pixels below it.

## Decision

**A branch card is named by the branch it is on.** `branchLabel(project)` returns `project.gitBranch`. Every surface that names a branch goes through it: the group header, a session row's branch badge, the scope menu, the move-session and link-issue dialogs, the removal confirmation, the overview tiles, and the command palette.

Three things follow:

- **There is no second name to enter.** The create dialog's Name field is gone wherever the workspace folder is a repository. The branch chosen or created below it is the name. Creating a branch from an issue prefills the branch (`branchFromIssue`) and nothing else. The team deletes `projectNameFromIssue`.
- **There is no second name to edit.** The app offers Rename only on a project that has no `gitBranch`.
- **`useBranchSync` is wired again**, from `App`, over every non-worktree project. The app fixes a worktree's branch when it creates the worktree and does not poll it.

The hook polls, at five seconds, and only while the window is visible. There is no event to listen to instead. The hook's old `fs.onChanged` subscription was decoration, because nothing in the app calls `fs.watchStart`, so `fs:changed` never fires. `git branch --show-current` reads `.git/HEAD`, which is cheap enough to ask for on a timer.

`Project.name` stays in the stored shape and stays required. A workspace whose folder is not a git repository has projects with no branch at all. There the stored name is the only name there is. That is the one case where the app still reads the field, still asks for it, and still lets the user edit it.

## Consequences

**Good**

- One name per thing, and it is the name git would give you.
- The name is live. `git switch` in a branch's own terminal renames its card, because the card only ever reports `HEAD`.
- The issue link survives the change: a branch created from `TAV-42` shows `andrew/tav-42-unify-linear` and carries the issue badge, which is what the badge is for.

**Bad**

- A long branch name is a long header. `andrew/tav-42-unify-linear-connections` is wider than `TAV-42 Unify Linear connections`, and the header ellipsises it. The branch is what the operator typed, so it is at least their own length. `branchFromIssue` already caps a generated one at 60 characters.
- Existing branch cards with a custom stored name change label on upgrade. No migration runs, because the app simply no longer reads the name. Reverting the code reverses the change, and nothing on disk is lost.

**Neutral**

- Two plain checkouts of the same folder now show the same name, because they are on the same branch. That was always true of the underlying tree. The labels disguised it.
