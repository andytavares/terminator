# Data Model: Deep Audit Remediation

**Phase 1 output for** `specs/012-deep-audit-remediation/plan.md`  
**Date**: 2026-06-21

---

## Changed Entities

### IpcRegistryEntry (new type — `src/main/remote/ipc-registry.ts`)

Replaces the bare `IpcHandler` value in `ipcInvokeRegistry`.

| Field              | Type         | Constraints                                                      |
| ------------------ | ------------ | ---------------------------------------------------------------- |
| `handler`          | `IpcHandler` | Required — the actual `ipcMain.handle` listener                  |
| `remoteAccessible` | `boolean`    | Required — defaults to `false`; must be `true` for bridge access |

**State transitions**: Entry is created at `ipcMain.handle` call time with `remoteAccessible` flag. Removed when `ipcMain.removeHandler` is called. No runtime mutation.

---

### settings (PGlite table — both extensions)

**Before**:

```sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**After**:

```sql
CREATE TABLE IF NOT EXISTS settings (
  extension_id TEXT NOT NULL,
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,
  PRIMARY KEY (extension_id, key)
);
```

**Migration backfill rule**:

- Key prefix `'terminator.task-vault.'` → `extension_id = 'task-vault'`
- Key prefix `'terminator.notepad.'` → `extension_id = 'notepad'`
- Unresolvable prefix → logged at `warn`, `extension_id = '__unknown__'`

**Validation rules**:

- `extension_id` is `NOT NULL` — enforced at schema level
- `extension_id` must be provided at every write call site — enforced via the `ExtensionDB` settings API signature

---

### diagram_tags (new PGlite table — notepad extension)

Replaces the `tags TEXT NOT NULL DEFAULT '[]'` JSON column on `diagrams`.

```sql
CREATE TABLE IF NOT EXISTS diagram_tags (
  diagram_id TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  PRIMARY KEY (diagram_id, tag)
);
```

**Migration**: Parse existing `diagrams.tags` JSON arrays during `applyNotepadMigrations`; insert rows into `diagram_tags`; drop the `tags` column from `diagrams` (or leave as deprecated empty column if ALTER TABLE DROP COLUMN is not supported — PGlite supports DROP COLUMN).

**Relationships**:

- `diagram_tags.diagram_id` → `diagrams.id` (FK with CASCADE DELETE)
- Mirrors `note_tags (note_id, tag)` exactly

---

### XTERM_THEMES (constant — `src/renderer/components/terminal/TerminalSession.tsx`)

Not a persisted entity — a compile-time constant defining the xterm.js theme object for each app theme.

| Key     | Value                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------- |
| `dark`  | `{ background: '#1e1e1e', foreground: '#cccccc', ... }` (current hardcoded values)                  |
| `light` | Solarized-Light-derived: `{ background: '#fdf6e3', foreground: '#657b83', cursor: '#586e75', ... }` |

Full 16-color ANSI palette must be defined for both. See xterm.js `ITheme` interface for the complete field list.

---

## Unchanged Entities (referenced for context)

- `notes`, `note_tags`, `folders` — no schema changes; the `note_tags` pattern is the reference implementation being replicated for diagrams.
- `tasks`, `projects` (task-vault) — no schema changes.
- `diagrams` — the `tags` column is removed; all other columns unchanged.
