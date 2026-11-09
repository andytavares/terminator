# termctl

`termctl` runs Terminator's tools from a shell. Each tool that Claude Code can call through the Terminator MCP server is also a `termctl` command. Terminator must be running.

## Run a command

A command is a group and a verb, then the flags of the tool:

```sh
termctl task list
termctl project list --workspace-id 07fa6152-680b-4c25-8ba6-4298176113a4
termctl worktree create --repo-root ~/repos/terminator --worktree-path ~/repos/terminator/.worktrees/docs --branch docs --is-new-branch
```

Run `termctl` with no arguments to open the full-screen view.

## Find a command

- `termctl --help` lists each group with its verbs, and the global flags.
- `termctl worktree --help` lists the verbs of the `worktree` group.
- `termctl worktree create --help` shows what the command does and its flags.

## Flags

- Each flag is the tool's field name in lowercase words joined by `-`: the field `workspaceId` is `--workspace-id`.
- A yes/no flag is a switch: give `--is-new-branch` for yes, and leave it out for no.
- Give a list flag once for each item: `--tags work --tags urgent`.
- Give an object flag as JSON: `--patch '{"theme":"dark"}'`.
- Give `null` to clear a field that can be empty: `--branch null`.

Global flags work with every command:

| Flag              | What it does                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `--json`          | Prints the result as the tool returned it, for scripts.                                                       |
| `--yes`           | Runs a destructive command without asking.                                                                    |
| `--help`          | Shows help for `termctl`, a group or a command.                                                               |
| `--socket <path>` | Connects to this socket instead of the app's. The `TERMINATOR_MCP_SOCKET` environment variable does the same. |

## Results

A list of records prints as a table of their simple fields. Any other result prints as indented JSON. Use `--json` to get the full result.

## Destructive commands

A command that deletes or closes something asks first, for example `Delete task? [y/N]`. Type `y` to run it. In a script, where nobody can answer, `termctl` refuses the command unless you give `--yes`.

## Exit codes

| Code | Meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| 0    | The command ran.                                                              |
| 1    | The tool returned an error. The message is on stderr.                         |
| 2    | The command line is wrong, or a destructive command was refused or cancelled. |
| 3    | Terminator is not running.                                                    |

## Full-screen view

Run `termctl` with no arguments in a terminal. The left pane lists Workspaces, Tasks, Agents, Terminals, Schedules and Notifications, each with its count. The right pane shows the rows of the selected list, and the fields of the selected row under them. The lists refresh every 2 seconds.

| Key     | What it does                                                                      |
| ------- | --------------------------------------------------------------------------------- |
| `↑` `↓` | Moves the selection in the focused pane.                                          |
| `Tab`   | Moves the focus between the lists and the rows.                                   |
| `Enter` | Opens the selected list's rows.                                                   |
| `/`     | Filters the rows by the text you type. `Enter` keeps the filter, `Esc` clears it. |
| `:`     | Opens the command palette.                                                        |
| `q`     | Quits.                                                                            |

In the command palette, type part of a command, such as `worktree create`, and press `Enter`. A form shows one field for each flag, and marks the required ones. Use `Tab` to move to the next field, and `Enter` to run the command. Type a yes/no field as `true` or `false`. A destructive command asks first, for example `Delete task "Docs"? [y/N]`. The result shows in the right pane, and an error shows in red. `Esc` closes the palette or the form.

When stdin or stdout is not a terminal, `termctl` with no arguments prints the help and exits 2.
