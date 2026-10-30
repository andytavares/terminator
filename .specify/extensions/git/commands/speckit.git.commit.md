---
description: 'Auto-commit changes after a Spec Kit command completes'
---

# Auto-Commit Changes

Stage and commit all changes after a Spec Kit command completes.

## Behavior

A hook invokes this command after (or before) core commands. The command:

1. Determines the event name from the hook context (for example, the `after_specify` hook gives the event `after_specify`, and the `before_plan` hook gives `before_plan`)
2. Checks `.specify/extensions/git/git-config.yml` for the `auto_commit` section
3. Looks up the event key to see if auto-commit is enabled
4. Falls back to `auto_commit.default` if no event key exists
5. Uses the `message` of the command if configured, otherwise a default message
6. If auto-commit is enabled and uncommitted changes exist, runs `git add .` + `git commit`

## Execution

Determine the event name from the hook that triggered this command, then run the script:

- **Bash**: `.specify/extensions/git/scripts/bash/auto-commit.sh <event_name>`
- **PowerShell**: `.specify/extensions/git/scripts/powershell/auto-commit.ps1 <event_name>`

Replace `<event_name>` with the actual hook event (for example, `after_specify`, `before_plan`, `after_implement`).

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

- If Git is not available or the current directory is not a repository: skip and show a warning
- If no config file exists: skip (auto-commit is disabled by default)
- If no changes exist to commit: skip and show a message
