# Quickstart: Task Vault Extension

## Prerequisites

- Terminator app installed and running
- Node.js 18+ (for MCP server)

## 1. Configure the Extension

Open Terminator Settings → Extensions → Task Vault and set:

| Setting                 | Default                 | Description                                                 |
| ----------------------- | ----------------------- | ----------------------------------------------------------- |
| Vault directory         | `~/vault`               | Path to your vault folder (created automatically if absent) |
| Capture hotkey          | `CmdOrCtrl+Shift+Space` | OS-level hotkey for quick capture overlay                   |
| Weekly review day       | Friday                  | Day of week for review reminder nudge                       |
| Weekly review time      | 17:00                   | Time for review reminder                                    |
| Stale project threshold | 14 days                 | Days without edit before project is flagged stale           |
| ICS feed URLs           | —                       | One or more ICS calendar URLs or file paths                 |
| ICS refresh interval    | 4 hours                 | How often the calendar feed is polled                       |

## 2. Open the Task Vault

Click the **Task Vault** icon in the application sidebar (always visible, below the workspace list). The daily log for today opens automatically.

## 3. Quick Capture

Press the capture hotkey from **any application**. Type your thought and press:

- `Enter` — saves to `inbox.md`
- `⌘Enter` — saves to the agent's suggested destination
- `Esc` — dismisses without saving

## 4. Configure the MCP Server

Add the MCP server to your agent configuration to enable Claude Code, Cursor, or Claude Desktop to access your vault.

**Claude Code** (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "task-vault": {
      "command": "node",
      "args": ["/path/to/terminator/extensions/task-vault/src/mcp/server.js"],
      "env": {
        "TASK_VAULT_PATH": "/Users/you/vault"
      }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "task-vault": {
      "command": "node",
      "args": ["/path/to/terminator/extensions/task-vault/src/mcp/server.js"],
      "env": {
        "TASK_VAULT_PATH": "/Users/you/vault"
      }
    }
  }
}
```

The server path is shown in **Settings → Extensions → Task Vault → MCP Server Path**.

## 5. Available MCP Tools

| Tool                                     | Description                                   |
| ---------------------------------------- | --------------------------------------------- |
| `capture(text, hintArea?, hintProject?)` | Append to inbox.md                            |
| `today()`                                | Read today's daily log                        |
| `add_task(filePath, text, due?, tags?)`  | Insert task into any vault file               |
| `complete_task(taskId)`                  | Mark task done                                |
| `migrate_task(taskId, targetDate)`       | Migrate task to another day                   |
| `query(filter)`                          | Find tasks by status/context/project/area/due |
| `list_projects(status?)`                 | List projects with staleness info             |
| `weekly_review()`                        | Get structured review payload                 |

**Note**: Task IDs (`filepath:line`) are valid for the current session only. Always re-query after writing.

## 6. Link Vault Items to Terminator Projects

From any vault task or project view:

- **UI**: Click "Link to Terminator…" and pick a workspace or project
- **Inline syntax**: Type `terminator:<uuid>` in task text

Linked vault tasks appear in the workspace/project's sidebar panel in Terminator.

## 7. Weekly Review

The extension nudges you on your configured review day. Click the notification to launch the 6-step guided review:

1. **Get clear** — process loose inbox items
2. **Inbox** — GTD clarify flow for each inbox item
3. **Projects** — review every active project; resolve stale ones
4. **Calendar** — view last week / next week from your ICS feed
5. **Someday** — promote anything ready to become active
6. **Reflect** — three free-form prompts

## 8. Vault File Format

Your vault is plain markdown — readable and editable in any text editor.

**Task syntax**:

```
- [ ] Open task +project @context #area due:2026-05-22
- [x] Done task                              2026-05-19
- [>] Migrated → 2026-05-23
- [-] Cancelled
- [/] In progress
*     Note
o 09:00  Event
```

**Project file** (`projects/my-project.md`):

```yaml
---
type: project
status: active
deadline: 2026-06-30
area: engineering
created: 2026-05-01
---

# My project

## Outcome
What done looks like.

## Next action
- [ ] First concrete step @deep

## All tasks
- [ ] First concrete step @deep
- [x] Completed step                    2026-05-10
```
