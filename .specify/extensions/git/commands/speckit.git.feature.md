---
description: 'Create a feature branch with sequential or timestamp numbering'
---

# Create Feature Branch

Create and switch to a new git feature branch for the given specification. This command handles **branch creation only**. The core `/speckit.specify` workflow creates the spec directory and files.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before you proceed (if not empty).

## Environment Variable Override

If the user explicitly provided `GIT_BRANCH_NAME` (for example, in an environment variable, an argument, or the request), set the `GIT_BRANCH_NAME` environment variable before you run the script. The script then receives the value. When `GIT_BRANCH_NAME` is set:

- The script uses the exact value as the branch name and skips all prefix and suffix generation
- `--short-name`, `--number`, and `--timestamp` flags are ignored
- The script extracts `FEATURE_NUM` from the name if the name starts with a numeric prefix. Otherwise `FEATURE_NUM` is the full branch name

## Prerequisites

- Verify Git is available by running `git rev-parse --is-inside-work-tree 2>/dev/null`
- If Git is not available, warn the user and skip branch creation

## Branch Numbering Mode

Find the branch numbering strategy. Check the configuration in this order:

1. Check `.specify/extensions/git/git-config.yml` for `branch_numbering` value
2. Check `.specify/init-options.json` for `branch_numbering` value (backward compatibility)
3. Default to `sequential` if neither exists

## Execution

Generate a short name (2-4 words) for the branch:

- Analyze the feature description and extract the most meaningful keywords
- Use action-noun format when possible (for example, "add-user-auth", "fix-payment-bug")
- Keep technical terms and acronyms (OAuth2, API, JWT, and so on)

Run the script for your platform:

- **Bash**: `.specify/extensions/git/scripts/bash/create-new-feature.sh --json --short-name "<short-name>" "<feature description>"`
- **Bash (timestamp)**: `.specify/extensions/git/scripts/bash/create-new-feature.sh --json --timestamp --short-name "<short-name>" "<feature description>"`
- **PowerShell**: `.specify/extensions/git/scripts/powershell/create-new-feature.ps1 -Json -ShortName "<short-name>" "<feature description>"`
- **PowerShell (timestamp)**: `.specify/extensions/git/scripts/powershell/create-new-feature.ps1 -Json -Timestamp -ShortName "<short-name>" "<feature description>"`

**IMPORTANT**:

- Do NOT pass `--number`. The script finds the correct next number
- Always include the JSON flag (`--json` for Bash, `-Json` for PowerShell) so that you can parse the output reliably
- You must run this script only once for each feature
- The JSON output contains `BRANCH_NAME` and `FEATURE_NUM`

## Graceful Degradation

If Git is not installed or the current directory is not a Git repository:

- The script skips branch creation and shows a warning: `[specify] Warning: Git repository not detected; skipped branch creation`
- The script still outputs `BRANCH_NAME` and `FEATURE_NUM`, so the caller can use them

## Output

The script outputs JSON with these fields:

- `BRANCH_NAME`: The branch name (e.g., `003-user-auth` or `20260319-143022-user-auth`)
- `FEATURE_NUM`: The numeric or timestamp prefix used
