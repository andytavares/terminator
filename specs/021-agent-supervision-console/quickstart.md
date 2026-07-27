# Quickstart: Validating the Agent Supervision Console

**Feature**: `021-agent-supervision-console` | **Date**: 2026-07-26

Runnable validation per delivery phase. Each scenario maps to a success criterion in [spec.md](./spec.md) and is the thing you actually run to decide whether the phase is done. Entity shapes are in [data-model.md](./data-model.md); contracts are under [contracts/](./contracts/).

## Prerequisites

```bash
node --version          # 20 LTS or newer
git --version
gh auth status          # required for check status (P5); unauthenticated is a valid test case
npm install
npm run build:extensions
npm run dev
```

## The gate every phase must pass

Constitution VI and the project's done-checklist. Run from the repo root, all three must succeed:

```bash
npm run format
npm run lint                    # 0 errors
npx vitest run --coverage       # all pass, >= 80% statements/branches/functions/lines
```

Plus the two boundary lint clauses, which should fail loudly if violated:

```bash
# Should error: SDK imported outside the seam
echo "import { query } from '@anthropic-ai/claude-agent-sdk'" > src/main/scratch-probe.ts
npm run lint                    # expect: no-restricted-imports error
rm src/main/scratch-probe.ts
```

---

## P1 — Substrate (US1) → SC-001, SC-010

1. Start a supervised session against a scratch repository.
2. Give the agent an instruction that requires a shell command it must ask about.
3. **Without opening the session**, watch the session list.

**Expected**: state reaches `needs_input` within 2 s and names the requested command (SC-001, FR-007). Approving from the list returns it to `working`.

4. Let it finish with edits. **Expected**: `ready`.
5. Quit the app while a session is running. Reopen.

**Expected**: state is reconstructed from the transcript and matches reality, or is explicitly `unknown` — never `working` without evidence (FR-009, SC-010).

6. Break the driver deliberately (kill the child process mid-session).

**Expected**: the transcript tailer keeps the session's state current; the transcript wins reconciliation (FR-006).

---

## P2 — Provisioning (US5) → SC-005, SC-008

```bash
cat > .terminator/config.json <<'EOF'
{
  "worktree": {
    "symlink": ["node_modules"],
    "copy": [".env.local"],
    "portBase": 4000,
    "portSpan": 10
  },
  "scripts": { "setup": "npm ci --ignore-scripts" }
}
EOF
```

1. Provision a working copy for a work item on your **largest** repository.

**Expected**: buildable and runnable with zero manual steps; `node_modules` shared not copied; `.env.local` present (SC-005).

Automated equivalent: `npx vitest run tests/integration/supervision/provisioning.spec.ts` — a real git repository, a real setup script, and the production provisioner.

2. Provision a second working copy of the same repository concurrently.

**Expected**: non-overlapping port spans; both dev servers start (SC-008).

3. Set `setup = "exit 3"` and provision again.

**Expected**: session `failed`, exit status and output retained and visible from the session list, **no agent started** (FR-034).

4. Try to archive a running session. **Expected**: refused (FR-036).
5. Archive a stopped one. **Expected**: teardown runs, worktree removed (FR-035).

---

## P3 — Stall detection (US2) → SC-002

Shadow mode is **on by default**. Everything here is recorded, nothing is surfaced.

1. **Silence**: start a session, suspend the agent process for 9 minutes.
   **Expected**: one firing recorded, `signal: silence`. Session state stays `working`, no notification, no feed entry (FR-018).

2. **The important negative**: run a session whose task is a 12-minute test suite.
   **Expected**: **no firing**. This is the exemption in FR-015 and the spec's named "obvious first bug" — if this fires, the feature is not shippable.

3. **Loop**: instruct the agent to satisfy an impossible constraint in one file.
   **Expected**: firing with `signal: loop` after the no-progress threshold.

4. **Revert**: induce two self-reverts within ten edits.
   **Expected**: firing with `signal: revert`.

5. Judge each recorded firing correct/incorrect, then open the precision report.
   **Expected**: proportion judged incorrect over the chosen period (FR-020). SC-002's target is < 10% over a week of real work before shadow mode is turned off.

