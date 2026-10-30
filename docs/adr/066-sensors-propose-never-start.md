# ADR 066: Sensors propose work, they never start it

**Status**: Accepted

**Date**: 2026-09-26

## Context

Work reached Foundry only when someone typed an idea or picked one tracker
issue. The signals of the product itself reached Foundry only when a person
noticed them. Examples are CI failing on the base branch, bug reports piling up
under a label, and issues assigned and untouched. The software factory pattern
closes this loop with sensors that feed a ranked backlog. An agent that turns
those signals into running work would also start work that nobody is
accountable for. The curator has refused this from its first version: it
proposes only when asked.

## Decision

- A sensor is a YAML file (`sensors/<id>.yaml`), resolved on the same three
  rungs as recipes. It declares a source, how often to look (`every`, at least
  5 minutes) and a severity. The source is `github-runs` on a branch,
  `github-issues` with a label, or a `tracker` query. Two built-ins exist:
  `ci-main-red` and `tracker-query`.
- Sensors are off by default. Enabling one in Settings names the repository it
  watches. Sensors run on one 60-second tick while the application is open, and
  never otherwise: no cron, no launchd, no cloud runner.
- Collectors use only `gh` and the issues API of the core. They cluster what
  they see by key (workflow name; label and normalised title) into signals in
  `<dataRoot>/signals/signals.jsonl`, which is append-only. Impact is
  occurrences times severity (1, 3, 9).
- The Inbox lists open signals below the gates, ranked by impact. The tab badge
  counts gates only. Dismissing hides a signal until it grows by half again.
  Promoting seeds a draft order from the evidence of the signal
  (`source.kind: 'signal'`). The Forge still has to converge the draft, and a
  person still agrees it. Nothing starts.

## Alternatives

- **Sensors that start orders.** Rejected. An agent cannot be held accountable,
  and the operator has said so already of the curator.
- **An agent that clusters signals.** Deferred. Clustering by key is
  deterministic and free. An agent scout is worth adding once keys prove too
  coarse.
- **OS scheduling.** Rejected. It installs something on the machine and runs
  with nothing supervising it.

## Consequences

- Nothing is sensed while the application is closed. The next tick catches up
  on what the sources still show.
- Sensor runs are recorded in the state of the sensor, not in the ledger of an
  order, because they belong to no order. A promotion is recorded on the order
  it seeds.
