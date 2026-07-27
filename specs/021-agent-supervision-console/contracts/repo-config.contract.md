# Contract: Repository configuration

**Feature**: `021-agent-supervision-console` | **Status**: Draft

Per-repository settings, committed to the repository so they travel with it (FR-037). Read-only to the console.

## Location

`.terminator/config.json` at the repository root.

**Format resolved (task T007): JSON, not TOML.** TOML would require a new npm dependency; `JSON.parse` is stdlib and Zod (already a core dependency) validates it. Constitution IV requires the standard library be used where it fully satisfies the requirement. Full rationale at research.md R5. The cost is that JSON carries no comments, so the table below documents each key here rather than inline.

## Schema

```json
{
  "worktree": {
    "symlink": ["node_modules", "target", ".venv"],
    "copy": [".env.local", "certs/dev.pem"],
    "portBase": 4000,
    "portSpan": 10
  },
  "scripts": {
    "setup": "pnpm install --frozen-lockfile",
    "teardown": "pnpm db:drop $TERMINATOR_WORKITEM",
    "verify": "pnpm test && pnpm lint"
  },
  "stall": { "silenceMs": 480000, "noProgressMs": 900000 },
  "review": {
    "criticalPaths": ["src/auth/**", "migrations/**"],
    "unattendedMergeLowestGrade": false
  },
  "network": { "allowedHosts": ["github.com", "registry.npmjs.org"] }
}
```

| Key                                 | Meaning                                                            | Default | FR     |
| ----------------------------------- | ------------------------------------------------------------------ | ------- | ------ |
| `worktree.symlink`                  | Gitignored directories shared from the primary checkout            | `[]`    | FR-031 |
| `worktree.copy`                     | Files copied into each new worktree                                | `[]`    | FR-032 |
| `worktree.portBase` / `portSpan`    | First port of the first span, and ports per worktree               | 4000/10 | FR-033 |
| `scripts.setup`                     | Run during provisioning; non-zero exit marks the session `failed`  | none    | FR-034 |
| `scripts.teardown`                  | Run on archive                                                     | none    | FR-035 |
| `scripts.verify`                    | Run to verify a working copy                                       | none    | FR-037 |
| `stall.silenceMs`                   | Silence threshold before a stall fires                             | 480000  | FR-012 |
| `stall.noProgressMs`                | No-net-change threshold for the loop signal                        | 900000  | FR-013 |
| `review.criticalPaths`              | Extra P0 triggers. **Never inferred** — empty until declared       | `[]`    | FR-055 |
| `review.unattendedMergeLowestGrade` | Per-repository only. **No global switch exists**                   | `false` | FR-059 |
| `network.allowedHosts`              | Hosts that do not prompt; anything off-list prompts at every level | `[]`    | FR-042 |

Every key is optional. An absent file is valid and means "all defaults" — provisioning still works, it simply shares nothing, copies nothing, and runs no setup.

## Environment exported to each session (FR-033)

| Variable               | Value                                           |
| ---------------------- | ----------------------------------------------- |
| `TERMINATOR_PORT_BASE` | First port of this worktree's allocated span    |
| `TERMINATOR_WORKTREE`  | Absolute worktree path                          |
| `TERMINATOR_WORKITEM`  | Work item id, or the session id for ad-hoc work |

## Behaviour notes

- **Symlinking is best-effort but never silent.** If a declared directory is missing from the primary checkout, it is skipped and recorded in the provisioning log. If linking produces a broken environment, the setup command fails and the session surfaces as `failed` with output attached — the honest failure mode (FR-034).
- **Ports are verified, not assumed.** A candidate span is checked against live worktrees _and_ probed for actual availability before being committed. Spans never overlap (SC-008).
- **Databases are out of scope** (FR-038). `setup`/`teardown` are the supported extension point. Documentation names Neon/Supabase branching and per-worktree Docker as the two known patterns and claims nothing further.
- **`critical_paths` is never inferred** (FR-055). An empty list means P0 relies solely on the built-in triggers.
- **No global unattended-merge switch exists** (FR-059). It is per-repository, in this file, defaulting to `false`.

## Requirements covered

FR-016, FR-031, FR-032, FR-033, FR-034, FR-035, FR-037, FR-038, FR-042, FR-055, FR-059