6. Turn shadow mode off, re-run scenario 1.
   **Expected**: session enters `stalled`, feed entry attributed to **the console** not the agent, notification fires, and the four actions are offered (FR-019, FR-021, FR-092).

---

## P4 — Attention (US3) → SC-003

Set up sessions across ≥ 2 repositories covering every runtime state.

1. Open the Attention Queue.
   **Expected**: ordered blocking requests → stalls → failures → awaiting review, **not** grouped by repository (FR-022). Full state of everything readable in under 30 s (SC-003).

2. Approve the top permission request inline.
   **Expected**: decision reaches the agent, item leaves the list, session never opened (FR-023).

3. Resolve everything.
   **Expected**: the surface **states** that nothing needs attention — not a blank screen (FR-024). Silence must not be the way the UI says "fine".

4. Check the status bar on every surface.
   **Expected**: needs-input / working / awaiting-review / failed counts plus age of oldest blocked session (FR-025).

5. Open the palette, type a fragment matching a session, a work item, a repository, a worktree, and a command.
   **Expected**: all five entity types in one ranked list (FR-026). _If this is hard to build, the substrate is wrong — treat it as a design signal, not a UI bug._

6. Open a session you last viewed an hour ago.
   **Expected**: a summary of what changed since (FR-027).

---

## P5 — Review and backpressure (US4) → SC-004, SC-009, SC-011(merge audit), SC-012

Produce four finished sessions: one touching `src/auth/**`, one > 300 lines, one ordinary, one lockfile-only with green checks.

1. Open the Review Inbox.
   **Expected**: order P0 → P1 → P2 → P3, each showing the **specific** trigger for its grade (FR-046, FR-050).

2. Walk the P0 item through review.
   **Expected**: intent step first — original request vs. the agent's own account, with out-of-scope work called out — then risk, structure, tests (FR-051).

3. Accept some hunks in a file and reject others.
   **Expected**: only accepted changes retained (FR-052).

4. With 3 unreviewed items, start a fourth agent.
   **Expected**: refused, reason and current count stated (FR-053). Override in one action; check the override was recorded with timestamp and queue depth (FR-054, SC-004).

5. **Check-state safety**: `gh auth logout`, then queue a lockfile-only change.
   **Expected**: `checkState: unavailable`, **not** P3, and unattended merge does not fire (FR-057, FR-062). Re-authenticate and confirm it becomes P3.

6. Enable `unattended_merge_lowest_grade = true` for one repository only.
   **Expected**: no global switch exists (FR-059). A green P3 in that repository merges unattended and is recorded; the same change in another repository still waits (FR-058, FR-060).

7. Open the unattended-merge view.
   **Expected**: every unattended merge listed with change summary, grade trigger, and check state (FR-061, SC-012).

---

## P6 — Work items (US6) → SC-011

1. With **no producer installed**, use the app.
   **Expected**: every surface works; sessions supervised as ad-hoc; intake and gate actions state that no producer is installed (FR-081, FR-078).

2. Hand-write a contract file into the publication directory per [work-item.contract.md](./contracts/work-item.contract.md).
   **Expected**: appears on the board with no refresh (FR-071). Confirms the console is producer-agnostic (FR-080).

3. Truncate that file mid-write.
   **Expected**: that one item is `unreadable`; every other item and surface unaffected (FR-085).

4. Set `contract_version: 99`.
   **Expected**: `unreadable` with a version reason — never a partial parse.

5. Publish the same `id` from two producer directories.
   **Expected**: both flagged as conflicted, naming both producers. Never a silent pick (FR-074).

6. Bind a session to a lane, then diff the producer's directory.
   **Expected**: **byte-for-byte unchanged** (FR-073, FR-075). This is the single sharpest test of the boundary.

7. Attempt implementation with the plan gate unapproved.
   **Expected**: refused, missing gate named (FR-083).

**The SC-011 test** — run this before calling P6 done:

```bash
mv extensions /tmp/extensions-parked
npm run build && npm run dev
```

