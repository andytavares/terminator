---
name: speckit-git-feature
description: Create a feature branch with sequential or timestamp numbering
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: github-spec-kit
  source: extension:git
user-invocable: true
disable-model-invocation: false
---

# Git Feature Skill

# Create Feature Branch

Create and switch to a new git feature branch for the given specification. This command creates **the branch only**. The core `/speckit.specify` workflow creates the spec directory and files.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before you continue (if not empty).

## Environment Variable Override

If the user gave `GIT_BRANCH_NAME` (for example as an environment variable, an argument, or in the request), set the `GIT_BRANCH_NAME` environment variable before you run the script. When `GIT_BRANCH_NAME` is set:

- The script uses the value as the branch name and skips all prefix and suffix generation
- `--short-name`, `--number`, and `--timestamp` flags have no effect
- `FEATURE_NUM` is the numeric prefix of the name if the name has one, otherwise the full branch name

## Prerequisites

- Run `git rev-parse --is-inside-work-tree 2>/dev/null` to verify that Git is available
- If Git is not available, warn the user and skip branch creation

## Branch Numbering Mode

Find the branch numbering strategy in this order:

1. Read `branch_numbering` in `.specify/extensions/git/git-config.yml`
2. Read `branch_numbering` in `.specify/init-options.json` (backward compatibility)
3. Use `sequential` if neither value exists

## Execution

Generate a concise short name (2-4 words) for the branch:

- Extract the most meaningful keywords from the feature description
- Use action-noun format when possible (for example "add-user-auth", "fix-payment-bug")
- Keep technical terms and acronyms (OAuth2, API, JWT, etc.)

Run the script for your platform:

- **Bash**: `.specify/extensions/git/scripts/bash/create-new-feature.sh --json --short-name "<short-name>" "<feature description>"`
- **Bash (timestamp)**: `.specify/extensions/git/scripts/bash/create-new-feature.sh --json --timestamp --short-name "<short-name>" "<feature description>"`
- **PowerShell**: `.specify/extensions/git/scripts/powershell/create-new-feature.ps1 -Json -ShortName "<short-name>" "<feature description>"`
- **PowerShell (timestamp)**: `.specify/extensions/git/scripts/powershell/create-new-feature.ps1 -Json -Timestamp -ShortName "<short-name>" "<feature description>"`

**IMPORTANT**:

- Do NOT pass `--number`. The script finds the next number
- Always include the JSON flag (`--json` for Bash, `-Json` for PowerShell) so that you can parse the output
- Run this script once per feature only
- The JSON output contains `BRANCH_NAME` and `FEATURE_NUM`

## Graceful Degradation

If Git is not installed or the current directory is not a Git repository:

- Skip branch creation and show this warning: `[specify] Warning: Git repository not detected; skipped branch creation`
- The script still outputs `BRANCH_NAME` and `FEATURE_NUM` for the caller

## Output

The script outputs JSON with these fields:

- `BRANCH_NAME`: The branch name (for example `003-user-auth` or `20260319-143022-user-auth`)
- `FEATURE_NUM`: The numeric or timestamp prefix used
