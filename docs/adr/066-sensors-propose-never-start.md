# ADR 066: Sensors propose work, they never start it

**Status**: Accepted

**Date**: 2026-09-26

## Context

Work reached Foundry only when someone typed an idea or picked one tracker
issue. The product's own signals (CI failing on the base branch, bug reports
piling up under a label, issues assigned and untouched) reached it only through
a person noticing them. The software factory pattern closes that loop with
sensors that feed a ranked backlog. An agent that turns those signals into
running work would also be starting work nobody is accountable for, which the
curator has refused from its first version: it proposes only when asked.

## Decision

- A sensor is a YAML file (`sensors/<id>.yaml`), resolved on the same three
  rungs as recipes: a source (`github-runs` on a branch, `github-issues` with a
  label, or a `tracker` query), how often to look (`every`, at least 5 minutes)
  and a severity. Two built-ins: `ci-main-red` and `tracker-query`.
- Sensors are off by default. Enabling one in Settings names the repository it
  watches. They run on one 60-second tick while the application is open, and
  never otherwise: no cron, no launchd, no cloud runner.
- Collectors use only `gh` and the core's issues API. What they see is
  clustered by key (workflow name; label and normalised title) into signals in
  `<dataRoot>/signals/signals.jsonl`, append-only. Impact is occurrences times
  severity (1, 3, 9).
- The Inbox lists open signals below the gates, ranked by impact, and the tab
  badge counts gates only. Dismissing hides a signal until it grows by half
  again. Promoting seeds a draft order from the signal's evidence
  (`source.kind: 'signal'`); the Forge still has to converge it and a person
  still agrees it. Nothing starts.

## Alternatives

- **Sensors that start orders.** Rejected: an agent cannot be held accountable,
  and the operator has said so of the curator already.
- **An agent that clusters signals.** Deferred: clustering by key is
  deterministic and free; an agent scout is worth adding once keys prove too
  coarse.
- **OS scheduling.** Rejected: it installs something on the machine and runs
  with nothing supervising it.

## Consequences

- Nothing is sensed while the application is closed; the next tick catches up
  on what the sources still show.
- Sensor runs are recorded in the sensor's state, not in an order's ledger,
  because they belong to no order. A promotion is recorded on the order it
  seeds.
