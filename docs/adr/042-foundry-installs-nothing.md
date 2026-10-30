# ADR 042: Foundry installs nothing into a repository, and its records live where you say

**Status**: Accepted; Amended by ADR 121

**Date**: 2026-09-06

## Context

The SpecKit Pilot worked only in a repository shaped for it. A card _was_ `specs/<slug>/`, and its state _was_ `.pilot/state.json`. Both lived inside the repository being worked on. To use the tool, you had to commit to a layout. Running it left files behind in a working tree that it had been asked to change.

Two further problems are worse than the untidiness.

**You could not borrow the repository.** To try the tool on somebody else's project, you had to create directories in it. No version of that is polite, and none survives a `git status` at review time.

**The tool assumed the toolchain.** `npm run lint` was hardcoded. In a repository with no lint script, that command failed. The pipeline read the failure as a failing check, not as a check that does not exist here. A tool that reports "this project fails lint" about a project with no linter is worse than a tool that says nothing.

The operator's constraint, stated directly: _"I don't want Foundry to have to be installed in the repo — it should be a global tool I can use in any repo without needing to install anything."_

## Decision

**Foundry creates or modifies exactly one thing in a repository it works on: the change that the order asked for.**

It adds no scaffolding, no init step, no committed configuration and no marker file. It never adds a `.gitignore` entry, not even for Foundry's own default data directory. Everything the tool needs ships inside the extension. A repository contributes information. It never contributes installation.

Three mechanisms carry this.

**One resolved data root.** Records go to `terminator.foundry.dataDir` when the operator sets it, and to `<workdir>/.foundry/` when the operator does not. `src/data-root.ts` resolves the path once. Every writer receives an absolute path and never resolves it again. Foundry refuses a relative setting and does not interpret it, because "relative to what" has three plausible answers when an order spans repositories.

The default leaves an untracked directory behind. Foundry says so once and offers the setting that avoids it. It does not edit `.gitignore`. That would edit a file that no order asked to change, which is the rule this ADR exists to state.

**Three-rung name resolution.** Foundry looks up a recipe, role or rule in three places, in this order: the data root, the repository's own `.foundry/`, then the built-ins that ship with the extension. The middle rung keeps both promises at once. A repository _may_ carry its own definitions, and they win. No repository is ever required to have any, and Foundry never creates that directory.

**A toolchain probe that reads and never executes.** `verify/toolchain-probe.ts` reads `package.json`, then tool configuration, then a Makefile, then CI workflows. It records the real command for each of six checks, or `null`. A `null` makes the matching check report **"not measured"**. It never reports a pass and never a failure. That third value is load-bearing. If any code in the verification path coerces it to a boolean, "we did not check" becomes "it is fine". That is the bug that makes an unattended factory dangerous.

## Consequences

**Good.**

- Foundry runs against a repository it has never seen, in a language it has no opinion about, and leaves the repository exactly as it found it. An integration test does this against a foreign fixture and asserts that `git status` is clean afterwards. An e2e test asserts the same after real orders.
- Verification is honest about what it could not check. This is the only way a green result means anything.
- A repository that _does_ want its own recipes gets them, and they win.

**Bad, and accepted.**

- The probe can be wrong. It reads a manifest and infers intent. A project with an unusual script name gets "not measured" where a human would have found the command. Reporting not-measured is the safe direction to be wrong in, but it is still wrong. The operator cannot correct it, except by writing a recipe.
- The default data root leaves an untracked directory in every repository where an order runs. Setting one location fixes this. It is also the only workable answer once an order spans repositories. But most people will use the default.
- The probe never executes anything, so it never verifies that a discovered command runs. Suppose a `package.json` names a script whose tool is not installed. The probe discovers the script as available, and it fails at the ladder instead.

## References

- `specs/037-foundry-software-factory/contracts/data-root.md`
- `extensions/foundry/CLAUDE.md` — the two rules specific to this extension
- `tests/integration/foundry-portability.spec.ts`, `tests/e2e/foundry.spec.ts`
