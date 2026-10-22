# ADR 121: A repository profile, proven on the base branch

**Status**: Accepted

**Date**: 2026-10-21

Amends ADR 042 (Foundry installs nothing) and ADR 111 (the base branch is proven
while the order is shaped).

## Context

ADR 042 forbade assuming a toolchain: the probe read manifests and recorded the
real command or `null`. In practice the probe, the install command and the
broken-install check all spoke one language, Node. A repository built with
Make, Cargo, Gradle or Xcode got `null` for most checks, and a Node-only
vocabulary decided what "installed" meant. Foundry needs a description of a
repository that any toolchain can fill, and that is proven before it is trusted.

## Decision

**A repository has a profile: the commands that build, check and prepare it, and the paths that matter. Every entry names its source and is proven on the base branch before the ladder runs it.**

- **The profile** (`extensions/foundry/src/profile/schema.ts`) holds `prepare`,
  `share`, one entry per check (format, lint, test, coverage, e2e, build),
  `additional` checks and `paths`. An entry is `{ command, source, evidence? }`.
- **Sources and precedence** (`src/profile/resolve.ts`): `operator`, then
  `repository` (`<repo>/.foundry/profile.yaml`, read only, ADR 042 holds), then
  `scout`, then `hint`. The first source with an answer wins per check. The
  operator's word wins because it is the only one a person checked.
- **Hints are data.** `extensions/foundry/hints/*.yaml` (node, python, rust, go,
  make and others) say which files to look for and which command they imply.
  Code names no toolchain. The probe (`src/verify/toolchain-probe.ts`) returns
  `source: 'hint'` and `evidence`, the file it read. Orders written with an old
  source name (`package.json`, `config`, `makefile`, `ci`) read back as `hint`.
- **Proof on the base.** `proveEnvironment` (ADR 111) runs the profile's
  commands on the base branch and keeps the exit codes with the commit
  (`src/profile/proof.ts`). A command that exits 0 is proven; one that fails
  leaves the operator to decide; no command is "not measured", never a pass.
- **Scout proposals.** The scout may propose commands with the file and line it
  read them from. They land as `scout` entries, unproven until the base-branch
  run passes them. An agent never writes `context.toolchain` directly.
- **Prepare and share.** `environment.prepare` is the command that makes a
  checkout runnable; a new lane checkout runs it once (`prepareNewCheckouts`).
  `environment.share` names folders lent from the origin checkout into a lane
  worktree, only where the repository's own `.gitignore` already covers them.
- **Paths are data.** Lockfiles, manifests, formatting and interface paths come
  from the profile, not from code.

## Consequences

- A repository with any toolchain can be described and proven; Foundry code
  contains no package-manager vocabulary.
- ADR 042 still holds: nothing is written into the repository. The profile is
  stored under the data root; a repository may carry its own file.
- ADR 111's proof now proves the profile's commands, and its mend is the one in
  ADR 122.
