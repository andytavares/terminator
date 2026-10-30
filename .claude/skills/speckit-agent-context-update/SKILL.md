---
name: speckit-agent-context-update
description: Refresh the managed Spec Kit section in coding agent context file(s)
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: github-spec-kit
  source: extension:agent-context
user-invocable: true
disable-model-invocation: false
---

# Agent Context Update Skill

# Update Coding Agent Context

Refresh the managed Spec Kit section in the context file of the active coding agent (for example `CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`).

## Behavior

The script reads the agent-context extension config at
`.specify/extensions/agent-context/agent-context-config.yml`. The config gives:

- `context_file` — the path of the context file to manage.
- `context_files` — optional project-relative paths for many context files. When the list is not empty, the script updates each listed file. The list overrides `context_file`.
- `context_markers.start` / `.end` — the delimiters around the managed section. The defaults, used when the field is missing, are `<!-- SPECKIT START -->` and `<!-- SPECKIT END -->`.

The script then creates, replaces, or appends the managed block. The block points to the most recent plan path (`specs/<feature>/plan.md`) when the script finds one.

If `context_files` and `context_file` are empty, the command reports that there is nothing to do and exits successfully. Context file paths must stay project-relative. The script rejects absolute paths, Windows drive paths, backslash separators, and `..` path segments.

## Execution

- **Bash**: `.specify/extensions/agent-context/scripts/bash/update-agent-context.sh [plan_path]`
- **PowerShell**: `.specify/extensions/agent-context/scripts/powershell/update-agent-context.ps1 [plan_path]`

When you omit `plan_path`, the script uses the most recently modified `specs/*/plan.md`.
