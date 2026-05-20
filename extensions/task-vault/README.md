# Task Vault Extension

GTD+BuJo+PARA daily productivity system backed by plain markdown files.

## Features

- **Daily Log** — open Task Vault tab to see today's tasks, events, notes
- **Quick Capture** — OS-level global hotkey opens floating overlay from any app
- **MCP Tools** — 8 MCP tools for agent access (Claude Code, Cursor, Claude Desktop)
- **Projects Browser** — list projects with stale detection
- **Inbox Processing** — GTD clarify flow for inbox items
- **Weekly Review** — full review payload including stale projects and completed tasks

## MCP Server

The MCP server runs as a stdio sidecar that any MCP client can spawn.

### Running the server

```bash
TASK_VAULT_PATH=/path/to/your/vault node extensions/task-vault/src/mcp/server.js
```

### Environment variables

| Variable          | Required | Description                                    |
| ----------------- | -------- | ---------------------------------------------- |
| `TASK_VAULT_PATH` | ✅       | Absolute path to your markdown vault directory |

### Claude Code configuration

Add to `.claude/mcp.json`:

```json
{
  "mcpServers": {
    "task-vault": {
      "command": "node",
      "args": ["/path/to/terminator/extensions/task-vault/src/mcp/server.js"],
      "env": {
        "TASK_VAULT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

### Cursor configuration

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "task-vault": {
      "command": "node",
      "args": ["/path/to/terminator/extensions/task-vault/src/mcp/server.js"],
      "env": {
        "TASK_VAULT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

### Available tools

| Tool            | Description                                      |
| --------------- | ------------------------------------------------ |
| `capture`       | Append task to inbox.md                          |
| `today`         | Get today's daily log                            |
| `add_task`      | Add task to any vault file                       |
| `complete_task` | Mark task `[x]`                                  |
| `migrate_task`  | Migrate task `[>]` to a target date              |
| `query`         | Filter tasks by status/context/project/area/date |
| `list_projects` | List projects by status                          |
| `weekly_review` | Full review payload                              |

### Auto-execute toggles

Write tools default to **suggestion mode** — they describe what they would do without modifying files. To execute immediately, either:

1. Pass `confirmed: true` in the tool call
2. Enable auto-execute in settings: `terminator.task-vault.mcpAutoExecute.<tool_name>`

### Task ID format

Task IDs use `filepath:line` format (e.g., `/vault/daily/2026-05-19.md:7`). IDs are valid only for the current index snapshot. Re-query after any write operation to obtain fresh IDs.

See also: `specs/005-task-vault-extension/quickstart.md` for integration scenarios.
