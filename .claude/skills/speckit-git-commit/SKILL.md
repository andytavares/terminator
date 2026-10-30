---
name: speckit-git-commit
description: Auto-commit changes after a Spec Kit command completes
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: github-spec-kit
  source: extension:git
user-invocable: true
disable-model-invocation: false
---

# Git Commit Skill

# Auto-Commit Changes

Stage and commit all changes after a Spec Kit command completes.

## Behavior

A hook runs this command after (or before) core commands. The command does these steps:

1. Determine the event name from the hook context (for example, an `after_specify` hook gives the event `after_specify`, and a `before_plan` hook gives `before_plan`)
2. Check `.specify/extensions/git/git-config.yml` for the `auto_commit` section
3. Look up the event key to see if auto-commit is enabled
4. Use `auto_commit.default` if no event key exists
5. Use the per-command `message` if configured, otherwise a default message
6. If auto-commit is enabled and uncommitted changes exist, run `git add .` + `git commit`

## Execution

Determine the event name from the hook that started this command, then run the script:

- **Bash**: `.specify/extensions/git/scripts/bash/auto-commit.sh <event_name>`
- **PowerShell**: `.specify/extensions/git/scripts/powershell/auto-commit.ps1 <event_name>`

Replace `<event_name>` with the hook event (for example `after_specify`, `before_plan`, `after_implement`).

## Configuration

In `.specify/extensions/git/git-config.yml`:

```yaml
auto_commit:
  default: false # Global toggle — set true to enable for all commands
  after_specify:
    enabled: true # Override per-command
    message: '[Spec Kit] Add specification'
  after_plan:
    enabled: false
    message: '[Spec Kit] Add implementation plan'
```

## Graceful Degradation

- If Git is not available or the current directory is not a repository: skip with a warning
- If no config file exists: skip (auto-commit is off by default)
- If no changes exist to commit: skip with a message
