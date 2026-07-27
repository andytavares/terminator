# Contract: Extension API additions

**Feature**: `021-agent-supervision-console` | **Status**: Draft

Additions to the published Extension API (`packages/extension-sdk/types/api.d.ts`). This is the **only** sanctioned coupling between core and extensions, alongside the publication directory.

## Design rule

Everything core exposes here is **read-only or capability-granting**. Nothing core needs in order to function comes back through this API. If a capability in the spec would otherwise require data an extension holds, core obtains that data itself and any extension enrichment is optional (FR-067).

---

## 1. `api.supervision` — read-only session state (FR-066)

```typescript
interface SupervisionApi {
  /** Snapshot of every supervised session. */
  listSessions(): Promise<readonly SupervisedSession[]>

  /** One session, or null if unknown to the console. */
  getSession(sessionId: string): Promise<SupervisedSession | null>

  /** Fires on every runtime state transition. Returns an unsubscribe fn. */
  onStateChanged(
    handler: (e: { sessionId: string; from: RuntimeState; to: RuntimeState; at: number }) => void
  ): () => void
}

interface SupervisedSession {
  readonly id: string
  readonly workItemId: string | null
  readonly laneOrd: number | null
  readonly repoPath: string
  readonly worktreePath: string
  readonly branch: string
  readonly runtimeState: RuntimeState
  readonly stateSince: number
  readonly turns: number
  readonly costUsd: number
  readonly contextPct: number | null
  readonly diffSummary: { files: number; added: number; removed: number }
}

type RuntimeState =
  | 'starting'
  | 'working'
  | 'needs_input'
  | 'stalled'
  | 'ready'
  | 'failed'
  | 'merged'
  | 'unknown'
```

**Deliberately not exposed**: `transcriptPath`, `pendingPermission`, and the raw event stream. Transcript contents are sensitive and unversioned; permission decisions are the operator's, not an extension's. Both can be added later if a real need appears — the reverse is not true.

---

## 2. `api.worktrees` — provisioning as a core capability (FR-079)

```typescript
interface WorktreesApi {
  provision(opts: {
    repoPath: string
    branch: string
    workItemId?: string
  }): Promise<{ path: string; portBase: number; portSpan: number }>

  release(worktreePath: string): Promise<void>

  list(): Promise<readonly { path: string; branch: string; sessionId: string | null }[]>
}
```

Core provides this; extensions may consume it. **Core never calls an extension's provisioning** (FR-079). An extension that keeps its own worktree handling is not in violation and is not this feature's concern — it simply does not benefit from shared port allocation.

---

## 3. `api.workItems` — producer registration (FR-077, FR-078)

A producer registers the actions the console may invoke on it. Every action is optional; an unregistered action renders read-only with a stated reason rather than failing (FR-078).

```typescript
interface WorkItemsApi {
  /** Absolute path this producer writes its contract files into. Console-owned; created on call. */
  publicationDirectory(): Promise<string>

  registerProducer(handlers: {
    approveGate?(workItemId: string, gate: string): Promise<void>
    rejectGate?(workItemId: string, gate: string, notes: string): Promise<void>
    advancePhase?(workItemId: string): Promise<void>
    sendBack?(workItemId: string, phase: string, notes: string): Promise<void>
  }): void
}
```

**The console does not know which producer implements what.** It asks whether a handler is registered for the action the operator chose, invokes it if so, and states "unavailable — no producer provides this action" if not.

---

## 4. What is NOT added

| Not exposed                                      | Why                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| A pluggable agent-runtime provider               | FR-004 forbids it. One implementation, not on the API.                                                      |
| A code-host provider interface                   | FR-056 requires core own this. Making it pluggable would make unattended-merge safety depend on an install. |
| Surface/panel contribution for supervision views | FR-064 requires surfaces be core and work with zero extensions installed.                                   |
| Write access to session state                    | Runtime state is derived from observation. An extension asserting state would defeat the entire feature.    |

---

## Backwards compatibility

All three namespaces are additive. No existing Extension API member changes, so every installed extension continues to work untouched. `packages/extension-sdk` gets a minor version bump.

## Requirements covered

FR-066, FR-067, FR-077, FR-078, FR-079
