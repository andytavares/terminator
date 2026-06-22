---
name: large-scale-change
description: Use when a change must touch many call sites at once — renaming or changing a public symbol, migrating an API, swapping a dependency, or any edit whose blast radius spans more than a couple of files. Plans and executes the change the way Google runs a Large-Scale Change (LSC).
---

# Large-Scale Change (LSC)

A Large-Scale Change is a single logical change applied across a whole codebase that is too big to
land as one reviewable commit. The Google discipline: **the person making the change migrates every
caller themselves** rather than breaking consumers and leaving them to catch up, and the change is
sharded so trunk stays green at every step.

See the `large-scale-changes`, `hyrum-s-law`, `code-search-as-infrastructure`, and
`trunk-based-development` concepts in the wiki for the rationale.

## When to use

Use this when the edit you are about to make changes a contract that other code depends on, or
repeats the same mechanical edit across many files. If the change is local to one or two files,
just make it — this skill is overhead you don't need.

## How

1. **Define the change precisely.** Write the before → after in one sentence. A good LSC is
   *mechanical and shardable* — each shard is independently correct and reviewable. If the change
   needs human judgment per site, it is not an LSC; split out the judgment calls first.

2. **Find every caller (blast radius).** Delegate to the `change-impact-analyst` subagent, or run
   the passes yourself:
   ```
   rg -n --type-add 'all:*' -t all "<symbol>" --files-with-matches
   ```
   Then a structural pass via the `ast-search` skill to catch call sites a text search misses
   (re-exports, aliased imports, interface implementations). Record the full `file:line` set.

3. **Check the contract (Hyrum's Law).** Any *observable* behavior of the old symbol may be
   depended on, not just its signature. Note implicit dependencies (ordering, timing, error text,
   serialization) so the migration preserves them or the trade-off is recorded. For a true contract
   change, also run the `trade-off-record` skill.

4. **Choose a strategy:**
   - **Atomic** — one commit changes the definition and every caller. Only viable when the call set
     is small enough to review and the build can't be split.
   - **Expand → migrate → contract** (preferred for large sets): add the new form alongside the old,
     migrate callers in independently-mergeable shards, then remove the old form. Each shard keeps
     trunk green and is separately revertable. This is also the shape of a clean deprecation — see
     the `deprecation-plan` skill.

5. **Shard the migration.** Group call sites into shards small enough to review (by directory, owner,
   or package). Each shard: edit the sites, run the package's tests, leave the build green.

6. **Automate where possible.** Prefer a scripted/AST-based rewrite (`ast-grep`, `comby`, codemod)
   over hand edits so every shard is consistent. Hand edits are for the sites the script can't safely
   touch — call those out explicitly.

7. **Verify.** After each shard, run the affected package's tests. After the final contract step,
   run a full search to prove zero remaining references to the old form.

## Output

A plan containing: the one-sentence change, the full caller set with counts, the chosen strategy
(with justification), the shard list, the rewrite command (if automated), and the Hyrum's-Law /
contract risks. Then execute shard by shard, reporting trunk-green status after each.

See also: `references/lsc-playbook.md`.
