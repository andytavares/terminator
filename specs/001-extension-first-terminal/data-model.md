# Data Model: Extension-First Terminal Emulator (Phase 1)

**Date**: 2026-05-05  
**Branch**: `001-extension-first-terminal`

All entities are defined as TypeScript interfaces and enforced at runtime via Zod schemas. Schemas live in `src/shared/schemas/`. The interfaces live in `src/shared/types/index.ts`.

---

## Entities

### Workspace

The top-level organizational unit, linked to a local folder on disk.

```typescript
interface Workspace {
  id: string // UUID v4, generated on creation
  name: string // User-provided; unique across all workspaces (FR-001)
  folderPath: string // Absolute path to the associated local directory
  color: string // CSS hex color string, e.g. "#4A90E2"
  tags: string[] // Zero or more user-defined tag strings
  createdAt: string // ISO 8601 timestamp
  updatedAt: string // ISO 8601 timestamp
}
```

**Uniqueness**: `name` MUST be globally unique. Enforced at create and edit time (FR-001).  
**Validation rules**:

- `name`: non-empty string, max 100 characters, must be unique
- `folderPath`: must be a valid absolute file system path (validation: path exists and is a directory)
- `color`: valid CSS hex color (`#RRGGBB`)
- `tags`: each tag is a non-empty string, max 50 characters; max 20 tags per workspace

**State transitions**: Workspaces have no lifecycle states — they exist until removed.

---

### Project

A task-level grouping within a workspace.

```typescript
interface Project {
  id: string // UUID v4
  workspaceId: string // FK → Workspace.id
  name: string // User-provided; unique within its parent workspace
  createdAt: string
  updatedAt: string
}
```

**Uniqueness**: `name` MUST be unique within the same workspace. Two projects in different workspaces may share a name.  
**Relationships**: Many Projects belong to one Workspace. Removing a Workspace removes all its Projects (cascade).  
**Validation rules**:

- `name`: non-empty string, max 100 characters, unique within `workspaceId`
- `workspaceId`: must reference an existing Workspace

---

### TerminalSession

An active or backgrounded terminal process, scoped to a Project tab.

```typescript
type SessionStatus = 'active' | 'backgrounded' | 'closed'
type SessionType = 'human' | 'agent'

interface TerminalSession {
  id: string // UUID v4
  projectId: string // FK → Project.id
  tabTitle: string // Display name in the tab bar; defaults to shell name
  status: SessionStatus
  type: SessionType // 'human' (default) or 'agent' (FR-035, FR-036)
  scrollbackLimit: number // Lines; defaults to global setting (10,000)
  createdAt: string
  closedAt?: string // Set when status transitions to 'closed'
}
```

**State transitions**:

```
[created] → active
active → backgrounded  (user navigates away)
backgrounded → active  (user returns to project)
active | backgrounded → closed  (user closes tab or app exits)
```

**In-memory only**: The `TerminalSession` record tracks metadata. The xterm.js `Terminal` instance and PTY process are runtime objects — not persisted. After app restart, no sessions are restored (per Assumptions).

**Cleanup invariant**: When status transitions to `closed`, the associated PTY process MUST be terminated and all OS resources released within 2 seconds (SC-003).

---

### Extension

A loadable package that extends application functionality.

```typescript
type ExtensionStatus = 'enabled' | 'disabled' | 'error'

interface Extension {
  id: string // Reverse-domain identifier, e.g. "com.example.my-ext"
  name: string // Human-readable display name
  version: string // Semver string, e.g. "1.0.0"
  description: string
  entryPoint: string // Absolute path to the extension's main JS file
  status: ExtensionStatus
  installedAt: string
  errorMessage?: string // Set when status is 'error'
}
```

**Extension manifest** (`extension.json` at extension root):

```typescript
interface ExtensionManifest {
  id: string
  name: string
  version: string
  description: string
  main: string // Relative path to entry point within extension directory
  minAppVersion: string // Minimum Terminator version required (semver range)
}
```

**Validation**: Manifest validated with Zod on install. Extensions with invalid manifests are rejected with a clear error (FR-028). Extensions where `minAppVersion` is not satisfied are rejected.

---

### Settings

A hierarchical configuration store with global defaults and workspace-level overrides.

```typescript
type SettingsScope = 'global' | 'workspace'

interface GlobalSettings {
  appearance: {
    theme: 'dark' | 'light'
  }
  terminal: {
    scrollbackLimit: number // Default: 10,000; min: 1,000; max: 100,000
    defaultShell: string // e.g., "/bin/zsh"; defaults to user's login shell
  }
  extensions: {
    [extensionId: string]: Record<string, unknown> // Extension-contributed settings
  }
}

interface WorkspaceSettings {
  workspaceId: string
  overrides: Partial<Omit<GlobalSettings, 'extensions'>> // Workspace can override appearance + terminal settings
  extensions: {
    [extensionId: string]: Record<string, unknown>
  }
}
```

**Precedence**: `WorkspaceSettings.overrides` takes precedence over `GlobalSettings` when the user is operating within that workspace (FR-022). Extension settings are keyed by extension ID and are independent per scope.

**Storage**: `GlobalSettings` stored in the global electron-store instance. `WorkspaceSettings` stored alongside the Workspace record (or in a separate keyed store by `workspaceId`).

---

## Zod Schema Examples

Representative schemas from `src/shared/schemas/`. Full schemas live in source files.

```typescript
// src/shared/schemas/workspace.schema.ts
import { z } from 'zod'

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  folderPath: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  tags: z.array(z.string().min(1).max(50)).max(20),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const CreateWorkspaceInputSchema = WorkspaceSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})

// src/shared/schemas/session.schema.ts
export const SessionStatusSchema = z.enum(['active', 'backgrounded', 'closed'])
export const SessionTypeSchema = z.enum(['human', 'agent'])

export const TerminalSessionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  tabTitle: z.string().min(1).max(100),
  status: SessionStatusSchema,
  type: SessionTypeSchema,
  scrollbackLimit: z.number().int().min(1000).max(100000),
  createdAt: z.string().datetime(),
  closedAt: z.string().datetime().optional(),
})
```

---

## Entity Relationships

```
Workspace (1) ──── (many) Project
Project   (1) ──── (many) TerminalSession   [in-memory during session lifetime]
GlobalSettings (1) ──── (many) WorkspaceSettings [one per workspace, optional]
Extension (many) ─── contributes to ──> GlobalSettings.extensions[extensionId]
```

---

## Persistence Boundaries

| Entity                     | Persisted | Storage              | Notes                               |
| -------------------------- | --------- | -------------------- | ----------------------------------- |
| Workspace                  | ✅ Yes    | electron-store       | Survives app restart                |
| Project                    | ✅ Yes    | electron-store       | Survives app restart                |
| TerminalSession (metadata) | ❌ No     | In-memory only       | Cleared on app exit                 |
| TerminalSession (buffer)   | ❌ No     | In-memory (xterm.js) | Cleared on tab close or app exit    |
| PTY Process                | ❌ No     | OS process           | Terminated on tab close or app exit |
| Extension                  | ✅ Yes    | electron-store       | Installed extensions list persists  |
| GlobalSettings             | ✅ Yes    | electron-store       | Survives app restart                |
| WorkspaceSettings          | ✅ Yes    | electron-store       | Survives app restart                |
