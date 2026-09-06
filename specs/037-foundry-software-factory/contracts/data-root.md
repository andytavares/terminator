# Contract: the data root and the repository footprint

**Feature**: `037-foundry-software-factory` | **Date**: 2026-09-06 | **ADR**: 042

Two promises, and they constrain each other: Foundry works in any repository with nothing installed into it, and the operator chooses where its records go.

## The footprint promise

**Foundry creates or modifies exactly one thing in a target repository: the change the order asked for.** No scaffolding, no init, no committed configuration, no marker file — and explicitly **no `.gitignore` entry**, not even for its own default directory (FR-070).

That last exclusion is deliberate and costs something. When the operator takes the default location, `<workdir>/.foundry/` is an untracked directory in their repository and Foundry will not tidy it away for them, because tidying it away means editing a file the order did not ask to change. The operator is told once, at first write, and told that configuring a single location avoids it entirely.

The test for this promise is mechanical and belongs in e2e: run a complete order in a scratch repository, then `git status --porcelain` and confirm nothing appears beyond the change and — where the default location was used — the one untracked directory the operator was warned about.

## Resolution

One setting, `terminator.foundry.dataDir`, registered via `api.settings.register`. Resolved **once at activation** by a single module; every writer receives an absolute path and never resolves it again (R9).

| Setting          | Root                            | Notes                                                                   |
| ---------------- | ------------------------------- | ----------------------------------------------------------------------- |
| empty (default)  | `<workdir>/.foundry/`           | Beside the repository. Operator warned once that it is untracked.       |
| an absolute path | that path                       | Every order, every repository, one root. The recommended configuration. |
| a relative path  | rejected at settings-write time | Ambiguous once an order spans repositories, so it is never accepted.    |

Writability is checked **when an order starts**, not at first write (FR-075). An order that fails half way through because a directory could not be created has already spent agent time, and the message arrives attached to the wrong thing. The failure names the path and the reason, and no work begins.

A multi-repository order has no single working directory, so with the default setting its root is the working directory of lane 1. This is a real wart, and it is the strongest practical argument for configuring a single location — the recommendation exists for this reason, not for tidiness.

## Layout

```text
$FOUNDRY_DATA/
  config.yaml                  # autonomy, budgets, critical paths per repository
  recipes/  *.yaml             # operator's own; resolution rung 1
  roles/    *.yaml
  rules/    *.yaml
  orders/
    WO-0913-c71/
      order.json               # the contract; the truth
      order.md                 # rendered; regenerated, never hand-edited
      context.json             # Scout's pack, including the toolchain probe
      ledger.jsonl             # append-only
      pr-body-<lane>.md        # passed to `gh pr create --body-file` (R7)
      lanes/
        1-api-contracts/       # worktree.json · diff.patch · pr.json
        2-terminator/
      units/
        U-2/
          diff.patch
          verdict.json
          run.log
          evidence/
            coverage.json      # a tool's own machine-readable output
            lint.json
            shot.png
            <step>.code        # exit status per step — the verdict's source
```

`<step>.code` is the existing convention from `runner/self-review-plan.ts`, kept deliberately: one file per step, containing that step's exit status, so a failure early in a sequence does not erase the results of the steps after it.

## Ownership and lifetime

- **Foundry owns everything under the root.** It is the only writer. Nothing in a target repository is owned by Foundry at all.
- **Nothing under the root is deleted implicitly.** A cancelled order keeps its records; what is reconciled on cancellation are the artefacts _outside_ the root — branches, worktrees, temporary checkouts — and the operator is told what was removed and what was kept (FR-077).
- **Evidence is retained for the life of the order directory** (FR-034). Pruning is an operator action, never automatic, because the thing being pruned is the record of why something was believed to be done.
- **`ledger.jsonl` is append-only.** A reversal is a new entry. Nothing rewrites a line.

## Concurrency

Two orders may target the same repository at once. Each gets its own worktree, so neither observes the other's changes (Edge Cases). Under the root they are separate directories and never contend.

Within one order, the ledger is the only file more than one writer appends to. Appends are single-line, opened `'a'`, and written whole — no read-modify-write, which is what makes concurrent unit writers safe without a lock.

## Portability obligations

1. **Nothing under the root may contain an absolute path that is meaningful only on one machine**, except where it names a worktree that machine created. Orders are readable elsewhere; worktrees are not, and the distinction is recorded rather than assumed.
2. **The root is not assumed to be inside any repository.** Nothing walks upward from it looking for a `.git`.
3. **The root may be on a different volume from the repositories.** Nothing hard-links or renames across the boundary; files are written where they belong the first time.
