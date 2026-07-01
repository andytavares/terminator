# Contract: IPC Channels (SpecKit Pilot Board)

All channels are extension-owned, registered by `extensions/speckit-pilot/src/index.ts`
via `api.ipc.registerHandler`, and invoked from the renderer via
`window.electronAPI.extensionBridge.invoke('speckit-pilot:<name>', payload)`. Handlers
follow the constitution's error contract: recoverable failures return
`{ error: string }` (or `{ error: 'VALIDATION_ERROR', message }`), never throw across
the boundary.

Legend: **NEW** = added by this feature; **REUSED** = existing, unchanged;
**CHANGED** = existing, semantics extended.

## New channels

### `speckit:card-list` — NEW

Board data for the current workspace.

- **Req**: `{ repoRoot: string }`
- **Res**: `{ cards: CardSummary[] }` or `{ error }`
- `CardSummary = { featureDir, title, type, scopeLine, source, stage, runStatus, phaseSummary: { done: number; total: number; awaitingReview: boolean }, prUrl }`

### `speckit:card-create` — NEW

Create a native card (feature dir + `card.json` + `state.json` at `stage:'backlog'`, no run).

- **Req**: `{ repoRoot: string, brief: { title, type, scope, checklist?, attachments?, knowledgeRefs? } }`
- **Res**: `{ featureDir: string }` or `{ error: 'VALIDATION_ERROR', message }` (empty title)

### `speckit:card-update` — NEW

Edit an existing card's brief.

- **Req**: `{ featureDir: string, brief: Partial<CardBrief> }`
- **Res**: `{ ok: true }` or `{ error }`

### `speckit:card-move` — NEW

Move a card between adjacent stages.

- **Req**: `{ featureDir: string, toStage: BoardStage }`
- **Behavior**: `backlog → next` triggers dispatch (reuses the `speckit:dispatch` path); active `→ backlog` cancels/parks (reuses `speckit:run-cancel`) — the renderer must confirm before requesting a destructive backward move. Non-adjacent transitions rejected.
- **Res**: `{ ok: true, dispatched?: boolean }` or `{ error: 'VALIDATION_ERROR', message }`

### `speckit:card-comment` — NEW

Append a user comment; queued to steer the next phase run.

- **Req**: `{ featureDir: string, body: string }`
- **Res**: `{ comment: CardComment }` or `{ error }`

### `speckit:comment-list` — NEW

- **Req**: `{ featureDir: string }`
- **Res**: `{ comments: CardComment[] }` or `{ error }`

### `speckit:artifact-list` — NEW

Enumerate a card's artifacts with git revision history.

- **Req**: `{ featureDir: string }`
- **Res**: `{ artifacts: ArtifactRef[] }` or `{ error }`

### `speckit:knowledge-search` — NEW

Keyword search across repo markdown + card briefs/specs.

- **Req**: `{ repoRoot: string, query: string }`
- **Res**: `{ results: KnowledgeRef[] }` (empty array = explicit no-match) or `{ error }`

## Changed channels

### `speckit:dispatch` — CHANGED

Now callable for an existing Backlog card (not only from a ticket). Concurrency: if
active runners < `maxConcurrentRuns`, start immediately; else set `queuePosition:'pending'`.

- **Req**: `{ repoRoot, featureDir?, ticket?, autonomyLevel, baseBranch }` (featureDir provided when dispatching an existing native/imported card)
- **Res**: `{ featureDir, branchName, worktreePath, queued: boolean }` or `{ error }`

### `speckit:run-cancel` — REUSED (invoked by `card-move → backlog`)

Existing behavior: stop runner, remove worktree, set `cancelled`, advance queue. The
queue-advance now respects `maxConcurrentRuns`.

## Reused channels (unchanged)

`speckit:feature-list`, `speckit:pilot-state`, `speckit:phase-approve`,
`speckit:phase-reject`, `speckit:phase-revoke`, `speckit:phase-request-changes`,
`speckit:phase-comment`, `speckit:artifact-read` (backs the artifacts viewer + diff),
`speckit:checkin-decision`, `speckit:open-pr`, `speckit:checkpoint-create`,
`speckit:ticket-list`, `speckit:credentials-set`, `speckit:credentials-status`,
`speckit:self-review-read`, `speckit:history-load`.

## Push events (main → renderer, unchanged + reused)

- `speckit:state-changed` `{ state: PilotState }` — board re-buckets the affected card by `deriveStage` (drives SC-004, no manual refresh).
- `speckit:run-output` `{ featureDir, phase, line, ts }`
- `speckit:run-phase-complete` `{ featureDir, phase, exitCode }`
- `speckit:checkin-ready` `{ featureDir, batchIndex, diffSummary }`
- `speckit:dispatch-started` `{ featureDir, branchName, worktreePath }`

## Invariants

- No secret ever crosses to the renderer (`credentials-status` returns booleans only).
- New handler logic lives only in the extension's `index.ts`; no core file changes.
- All new channels validate input via the extension's Zod schemas and return the error contract on failure.
