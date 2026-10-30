---
name: "speckit-taskstoissues"
description: "Convert existing tasks into actionable, dependency-ordered GitHub issues for the feature based on available design artifacts."
argument-hint: "Optional filter or label for GitHub issues"
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "github-spec-kit"
  source: "templates/commands/taskstoissues.md"
user-invocable: true
disable-model-invocation: false
---


## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before you continue (if not empty).

## Pre-Execution Checks

**Check for extension hooks (before tasks-to-issues conversion)**:
- Check if `.specify/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.before_taskstoissues` key
- If the YAML cannot be parsed or is invalid, skip hook checking silently and continue
- Filter out hooks where `enabled` is explicitly `false`. Treat hooks without an `enabled` field as enabled by default.
- For each remaining hook, do **not** interpret or evaluate hook `condition` expressions:
  - If the hook has no `condition` field, or it is null/empty, treat the hook as executable
  - If the hook defines a non-empty `condition`, skip the hook and leave condition evaluation to the HookExecutor implementation
- To build a command invocation from a hook command name, replace dots (`.`) with hyphens (`-`). For example, `speckit.git.commit` → `/speckit-git-commit`.
- For each executable hook, output the block that matches its `optional` flag:
  - **Optional hook** (`optional: true`):
    ```
    ## Extension Hooks

    **Optional Pre-Hook**: {extension}
    Command: `/{command}`
    Description: {description}

    Prompt: {prompt}
    To execute: `/{command}`
    ```
  - **Mandatory hook** (`optional: false`):
    ```
    ## Extension Hooks

    **Automatic Pre-Hook**: {extension}
    Executing: `/{command}`
    EXECUTE_COMMAND: {command}

    Wait for the result of the hook command before proceeding to the Outline.
    ```
    After you output the block above, you MUST invoke the hook and wait for it to finish before you continue. Run it the way you run any command in this agent session. The invocation can differ from the `{command}` id shown above (for example, a skills-mode agent runs it as `/skill:speckit-...` or `$speckit-...`). The block alone does not run the hook.
- If no hooks are registered or `.specify/extensions.yml` does not exist, skip silently

## Outline

1. Run `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks` from repo root and parse FEATURE_DIR and AVAILABLE_DOCS list. All paths must be absolute. For single quotes in args like "I'm Groot", use escape syntax: for example 'I'\''m Groot' (or double-quote if possible: "I'm Groot").
1. **IF EXISTS**: Load `.specify/memory/constitution.md` for project principles and governance constraints.
1. From the script output, extract the path to **tasks**.
1. Get the Git remote. Run:

```bash
git config --get remote.origin.url
```

> [!CAUTION]
> ONLY PROCEED TO NEXT STEPS IF THE REMOTE IS A GITHUB URL

1. **Fetch existing issues for deduplication**: Before you create anything, build the set of task IDs you will process from `tasks.md`. Each ID is a `T` followed by **at least** three digits, for example `T001`. `/speckit-converge` assigns new IDs with `T{M+1:03d}`, which is a floor, not a cap. When a file has more than 999 tasks, the IDs have four digits or more. Then use the `list_issues` tool of the GitHub MCP server to find issues that already cover those IDs. Do not pass a `state` value: without it, the tool returns both open and closed issues. Request `perPage: 100` to keep the number of calls low. The tool uses cursor-based pagination, so request each page with the `after` parameter (use the `endCursor` from the previous response). Match each issue title against the task ID pattern `\bT\d{3,}\b`. The `{3,}` accepts IDs with four digits or more. With `\d{3}`, a title that contains `T1000` does not match, because the trailing `\b` cannot fall between two digits. That task is then neither deduplicated nor created. Word boundaries still stop a token like `ST001` from matching. They also force the match to take the whole digit run, so `T100` can never match inside `T1000`. The pattern also recognizes titles written as `T001 ...`, `T001: ...` or `[T001] ...`. When a title matches one of your task IDs, mark that ID as already having an issue. Stop paginating when every task ID has a match, or when no more pages exist. Then you do not fetch the whole issue history of the repository once all task IDs are accounted for. This limits the number of calls on repos with large issue histories. It still prevents duplicates when the command is re-run after `tasks.md` is regenerated or the skill is invoked again.
1. For each task in the list, use the GitHub MCP server to create a new issue in the repository that the Git remote points to. Task lines in `tasks.md` start with a markdown checkbox. First strip the leading `- [ ]` (and any `[P]` or `[US#]` markers) to get the task ID and its description. Create the issue with one canonical title of the form `T001: <description>`: write the ID once, then the task description (for example, the line `- [ ] T001 Create project structure` becomes the title `T001: Create project structure`).
   - **Skip** each task whose ID is in the set of existing issues from the previous step, and report it (for example, `T001 already has an issue, skipping`).
   - Create issues only for tasks that have no matching issue.

> [!CAUTION]
> UNDER NO CIRCUMSTANCES EVER CREATE ISSUES IN REPOSITORIES THAT DO NOT MATCH THE REMOTE URL

## Post-Execution Checks

**Check for extension hooks (after tasks-to-issues conversion)**:
Check if `.specify/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.after_taskstoissues` key
- If the YAML cannot be parsed or is invalid, skip hook checking silently and continue
- Filter out hooks where `enabled` is explicitly `false`. Treat hooks without an `enabled` field as enabled by default.
- For each remaining hook, do **not** interpret or evaluate hook `condition` expressions:
  - If the hook has no `condition` field, or it is null/empty, treat the hook as executable
  - If the hook defines a non-empty `condition`, skip the hook and leave condition evaluation to the HookExecutor implementation
- To build a command invocation from a hook command name, replace dots (`.`) with hyphens (`-`). For example, `speckit.git.commit` → `/speckit-git-commit`.
- For each executable hook, output the block that matches its `optional` flag:
  - **Optional hook** (`optional: true`):
    ```
    ## Extension Hooks

    **Optional Hook**: {extension}
    Command: `/{command}`
    Description: {description}

    Prompt: {prompt}
    To execute: `/{command}`
    ```
  - **Mandatory hook** (`optional: false`):
    ```
    ## Extension Hooks

    **Automatic Hook**: {extension}
    Executing: `/{command}`
    EXECUTE_COMMAND: {command}
    ```
    After you output the block above, you MUST invoke the hook and wait for it to finish before you continue. Run it the way you run any command in this agent session. The invocation can differ from the `{command}` id shown above (for example, a skills-mode agent runs it as `/skill:speckit-...` or `$speckit-...`). The block alone does not run the hook.
- If no hooks are registered or `.specify/extensions.yml` does not exist, skip silently
