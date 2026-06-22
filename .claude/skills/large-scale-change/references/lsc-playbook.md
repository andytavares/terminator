# LSC Playbook

Reference detail for the `large-scale-change` skill. Source: *Software Engineering at Google*, Ch. 22
(Large-Scale Changes) and Ch. 15 (Deprecation).

## The three properties of a good LSC

1. **Mechanical** — the transformation is the same shape everywhere. Judgment calls are factored out
   and handled separately, before or after the mechanical sweep.
2. **Shardable** — the change can be split into pieces that each compile, pass tests, and merge
   independently. A shard that depends on another shard being in first is a smell.
3. **Reversible per shard** — any single shard can be rolled back without breaking the others.

## Expand → migrate → contract (the safe shape)

```
EXPAND    add the new API/behavior next to the old one; both work.
MIGRATE   move callers to the new form in small, independently-mergeable shards.
CONTRACT  once no caller uses the old form, remove it.
```

This keeps trunk green throughout and decouples your timeline from every consumer's timeline. It is
the same backbone as a deprecation (`deprecation-plan` skill) — a deprecation is just an LSC where
the "contract" step may be deferred to owners.

## Sharding heuristics

- Shard by **ownership boundary** first (directory / package / team) so reviews go to the right eyes.
- Keep each shard **small enough to review in one sitting** — oversized shards get rubber-stamped,
  which defeats the review. (See `code-review-philosophy`.)
- A shard must **not** mix the mechanical sweep with unrelated cleanup. One logical change per shard.

## Hyrum's Law checklist (what "observable behavior" includes)

- Return value *ordering* (map/set iteration, sort stability).
- *Timing* / performance characteristics callers may rely on.
- Exact *error messages*, error *types*, and exit codes.
- *Serialization* format and field ordering.
- Side effects (logs, metrics, files) other systems parse.

If any of these change, the LSC is a contract change: record it with `trade-off-record` and, if
consumers are external/unknown, treat it as a deprecation.

## Tooling

- Text pass: `rg`. Structural pass: `ast-search` skill (`ast-grep` / `semgrep`).
- Automated rewrite: `ast-grep --rewrite`, `comby`, or a language-native codemod.
- Always re-run a full search after the contract step to prove zero residual references.
