# ADR 042: Foundry installs nothing into a repository, and its records live where you say

**Status**: Accepted

**Date**: 2026-09-06

## Context

The SpecKit Pilot only worked in a repository shaped for it. A card _was_
`specs/<slug>/`, its state _was_ `.pilot/state.json`, and both lived inside the
repository being worked on. Using the tool meant committing to a layout, and
running it left files behind in a working tree it had been asked to change.

Two things follow that are worse than the untidiness.

**The repository could not be borrowed.** Trying the tool on somebody else's
project meant creating directories in it. There is no version of that which is
polite, and none that survives a `git status` at review time.

**The toolchain was assumed.** `npm run lint` was hardcoded. In a repository
with no lint script, that was a command that failed — which the pipeline read
as a failing check rather than as a check that does not exist here. A tool that
reports "this project fails lint" about a project with no linter is worse than
one that says nothing.

The operator's constraint, stated directly: _"I don't want Foundry to have to
be installed in the repo — it should be a global tool I can use in any repo
without needing to install anything."_

## Decision

**Foundry creates or modifies exactly one thing in a repository it works on:
the change the order asked for.**

No scaffolding, no init step, no committed configuration, no marker file — and
never a `.gitignore` entry, not even for Foundry's own default data directory.
Everything the tool needs ships inside the extension. A repository contributes
information; it never contributes installation.

Three mechanisms carry it.

**One resolved data root.** Records go to `terminator.foundry.dataDir` when the
operator sets it, and to `<workdir>/.foundry/` when they do not. The path is
resolved once, in `src/data-root.ts`, and every writer receives an absolute
path and never resolves it again. A relative setting is refused rather than
interpreted, because "relative to what" has three plausible answers when an
order spans repositories.

Using the default leaves an untracked directory behind. Foundry says so once
and offers the setting that avoids it. It does not edit `.gitignore`, because
that is editing a file no order asked to change — which is the rule this ADR
exists to state.

**Three-rung name resolution.** A recipe, role or rule is looked up in the data
root, then in the repository's own `.foundry/`, then in the built-ins that ship
with the extension. The middle rung is what keeps both promises at once: a
repository _may_ carry its own definitions and they win, but no repository is
ever required to have any, and Foundry never creates that directory.

**A toolchain probe that reads and never executes.** `verify/toolchain-probe.ts`
reads `package.json`, then tool configuration, then a Makefile, then CI
workflows, and records the real command for each of six checks — or `null`. A
`null` makes the matching check report **"not measured"**, never a pass and
never a failure. That third value is load-bearing: coercing it to a boolean
anywhere in the verification path turns "we did not check" into "it is fine",
which is the bug that makes an unattended factory dangerous.

## Consequences

**Good.**

- Foundry runs against a repository it has never seen, in a language it has no
  opinion about, and leaves it exactly as it found it. There is an integration
  test that does this against a foreign fixture and asserts `git status` is
  clean afterwards, and an e2e that asserts the same thing after real orders.
- Verification is honest about what it could not check, which is the only way
  a green result means anything.
- A repository that _does_ want its own recipes gets them, and they win.

**Bad, and accepted.**

- The probe can be wrong. It reads a manifest and infers intent; a project with
  an unusual script name gets "not measured" where a human would have found the
  command. Reporting not-measured is the safe direction to be wrong in, but it
  is still wrong, and the operator has no way to correct it short of writing a
  recipe.
- The default data root leaves an untracked directory in every repository an
  order is run in. Setting one location fixes it, and is the only workable
  answer once an order spans repositories — but the default is the one most
  people will use.
- Never executing anything during the probe means never verifying that a
  discovered command actually runs. A `package.json` naming a script whose tool
  is not installed is discovered as available and fails at the ladder instead.

## References

- `specs/037-foundry-software-factory/contracts/data-root.md`
- `extensions/foundry/CLAUDE.md` — the two rules specific to this extension
- `tests/integration/foundry-portability.spec.ts`, `tests/e2e/foundry.spec.ts`
