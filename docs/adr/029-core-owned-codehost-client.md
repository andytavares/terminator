# ADR 029: Core owns its code-host client rather than consuming the extension's

**Status**: Accepted
**Date**: 2026-07-26
**Context**: Feature `021-agent-supervision-console`

## Context

Risk grading and the merge policy both depend on automated check results. The lowest risk grade is defined partly by "all automated checks have reported success", and unattended merge is forbidden unless checks are green.

All `gh` CLI access in this repository lives in the `git-integration` extension. Verified while planning: `src/main/git/` is populated but `src/main/github/` was empty.

The specification forbids the core application depending on any extension. That made the plan's original assumption — that check results come from the existing integration — a contradiction rather than a convenience.

## Decision

Core gains `src/main/codehost/`, which shells out to the `gh` CLI directly. The `git-integration` extension's own pull-request surfaces are untouched and are not consumed by this feature.

## Rationale

**A safety property must not be contingent on an install.** Unattended merge turns on check state. If that data arrived from an extension, uninstalling it would silently change what the console is willing to merge without asking. That is precisely the coupling the boundary exists to prevent.

**It is the same class of dependency core already accepts.** Core shells out to `git`. Shelling out to `gh` adds no npm dependency and no authentication of our own — `gh auth login` owns that.

**The failure posture is the point.** Everything here resolves to `unavailable` when we cannot actually tell: `gh` missing, unauthenticated, offline, no pull request, no checks configured, or a state we do not recognise. Never `passing`. A test asserts that no failure path can produce `passing`, because the safe direction has to be the default direction.

## Alternatives considered

**Consume the extension's client.** Rejected above.

**Define a code-host provider on the Extension API.** Rejected: it makes the same safety property depend on an install, just with more ceremony.

**Infer CI state from local git refs.** Rejected: works offline but is incomplete and silently wrong on hosts that do not push status refs — the worst combination for a check that gates merging.

## Consequences

Some `gh` calls are now made from two places. That duplication is accepted as the price of the boundary and is recorded in the specification's Assumptions.

A later feature may invert the relationship, letting the extension consume core's client through the Extension API. That would remove the duplication without reintroducing the dependency, but it is out of scope here.

An unreachable code host degrades gracefully: items grade no lower than P2, unattended merge cannot fire, and the operator reviews manually.
