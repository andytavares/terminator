# Quickstart: proving Foundry works

**Feature**: `037-foundry-software-factory` | **Date**: 2026-09-06

How to validate this feature end to end. Every scenario names the success criterion or requirement it proves. Nothing here is a substitute for the unit specs — these are the checks that catch what unit tests pass right through.

## Prerequisites

```bash
node --version          # must match .nvmrc
npm ci
npm run build:extensions
```

A tracker must be connected in application settings for scenarios 7 and 8; the rest run without one.

Two scratch repositories are needed, and **neither may be this one**:

```bash
# A: a JavaScript project with a full toolchain
git init /tmp/fdry-a && cd /tmp/fdry-a
npm init -y && npm pkg set scripts.test="node --test" scripts.lint="echo ok"
git add -A && git commit -m "init"

# B: a project with no toolchain at all — no package.json, no CI, no conventions
git init /tmp/fdry-b && cd /tmp/fdry-b
printf 'print("hi")\n' > main.py && git add -A && git commit -m "init"
```

Repository B is the important one. Every other check would pass in a repository that happens to have a constitution and a `.specify/` directory, which is exactly the assumption this feature exists to remove.

## The gate — run before claiming anything is done

From the worktree, in this order. All four must pass.

```bash
npm run format
npm run lint                                  # must be 0 errors
npx vitest run --coverage
node scripts/check-patch-coverage.cjs         # per-file ≥80% on staged files
```

`npx vitest run --coverage` alone reports project-wide totals and will not catch a new file at 0%. Check the exit status of each command; a printed pass count is not a verdict — which is the same rule Foundry itself enforces as `exit-code-not-count`.

---

## Scenario 1 — The compile gate refuses an incomplete plan

**Proves**: FR-010, FR-011, SC-004. The single highest-value check in the feature.

```bash
npx vitest run extensions/foundry/tests/order/compile.spec.ts
npx vitest run extensions/foundry/tests/order/coverage-matrix.spec.ts
```

**Expected**: an order with a criterion no unit satisfies fails check 3 and the failure names that criterion id. An order with a unit satisfying no criterion fails the same check and names that unit id. An order failing both reports both. `CompileResult.ok` is false in every case and `status` is unchanged.

The negative case matters as much: a complete order returns `ok: true` and exactly zero failures. A checker that never passes is as useless as one that never fails.

---

## Scenario 2 — A one-line change, end to end

**Proves**: US1, US2, US3, US6, SC-001, SC-002.

In the running application, pointed at repository A: seed "the greeting should say hello, not hi", let intake converge, agree the order, and let it run.

**Expected**:

1. A complete draft order appears before you are asked anything.
2. Every criterion carries an executable proof, and the commands in it are the ones repository A actually has (`node --test`, not a guess).
3. At most three open questions, each with a recommended answer.
4. The `direct` recipe is proposed, with the reason shown.
5. A draft pull request opens without you approving its creation.
6. **Count your decisions.** One, beyond seeding: mark ready. If it is more than two, SC-002 has failed and the gate rules are wrong.

---

## Scenario 3 — A repository with nothing in it

**Proves**: US4, FR-069 through FR-073, SC-003. The portability claim, and the one scenario that cannot be faked by running in this repository.

Point Foundry at repository B and seed "add a docstring to main".

**Expected**:

1. Intake proceeds. No setup step. No prompt to initialise anything.
2. `context.json` records `toolchain.test`, `lint`, `coverage` and `e2e` as `null`, each with the reason.
3. Before work starts you are told which checks will be unavailable — the absence is a decision you make, not a surprise at the end.
4. The `speckit` recipe is **not offered**; its `path_exists: .specify/` requirement is unmet, and the reason is available.
5. Work completes and a draft pull request opens.

Then the footprint check:

```bash
cd /tmp/fdry-b && git status --porcelain
```

**Expected**: the change, and — only if you used the default records location — one untracked `.foundry/` directory you were warned about. Nothing else. No config file, no marker, and `.gitignore` untouched.

---

## Scenario 4 — "Not measured" never reads as a pass

**Proves**: FR-039, FR-072, SC-007. The failure mode that makes an unattended factory dangerous.

Still in repository B, where there is no coverage command:

```bash
npx vitest run extensions/foundry/tests/verify/verdict.spec.ts
npx vitest run extensions/foundry/tests/verify/toolchain-probe.spec.ts
```

**Expected**: the coverage verdict is `not_measured` with a reason, is rendered distinctly from `pass` on the Floor and in the pull request body, and does not satisfy any criterion. An order with an unmeasured `P0` criterion cannot reach `shipped`.

Assert the third value explicitly. A boolean coercion anywhere in this path turns "we did not check" into "it is fine", which is precisely the bug.

---

## Scenario 5 — Work is not checked by whoever did it

**Proves**: FR-032, FR-033, SC-006. The model's most important invariant.

