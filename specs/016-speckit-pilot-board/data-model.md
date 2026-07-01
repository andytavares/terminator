# Phase 1 Data Model: SpecKit Pilot Quill-style Workflow Board

Extends the existing types in `extensions/speckit-pilot/src/types/speckit.types.ts`.
Only additions/changes are listed; all existing types (`PhaseId`, `PhaseStatus`,
`PhaseState`, `RunMeta`, `Ticket`, `TicketRef`, `HistoryEntry`, `PilotSettings`,
`PHASE_ORDER`, etc.) are reused unchanged unless noted.

## New enums / primitives

```ts
export type BoardStage = 'backlog' | 'spec' | 'plan' | 'implement' | 'in-review' | 'done'

export const STAGE_ORDER: BoardStage[] = [
  'backlog',
  'spec',
  'plan',
  'implement',
  'in-review',
  'done',
]

export type CardType = 'feature' | 'bug' | 'chore' | 'spike'

export type CardSource = 'native' | 'linear' | 'jira'
```

## New entities

### ChecklistItem

```ts
export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}
```

### KnowledgeRef (attached search result)

```ts
export interface KnowledgeRef {
  file: string // repo-relative path
  line: number // 1-indexed
  snippet: string // matched line/context
}
```

### CardBrief

The human-authored description of a card. Persisted at `.pilot/card.json` and mirrored
onto `PilotState.card`.

```ts
export interface CardBrief {
  title: string // required (FR-010 gate: title before handoff)
  type: CardType // default 'feature'
  scope: string // free text; may be empty
  checklist: ChecklistItem[] // default []
  attachments: string[] // repo-relative paths; default []
  knowledgeRefs: KnowledgeRef[] // attached search context; default []
  source: CardSource // 'native' | 'linear' | 'jira'
  createdAt: string // ISO
}
```

### CardComment

Append-only entry in `.pilot/comments.jsonl`. User comments steer the next phase run.

```ts
export interface CardComment {
  id: string
  author: 'you' | 'agent'
  body: string
  ts: string // ISO
  appliedToRunId?: string | null // set once fed into a phase run
}
```

### ArtifactRef + ArtifactRevision (for `artifact-list`)

```ts
export interface ArtifactRevision {
  commit: string // short sha
  ts: string // ISO
  subject: string // commit subject
}

export interface ArtifactRef {
  kind: 'spec' | 'plan' | 'tasks' | 'checklist' | 'self-review' | 'diff' | 'pr'
  path: string | null // null for 'pr'
  label: string
  exists: boolean
  revisions: ArtifactRevision[] // from `git log -- <path>`; [] if none
  prUrl?: string | null // for kind 'pr'
}
```

## Changed entity: PilotState → version 3

```ts
export interface PilotState {
  version: 3 // was 2
  featureDir: string
  card: CardBrief // NEW — always present (v2 migration synthesizes it)
  stage: BoardStage // NEW — 'backlog' for un-dispatched; else reconciled via deriveStage
  ticket: TicketRef | null // reused (set for imported cards)
  run: RunMeta | null // reused (null until handoff)
  queuePosition: 'active' | 'pending' | null // reused; 'pending' now means over-cap wait
  worktreePath: string | null
  branchName: string | null
  prUrl: string | null
  phases: Record<PhaseId, PhaseState>
  settings: PilotSettings
}
```

### PilotSettings addition

```ts
// added field:
maxConcurrentRuns: number // default 3 (DEFAULT_SETTINGS)
```

## Pure function: deriveStage

```ts
export function deriveStage(phases: Record<PhaseId, PhaseState>, run: RunMeta | null): BoardStage
```

Rules (first match wins):

1. `run === null` → `'backlog'`.
2. `run.status === 'completed'` **or** any phase `open-pr` is `approved`/PR opened → `'done'`.
3. Otherwise find the "current" phase = the first phase in `PHASE_ORDER` whose status is
   not `approved`/`skipped` (i.e. the active/awaiting/failed/ready one), and map it:
   - constitution | specify | clarify → `'spec'`
   - plan | checklist → `'plan'`
   - tasks | analyze | implement → `'implement'`
   - self-review | open-pr → `'in-review'`
4. If all phases are `approved` but PR not opened → `'in-review'` (awaiting open-pr).

`deriveStage` is pure and total (always returns a `BoardStage`). Failed/stopped runs
resolve via rule 3 to the last active phase's column (the card carries a failed status
chip in the UI; stage is unaffected).

## State transitions (card lifecycle)

```
[create native / import]  → stage=backlog, run=null, worktree=null
      │  handoff (card-move out of backlog, or explicit Start)
      ▼
[dispatch]  → create worktree + start runner (if active<maxConcurrentRuns)
      │                                      else queuePosition='pending'
      ▼
stage derived from phases:  spec → plan → implement → in-review
      │  open-pr approved / run completed
      ▼
[done]  → stage=done, prUrl set
```

Backward/park: `card-move` to `backlog` on an active card requires explicit user
confirmation (renderer), then cancels the run (reuses `speckit:run-cancel`), removes
the worktree, sets `run` to `cancelled`/null, `stage='backlog'`, and advances the
pending queue.

## Persistence layout (per feature dir)

```
specs/NNN-slug/
├── spec.md, plan.md, tasks.md, checklists/ …   # artifacts (existing)
└── .pilot/
    ├── state.json        # PilotState v3 (atomic write)
    ├── card.json         # CardBrief (native/imported authoring; source of brief)
    ├── history.jsonl     # audit log (existing; feeds activity feed)
    ├── comments.jsonl    # NEW — CardComment[] (feeds activity feed + steering)
    └── self-review.json  # existing
```

## Migration v2 → v3

`state-persistence.ts` upgrades on read:

- `version: 2 → 3`.
- Synthesize `card` from available data: `title` from `ticket.title` or the slug;
  `type: 'feature'`; `scope: ''`; empty checklist/attachments/knowledgeRefs;
  `source` from `ticket?.source ?? 'native'`; `createdAt` = file mtime or now.
- `stage` = `deriveStage(phases, run)`.
- `settings.maxConcurrentRuns` defaults to 3 if absent.
- Write back atomically.

## Validation rules

- `CardBrief.title` MUST be non-empty before `card-move` out of `backlog` or handoff (FR-010) → handlers return `{ error: 'VALIDATION_ERROR', message }`.
- `CardType` MUST be one of the enum values (schema-validated).
- `card-move` MUST reject non-adjacent stage transitions (FR-005) → `{ error: 'VALIDATION_ERROR', message }`.
- `maxConcurrentRuns` MUST be ≥ 1.
- Final review + open-PR gates remain non-auto-approvable (unchanged from existing state machine; FR-023).
