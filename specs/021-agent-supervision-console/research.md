# Phase 0 Research: Agent Supervision Console

**Feature**: `021-agent-supervision-console` | **Date**: 2026-07-26

Every decision below is grounded in vendor documentation or in a fact verified against this repository. Where a PRD claim could not be confirmed, that is stated explicitly rather than assumed.

---

## R1 — Agent driver: `@anthropic-ai/claude-agent-sdk`

**Decision**: Drive supervised sessions with `@anthropic-ai/claude-agent-sdk`, pinned to `0.3.220`, in the main process only.

**Rationale**: The SDK provides the three things state derivation needs, without any output parsing:

| Need (spec)                                  | SDK mechanism (documented)                                 |
| -------------------------------------------- | ---------------------------------------------------------- |
| `needs_input` state, FR-007, FR-040          | `canUseTool` callback                                      |
| Cost, turns, terminal outcome — FR-008       | `SDKResultMessage`                                         |
| Interrupt a running session — FR-021, FR-043 | `Query.interrupt()`                                        |
| Deny + interrupt in one step                 | `PermissionResult` `{ behavior: 'deny', interrupt: true }` |
| Session lifecycle events — FR-005            | `hooks` option                                             |

Documented signatures (Claude Agent SDK TypeScript reference, via Context7 `/nothflare/claude-agent-sdk-docs`):

```typescript
type CanUseTool = (
  toolName: string,
  input: ToolInput,
  options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }
) => Promise<PermissionResult>

type PermissionResult =
  | { behavior: 'allow'; updatedInput: ToolInput; updatedPermissions?: PermissionUpdate[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean }

interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>
  setPermissionMode(mode: PermissionMode): Promise<void>
  // …
}
```