```bash
npx vitest run extensions/foundry/tests/line/roles.spec.ts
npx vitest run extensions/foundry/tests/verify/ladder.spec.ts
```

**Expected**: the verifier role has `allowResume: false` and an empty write allowlist; the runner refuses to start a verifier with a `resumeSessionId`; a verdict whose `producedBy.sessionId` equals its node's `sessionId` is rejected by the schema.

Then the behaviour, in the application: complete a unit whose tests pass but which does not actually meet its criterion. The verifier rejects it and cites what it looked at. A unit failing twice raises a gate on the third attempt rather than trying again.

---

## Scenario 6 — Take over an agent mid-run

**Proves**: FR-027, FR-028, SC-009.

With an order running, from each of the Inbox, the Forge and the Floor: choose Attach on any running agent.

**Expected**: you land in that agent's live terminal session and can type to it. Type something, return to the structured view, and it reflects what happened — it watches the transcript, not the process, so it does not lose track.

Reaching the session takes one action from any surface. Two is a failure of SC-009.

---

## Scenario 7 — The tracker keeps itself in step

**Proves**: US6, FR-058 through FR-063, SC-010. Requires a connected Linear workspace. Workflow moves are built for Linear only; comments and links work for any connected tracker.

Core first:

```bash
npx vitest run tests/unit/main/integrations/
```

**Expected**: Linear resolves an intent by state `type`, never by name, and `issueUpdate` receives the resolved `stateId`; an intent with no available option rejects distinguishably instead of silently succeeding. `supportsTransitions('jira')` is false and `transition` on Jira rejects with the `unsupported` error, which is a _different_ error from a failure — the caller retries one and not the other. The existing Jira provider specs still pass unmodified; this feature does not touch that file.

Then end to end: seed an order from a Linear issue, agree it, run it.

**Expected**: the issue receives the order summary as a comment on agreement; its state moves on start, on draft pull request and on merge; every pull request appears on it. With the tracker unreachable, the work is unaffected, the failure is recorded and it is retried.

Then the unsupported path: seed an order from a Jira issue.

**Expected**: at the moment the order is agreed — not when the first write is due — you are told that state write-back is unavailable for this tracker. The comment and the pull-request link are still written. Nothing fakes the move by posting a comment claiming the issue moved.

---

## Scenario 8 — One order, two repositories

**Proves**: US7, FR-065 through FR-068, SC-011.

Seed an order that changes a shared file in repository A and adopts it in repository B.

**Expected**: two lanes with a declared merge order; the shared file named as a predicted collision **before** either lane starts; lane 2 held until lane 1 has merged; one draft pull request per repository, cross-linked. Then run a single-repository order and confirm none of this is visible — FR-068 makes the lane machinery invisible when there is one lane.

---

## Scenario 9 — Nothing dead is left behind

**Proves**: Constitution X, and the removal task's own acceptance criterion.

```bash
for s in PhaseId PHASE_ORDER PHASE_LABELS QUICK_PHASES PHASE_COMMANDS \
         QUICK_PHASE_COMMANDS PLAIN_PHASE_COMMANDS DEFAULT_PHASE_GATE; do
  echo "== $s"; grep -rn "$s" extensions/foundry/src src/ | grep -v test
done

grep -rn "speckit-pilot\|terminator.speckit" src/ extensions/foundry/src/
grep -rn "TODO\|FIXME\|not yet implemented" extensions/foundry/src/
```

**Expected**: every command prints nothing. A green test suite does not prove this — a spec for a deleted module passes right up until it is deleted with it, so every spec whose subject is gone must be gone too.

---

## Scenario 10 — It renders, and it renders in both themes

**Proves**: US5, Constitution XII, and the lesson that structural assertions pass while the UI renders broken.

```bash
npx playwright test tests/e2e/foundry.spec.ts
```

The extension's UI is an overlaid `WebContentsView`, so Playwright's `page` cannot see it and ordinary screenshots come back empty. Read it through `electronApp.evaluate` over `getAllWebContents` and capture with `capturePage`. Address elements by role and accessible name, never by CSS class — a class name is a refactor away from breaking a test that guards nothing a user sees.

**Expected**: all four surfaces render; the inbox is ordered by rank with the highest first; every row names the rule that raised it; icons are flat and inherit `currentColor`; both themes are legible. **Look at the screenshots.** Every UI failure in this project's history passed its structural assertions first.

---

## What "done" means for this feature

- The gate above passes, checked by exit status.
- Scenarios 1–10 pass, including scenario 3 in a repository that is not this one.
- `README.md`, `extensions/foundry/CLAUDE.md`, the user-guide screenshots naming the SpecKit tab, and `CHANGELOG.md` are updated in the same pull request (Constitution VIII).
- ADRs 040, 041 and 042 are written, 041 explicitly superseding the write restriction adopted in feature 031.
