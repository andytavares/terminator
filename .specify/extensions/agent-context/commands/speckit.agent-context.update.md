---
description: 'Refresh the managed Spec Kit section in coding agent context file(s)'
---

# Update Coding Agent Context

Refresh the managed Spec Kit section inside the active coding agent's context file (for example `CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`).

## Behavior

The script reads the agent-context extension config at
`.specify/extensions/agent-context/agent-context-config.yml`. The config gives:

- `context_file` — the path of the coding agent context file to manage.
- `context_files` — optional project-relative paths for multiple coding agent context files. When the list is non-empty, the script updates each listed file, and the list takes precedence over `context_file`.
- `context_markers.start` / `.end` — the delimiters around the managed section. They default to `<!-- SPECKIT START -->` and `<!-- SPECKIT END -->` when the field is missing.

The script then creates, replaces, or appends the managed block. The section points at the most recent plan path when the script can find one (`specs/<feature>/plan.md`).

If `context_files` and `context_file` are empty, the command reports that there is nothing to do and exits successfully. Context file paths must stay project-relative. The command rejects absolute paths, Windows drive paths, backslash separators, and `..` path segments.

## Execution

- **Bash**: `.specify/extensions/agent-context/scripts/bash/update-agent-context.sh [plan_path]`
- **PowerShell**: `.specify/extensions/agent-context/scripts/powershell/update-agent-context.ps1 [plan_path]`

When you omit `plan_path`, the script detects the most recently modified `specs/*/plan.md`.