`SDKResultMessage` (success variant) carries `session_id`, `num_turns`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`, `duration_ms`. Error variants carry `subtype` of `error_max_turns | error_during_execution | error_max_budget_usd | error_max_structured_output_retries` — this is the direct source for `failed` (FR-001).

**Alternatives rejected**:

- _Wrap the CLI in a PTY and parse output._ Forbidden by the spec (FR-005) and by the PRD's cited precedent (Omnara archived at 2.6k stars for exactly this maintenance burden). The existing `node-pty` path stays for ordinary terminal sessions and is untouched.
- _Hooks alone, no SDK._ Hooks cannot express a permission decision, so `needs_input` would be unobservable. The PRD's load-bearing correction — that the `Notification` hook does not fire on permission prompts — makes `canUseTool` the only documented source. FR-010 encodes this.

**Dependency stewardship (Constitution IV)**: Anthropic-published, first-party, released continuously. It is `0.x`, so the version is pinned exactly (no caret) and every upgrade is gated on the boundary test suite in R2. This is a direct justification for the seam, not an incidental benefit.

---

## R2 — The agent-runtime seam (FR-002 – FR-004)

**Decision**: One module, `src/main/supervision/agent-runtime/`, is the sole place that imports `@anthropic-ai/claude-agent-sdk` or knows a transcript's shape. It emits a `SessionEvent` union that contains no SDK type. An ESLint `no-restricted-imports` rule forbids importing the SDK anywhere else under `src/`.

**Rationale**: SC-007 requires that a runtime upgrade cause no state-reporting regression, and that any change absorbing an upgrade stay inside this boundary. A lint rule makes that mechanically enforced rather than a convention. One implementation only — no registry, no second adapter, not on the Extension API (FR-004) — so Constitution VII (YAGNI) is satisfied: this is a seam justified by a present requirement, not an abstraction anticipating a second runtime that is an explicit non-goal.

**Alternatives rejected**: SDK types flowing into the state machine and surfaces (least code today, but a `0.x` shape change then edits the detector, the queue, and every surface at once — the failure SC-007 exists to prevent).

---

## R3 — Transcript location: **solved, not guessed**

**Decision**: Never compute a transcript path. Take `transcript_path` from hook input.

**Rationale**: Every hook payload extends `BaseHookInput`:

```typescript
type BaseHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
}
```

This is a documented field on every hook event. The PRD's proposed `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` derivation — which depends on an undocumented directory-name encoding — is therefore unnecessary and is **rejected**. `SessionStart` gives us the path at session start; the tailer opens what it is told.

**Consequence**: FR-006 (survive driver loss, reconcile in favour of the durable record) is implementable with no guessed path. FR-009 (re-adopt on restart) requires only that we persist the last known `transcript_path` per session.

**Open, deferred to implementation**: the per-line JSONL schema is not a published contract. The tailer must therefore read defensively — extract only the fields it needs (timestamp, event kind, tool name, file path), tolerate unknown line shapes, and never fail a session because a line did not parse. This is contained inside the R2 boundary.

---

## R4 — Stall detection design (FR-011 – FR-021)

**Decision**: A pure function `evaluateStall(facts: SessionFacts, thresholds: StallThresholds, now: number): StallFiring | null`, called from a 30-second scheduler. No I/O, no clock access inside — `now` is injected.

**Rationale**: Constitution XI (functional purity) and testability. Every threshold case, the long-command exemption, and the loop/revert signals become table-driven unit tests with no fakes and no timers.

**The long-running-command exemption (FR-015) is the load-bearing detail.** The PRD calls it "the obvious first bug". Implementation: the boundary tracks command-in-flight from the `PreToolUse`/`PostToolUse` pair for shell tool calls. While a shell call is open, its elapsed time is excluded from `tool_silence`. Without this, a 12-minute test suite reads as a stall on every run.

**Signals** (any fires):

| Signal  | Condition                                                                                        | Default |
| ------- | ------------------------------------------------------------------------------------------------ | ------- |
| silence | `now − last_tool_activity > T_silence`, excluding in-flight command time                         | 8 min   |
| loop    | `now − last_net_change > T_nodiff` **and** last 8 tool calls touch one file with zero net change | 15 min  |
| revert  | ≥ 2 self-reverts within last 10 edits                                                            | —       |

**Shadow mode (FR-018, default on)**: modelled as a single boolean read at the _surfacing_ step, never inside `evaluateStall`. Firings are always recorded (FR-017); only the consequence is gated. This keeps one code path — there is no separate shadow implementation to maintain, and precision measurement (FR-020) works identically in both modes.

---

## R5 — Working copy provisioning (FR-030 – FR-038)

**Decision**: Build on the core git service that already exists. Verified in this repo: `src/main/git/git-service.ts` already exports `createWorktree`, `removeWorktree`, `listWorktrees`, `suggestWorktreePath`, `createBranch`. The worktree manager adds only what is missing — sharing, copying, port allocation, and the setup/teardown lifecycle.

**Rationale**: No new git plumbing, no new dependency, and it keeps provisioning in core where FR-063 requires it.

**Sharing heavy directories (FR-031)**: symlink the declared gitignored directories from the primary checkout into the worktree. This is the one published fix for the category's top complaint. **Documented risk**: it is wrong when the primary checkout is mid-install or on a different dependency set — the spec's own edge case. Mitigation is honest rather than clever: the setup command runs after linking, and a non-zero exit surfaces as `failed` with output attached (FR-034), so a broken link presents as a failed setup rather than a mysteriously broken agent.

**Port allocation (FR-033)**: allocate a contiguous span from the repository-declared base, skipping spans already held by a live worktree, and verify each candidate base is actually free by attempting a bind before committing. Exported as `TERMINATOR_PORT_BASE`, `TERMINATOR_WORKTREE`, `TERMINATOR_WORKITEM`.

**Configuration (FR-037) — RESOLVED 2026-07-26 (task T007): `.terminator/config.json`, not TOML.**

Version-controllable and travels with the repository either way. JSON wins on three counts:

- **No new dependency.** TOML needs a parser; Constitution IV requires stdlib be used where it fully satisfies the requirement, and `JSON.parse` does.
- **Validation is already solved.** Zod is a core dependency at `3.23.8`, so the config schema, its defaults, and its error messages come from machinery already in the codebase.
- **The PRD's TOML choice was aesthetic, not functional.** Nothing in the config shape needs TOML's ergonomics — it is flat sections of scalars and string arrays.

Cost accepted: comments are not expressible in JSON, so the documented example config carries its explanations in prose in `docs/user-guide/` rather than inline. Contract updated accordingly.

**Databases (FR-038)**: explicitly not solved. The setup/teardown commands are the extension point; documentation names Neon/Supabase branching and per-worktree Docker as the two known patterns. Do not pretend otherwise.

---

## R6 — Code-host client in core (FR-056, FR-057)

**Decision**: Core gains `src/main/codehost/`, shelling out to the `gh` CLI, mirroring how core already shells out to `git`.

**Verified fact**: `src/main/git/` exists and is populated; `src/main/github/` **exists but is empty**. All `gh` logic currently lives in the `git-integration` extension. Under FR-065 core cannot call into it, so core needs its own client. This was a live contradiction in the spec before clarification, not a hypothetical.

**Rationale**: An external CLI is the same class of dependency core already accepts. It keeps the boundary clean with no new npm dependency and no auth handling of our own (`gh auth login` owns that).

**Failure posture (FR-057)**: check state resolves to `unavailable` — never `passing` — when `gh` is absent, unauthenticated, offline, or reports no checks. FR-062 then blocks unattended merge. The safe direction is the default direction.

**Accepted cost**: some `gh` calls will be made from both core and the `git-integration` extension. Recorded in the spec's Assumptions as the price of the boundary. A follow-up may let the extension consume core's client via the Extension API; that is out of scope here.

---

## R7 — Work item contract transport (FR-070 – FR-074)

**Decision**: A console-owned publication directory under the app's user-data path, one JSON file per work item, schema validated with Zod (already a core dependency at `3.23.8`), watched with a file watcher.

**Rationale**: The console defines the location and the schema, so it never reads inside a producer's directory and holds no knowledge of any producer's layout (FR-072). Zod is already in core, so validation costs no new dependency and gives FR-085 (tolerate malformed input) for free — a parse failure marks one item unreadable and touches nothing else.

**Schema versioning** — the carry-over from clarification: every contract file carries a `contract_version`. The console accepts versions it knows, and renders an item published under an unknown _major_ version as unreadable-with-reason rather than attempting a partial parse. This is a published contract; it needs the discipline of one.

**Watcher — RESOLVED 2026-07-26 (task T008): `node:fs.watch` with `recursive: true`, debounced, triggering a full re-scan. No new dependency.**

Spiked against a real publication-directory layout on Node 24 / macOS. `fs.watch` fired on all four mutation classes that matter: atomic create (temp-file write + rename), in-place modify, a **newly created producer subdirectory** with a file in it, and delete.

The design deliberately does not trust the event payload. `fs.watch` is documented as unreliable about _which_ file changed and can coalesce or duplicate events — the spike saw 2 events for a single atomic create. So the watcher treats every event as an untyped "something changed" signal, debounces, and re-scans the whole publication directory. The tree is shallow (`<producer-id>/<work-item-id>.json`), low-churn, and small, so a re-scan is cheap and immune to the failure modes that would otherwise argue for `chokidar`.

`chokidar` was rejected: it is currently an _extension_ dependency, so adopting it here would add a genuinely new core dependency to solve a problem the standard library already solves. Constitution IV forbids that.

**Producer actions (FR-077)**: outbound only through Extension API command contributions the producer registers. Where a required command is unregistered, the item is read-only with a stated reason (FR-078) — no failure, no silent no-op.

---

## R8 — Multi-repository lanes: the PRD's own open question

**PRD question**: "Does `/speckit.plan` reliably emit anything lane-shaped, or does that need a custom template?"

**Answer for this plan**: it does not matter, and that is the point of the clarified boundary. Lanes are a field in the console's contract schema. Whether any given producer populates them — from a template, from a plan step, or by hand — is entirely the producer's problem. A contract with one lane renders as one row (FR-089) and multi-repository ceremony disappears.

**Consequence**: User Story 7 is unblocked at the console side regardless of producer capability, and the PRD's "week or a month" uncertainty is removed from this feature's critical path.

---

## R9 — Storage

**Decision**: `electron-store` (already core at `^8.2.0`) for configuration, shadow-mode state, lane bindings, backpressure overrides, and unattended-merge records. Append-only JSONL under the app's user-data path for the two high-volume, growing logs: stall firings and feed entries.

**Rationale**: Reuses what is already there for small keyed state, and avoids loading an ever-growing firing log into memory as a single JSON blob. No new dependency either way. `pglite` and `sql.js` exist in the tree but are extension dependencies, not core — using them here would violate the boundary.

---

## R10 — Surfaces

**Decision**: Core React surfaces under `src/renderer/components/supervision/`, Zustand stores under `src/renderer/stores/`, matching existing core patterns (`session.store.ts`, `workspace.store.ts`, `notification.store.ts`).

**Rationale**: FR-064 requires every surface to work with no extensions installed, so they are core. Core already carries substantial UI (command palette, overview screen, notification centre, metrics bar) — this is the established pattern, not a departure.

**One query, three renderings**: the PRD's strongest structural observation is that the Attention Queue, the Standup Feed, and the palette are three views of "what needs me, ranked". Build `rankAttention(sessions, workItems, reviewQueue)` once as a pure function; all three consume it. If the palette is hard to build, the substrate is wrong — that remains a useful check on the design.

**Icons**: `lucide-react`, flat, `currentColor`, sized via CSS (Constitution XII).

---

## Unresolved — deliberately deferred to task time

| Item                               | Why deferred                       | Constraint                                          |
| ---------------------------------- | ---------------------------------- | --------------------------------------------------- |
| Feed milestone summarisation model | Cost/quality tuning, not structure | Cheap model, one call per milestone                 |
| Transcript JSONL line schema       | Not a published contract           | Contained inside the R2 boundary; parse defensively |

**Closed during implementation** (both were listed here at planning time):

- _Config format_ — resolved in R5 (task T007): JSON, no new dependency.
- _Watch mechanism_ — resolved in R7 (task T008): `node:fs.watch`, spiked, no new dependency.

**No NEEDS CLARIFICATION remains in Technical Context.**

---

## R11 — RESOLVED: the SDK required Zod 4; the repository migrated

**Status**: resolved 2026-07-26. Task T001 unblocked. Full record in `docs/adr/030-zod-4-migration.md`.

`@anthropic-ai/claude-agent-sdk@0.3.220` peer-requires `zod@^4.0.0`; six manifests pinned `zod@3.23.8`. Downgrading the SDK does not help — `0.2.0` already required Zod 4.

Migrated the repository to `zod@4.4.3` rather than forcing the install with `--legacy-peer-deps`. The SDK validates its own protocol messages with Zod, so a knowingly unsupported major would risk silent misvalidation in the layer that produces session runtime state.

Two breakages surfaced, both caught by the existing suite:

- **`.uuid()` is RFC-strict in Zod 4.** Eleven test fixtures used ill-formed placeholder UUIDs. Production is unaffected (`crypto.randomUUID()` everywhere), so the fixtures were corrected rather than the schema loosened.
- **`z.record()` with an enum key is exhaustive in Zod 4.** `speckit-pilot` keys `phases` and `phaseGates` by a phase-id enum, and real state files are always partial. Unfixed, `readState()` would have returned `null` for every existing `.pilot/state.json` — silent data loss. Five call sites moved to `z.partialRecord()`.

The SDK's own peers (`@anthropic-ai/sdk@0.115.0`, `@modelcontextprotocol/sdk@1.29.0`) resolved transitively; neither needed a manifest entry. `extensions/speckit-pilot` now declares its own `zod` dependency, repaying a Constitution II violation found on the way.
