# ADR 121: A repository profile, proven on the base branch

**Status**: Accepted; "Proof on the base" amended by ADR 137

**Date**: 2026-10-21

Amends ADR 042 (Foundry installs nothing) and ADR 111 (the base branch is proven
while the order is shaped).

## Context

ADR 042 forbade assuming a toolchain. The probe read manifests and recorded the
real command or `null`. In practice the probe, the install command and the
broken-install check all spoke one language, Node. A repository built with
Make, Cargo, Gradle or Xcode got `null` for most checks. A vocabulary of Node
only decided what "installed" meant. Foundry needs a description of a
repository that any toolchain can fill, and that is proven before Foundry trusts it.

## Decision

**A repository has a profile: the commands that build, check and prepare it, and the paths that matter. Every entry names its source. The base branch proves every entry before the ladder runs it.**

- **The profile** (`extensions/foundry/src/profile/schema.ts`) holds `prepare`,
  `share`, one entry per check (format, lint, test, coverage, e2e, build),
  `additional` checks and `paths`. An entry is `{ command, source, evidence? }`.
- **Sources and precedence** (`src/profile/resolve.ts`): `operator`, then
  `repository` (`<repo>/.foundry/profile.yaml`, read only, ADR 042 holds), then
  `scout`, then `hint`. For each check, the first source with an answer wins.
  The word of the operator wins because it is the only one that a person checked.
- **Hints are data.** `extensions/foundry/hints/*.yaml` (node, python, rust, go,
  make and others) say which files to look for and which command the files imply.
  The code names no toolchain. The probe (`src/verify/toolchain-probe.ts`) returns
  `source: 'hint'` and `evidence`, the file it read. Orders written with an old
  source name (`package.json`, `config`, `makefile`, `ci`) read back as `hint`.
- **Proof on the base.** `proveEnvironment` (ADR 111) runs the commands of the
  profile on the base branch. It keeps the exit codes with the commit
  (`src/profile/proof.ts`). A command that exits 0 is proven. For a command that
  fails, the operator decides. A check with no command is "not measured", never a pass.
- **Scout proposals.** The scout can propose commands, with the file and line it
  read them from. They land as `scout` entries. They stay unproven until the base-branch
  run passes them. An agent never writes `context.toolchain` directly.
- **Prepare and share.** `environment.prepare` is the command that makes a
  checkout runnable. A new lane checkout runs it once (`prepareNewCheckouts`).
  `environment.share` names folders that Foundry lends from the origin checkout into a lane
  worktree, only where the own `.gitignore` of the repository already covers them.
- **Paths are data.** Lockfiles, manifests, formatting and interface paths come
  from the profile, not from code.

## Consequences

- Foundry can describe and prove a repository with any toolchain. The Foundry code
  contains no package-manager vocabulary.
- ADR 042 still holds: Foundry writes nothing into the repository. It stores the profile
  under the data root. A repository can carry its own file.
- The proof of ADR 111 now proves the commands of the profile, and its mend is the one in
  ADR 122.