**Expected**: core builds, starts, and delivers every capability in the spec except work-item intake and gate actions, which state that no producer is installed. No supervision surface missing or degraded. Then `mv /tmp/extensions-parked extensions`.

---

## P7 — Lanes and feed (US7, US8) → SC-006

1. Publish a three-lane work item sharing `proto/session.proto`.
   **Expected**: three rows in merge order; the shared file flagged on **every** lane that touches it (FR-086, FR-087).

2. Finish lane 2 first and try to merge it.
   **Expected**: refused, blocking lane named (FR-088, SC-006).

3. Merge lane 1 with a change to the shared file.
   **Expected**: lanes 2 and 3 flagged as needing rebase/re-run (FR-090).

4. Publish a one-lane work item.
   **Expected**: one row, no multi-repo ceremony (FR-089).

5. Leave several agents running, return, open the feed.
   **Expected**: chronological written summaries, not raw transcript; console-authored entries clearly attributed (FR-091, FR-092); an inline reply reaches the right session (FR-093).

6. Mute a session, trigger an event on it.
   **Expected**: feed entry present, no notification (FR-029).

---

## Regression: agent runtime upgrade → SC-007

```bash
npm install @anthropic-ai/claude-agent-sdk@<older-pinned-version>
npx vitest run tests/unit/main/supervision
npm install @anthropic-ai/claude-agent-sdk@<current>
npx vitest run tests/unit/main/supervision
git diff --stat                 # expect: changes only under agent-runtime/ and its tests
```

**Expected**: no regression in reported state, and any change needed to absorb the upgrade is confined to `src/main/supervision/agent-runtime/` and its tests. A diff touching the state machine, the detector, the review queue, or a surface means the seam has leaked and SC-007 has failed.

---

## Validation run — 2026-07-27

Recorded results for the checks that can be run without a live agent session.

| Check                                                                       | Result                                                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format`                                                            | PASS                                                                                                                            |
| `npm run lint`                                                              | PASS — 0 errors (24 pre-existing react-hooks warnings)                                                                          |
| `npm run build`                                                             | PASS                                                                                                                            |
| `npx vitest run --coverage`                                                 | PASS — 5598 tests, 94.23 / 86.58 / 90.27 / 95.47, every new file ≥80% on all four metrics                                       |
| Seam lint probe (SDK imported outside `agent-runtime/`)                     | PASS — errors as designed                                                                                                       |
| Core↔extension boundary scan                                               | PASS — no file under `src/` resolves an import into `extensions/`                                                               |
| **SC-011** — `mv extensions /tmp && npm run build`                          | **PASS** (required fixing `scripts/build-extensions.cjs`, which crashed on an absent directory)                                 |
| **SC-007** — SDK 0.3.196 → 0.3.220 sweep                                    | **PASS** — 618 supervision tests identical on both, zero source changes                                                         |
| **SC-001** — permission visible in <2s                                      | PASS — measured through the real substrate and the real IPC handler in `tests/integration/supervision/success-criteria.spec.ts` |
| **SC-003** — all session state from one surface                             | PASS — measured in the same suite                                                                                               |
| **SC-004, SC-008, SC-009, SC-010, SC-012**                                  | PASS — asserted in `success-criteria.spec.ts` and `session-lifecycle.spec.ts`                                                   |
| **FR-015 shippability gate** — a 12-minute shell command produces no firing | PASS                                                                                                                            |

### Two defects this run found

1. **`scripts/build-extensions.cjs` crashed when `extensions/` was absent**, failing SC-011 on the first attempt. Guarded.
2. **The session schema required a non-empty `transcriptPath`**, so any session in `starting` — before the runtime reports one — was silently dropped from every listing surface, breaking SC-001 and SC-003. `transcriptPath` is now `string | null` end to end.

### Still requires a person

Phases P1–P7 walked by hand against **real agent sessions** — inducing a genuine stall, provisioning on your largest repository, reviewing a real diff. The mechanisms are verified above against the real substrate with a faked runtime; what a human still has to judge is whether the stall thresholds are right for your work, which is exactly what shadow mode exists to answer.

Start at § P1 and leave shadow mode on until the precision report earns your trust.
