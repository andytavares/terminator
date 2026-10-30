# Coding Agent Context Extension

This bundled extension manages the **coding agent context file** (for example `CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`, `GEMINI.md`) for the active integration.

It owns the lifecycle of the managed section. The configurable start and end markers delimit the section (defaults: `<!-- SPECKIT START -->` / `<!-- SPECKIT END -->`).

## Why an extension?

Not every Spec Kit user wants Spec Kit to write into the coding agent's context file. A dedicated extension lets users:

- **Opt out** entirely with `specify extension disable agent-context`. Spec Kit then never creates or modifies the agent context file.
- **Customize the markers** by editing `.specify/extensions/agent-context/agent-context-config.yml`. The Python layer and the bundled scripts use the same `context_markers` value.
- **Synchronize multiple agent anchors** by setting `context_files` when a project uses more than one coding agent context file on purpose, such as `AGENTS.md` and `CLAUDE.md`.
- **Refresh on demand** with `/speckit.agent-context.update`, or automatically through the hooks that `extension.yml` declares (`after_specify`, `after_plan`).

## Commands

| Command                        | Description                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `speckit.agent-context.update` | Refresh the managed section in the agent context file with the current plan path. |

## Configuration

All configuration is in the extension's own config file at
`.specify/extensions/agent-context/agent-context-config.yml`:

```yaml
# Path to the coding agent context file managed by this extension
context_file: CLAUDE.md

# Optional list of coding agent context files to manage together.
# When non-empty, this takes precedence over context_file.
context_files:
  - AGENTS.md
  - CLAUDE.md

# Delimiters for the managed Spec Kit section
context_markers:
  start: '<!-- SPECKIT START -->'
  end: '<!-- SPECKIT END -->'
```

- `context_file` — the project-relative path to the coding agent context file. `specify init` and `specify integration install` write it.
- `context_files` — optional project-relative paths to multiple coding agent context files. When the list is non-empty, it takes precedence over `context_file`. The extension rejects absolute paths, backslash separators, and `..` path segments.
- `context_markers.start` / `.end` — the delimiters around the managed section. Edit them to use custom markers.

## Requirements

The bundled update scripts require **Python 3** with **PyYAML** for YAML and upsert processing. PowerShell can also use `ConvertFrom-Yaml` when it is available.

PyYAML ships with the `specify` CLI. The same `python3` interpreter normally provides it. A hook can report _"PyYAML is required … not available in the current Python environment"_. This means the system `python3` is not the interpreter that installed Spec Kit. To fix it, run:

```bash
pip install pyyaml
# or target the specific interpreter Spec Kit uses:
/path/to/speckit-python -m pip install pyyaml
```

## Disable

```bash
specify extension disable agent-context
```

When the extension is disabled, Spec Kit skips context file creation, updates, and removal (the gates are inside `upsert_context_section()` and `remove_context_section()`).
Disabled projects also ignore stale `context_files` values during command rendering. Disabling the extension is then a complete opt-out.
