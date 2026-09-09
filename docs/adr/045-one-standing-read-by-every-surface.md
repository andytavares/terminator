# ADR 045: One standing, read by every surface

**Status**: Accepted

**Date**: 2026-09-09

**Builds on**: [ADR 044](044-a-fan-out-parallelises-lanes-not-units.md) (which
recorded what the Line does with an order; this records how a person is told
what it is doing)

## Context

`WO-0909-30a` — "Make all text in the application red" — was started at 16:42.
At 18:12 its wall-clock budget fired, a `budget.exceeded` gate was raised with
three named options, and the ledger recorded `run.halted — waiting on a gate`.
Before that, its one builder had asked for a Bash permission, nobody answered
in time, and the bridge handed the question back to the terminal's own prompt,
where the agent's process sat for the next two hours doing nothing.

Nothing anywhere said so. Read out of the running application at 20:40:

| Surface       | What it said                                  |
| ------------- | --------------------------------------------- |
| Order list    | **ready to hand off**                         |
| Floor heading | `WO-0909-30A · DIRECT`                        |
| Floor chips   | builder **building**, five steps **waiting**  |
| Floor panels  | activity, blocked — the gate named on neither |
| Inbox         | a badge reading **1**                         |

Three separate defects, and one cause behind all three.

**The list's badge was a constant wearing a status.** It read
`failures === 0 ? 'ready to hand off' : …`, and `failures` is the count of
failing _draft-compile_ checks; `foundry:order.list` hardcodes the companion
`openQuestions` to `0` for anything that is not a draft. Both are therefore zero
for every running order, for ever. The badge could not say anything else.

**The Floor's graph was fetched once, on mount, and never again.** Only the live
half — held calls, the feed, stalls — was polled. Every state chip was a
snapshot of whenever the panel happened to open.

**There is no `halted` order status.** `order.json` still said `"status":
"running"` while the ledger said the line had halted, so no surface could
distinguish "an agent is working" from "everything stopped, waiting on you".

The cause: **every surface worked out what an order was doing for itself, from
whatever it happened to hold.** The list held the order record. The Floor held
the graph. The inbox held the gates. None of them held enough, and none of them
was wrong on its own terms.

## Decision

**One derivation — `src/order/standing.ts` — answers "what is this order doing,
and whose move is it", and every surface reads it.**

`standingOf` is pure and takes the whole picture at once: order status, graph,
gates, held tool calls, handed-back agents, orphaned nodes, stall firings, open
questions, compile failures. It returns a `kind`, a `turn` (`you` or `foundry`),
a badge `label`, a sentence-case `headline`, one sentence of `detail`,
`done`/`total` steps, and the id of the gate holding it.

Two consequences of the shape:

- **The branch order is how much of the run each condition has stopped**, worst
  first. `halted` outranks everything because a gate stops the whole line;
  `asking` outranks `stranded` because a held call is answerable from the
  surface in one click and a handed-back one is only answerable in a terminal.
- **`headline` is carried in the value, not looked up from `kind` in the
  surface.** A `Record` keyed by a union blanks the whole panel the day the
  union gains a member — React is handed `undefined`, throws, and unmounts
  everything, while the build, the lint and every test stay green. That has
  already happened once here, to `RULE_ICON`.

`readStanding` is the one place the inputs are assembled. Both
`foundry:order.list` and `foundry:run.observe` go through it, so the list and
the Floor cannot disagree about the same order.

**A standing that says a person is needed carries the move.** The Floor opens
with a full-width band — the order's title, the headline, the sentence, the
progress — and renders the gate's own options as buttons, each over its
consequence, answered through `foundry:inbox.decide`: the same channel the
inbox uses. `adrift` offers _Pick it back up_; `stranded` offers _Go to its
terminal_.

**A hand-back is recorded, not only posted.** The session goes into
`strandedAgents` and is counted while its process lives, which is what makes
`stranded` distinguishable from `working`. It is dropped when that agent asks
again — what an agent somebody freed at the prompt does next — and when its
process is gone, which is `adrift`.

## Alternatives considered

**Fix the badge expression and leave the rest.** One line: derive the label from
`status` as well as `failures`. It removes the false "ready to hand off" and
leaves everything else — the stale chips, the unnamed gate, the screen that
still cannot say what to do next. It treats the symptom the operator reported
and not the reason there were three of them.

**Give the order record a `halted` status.** Honest, and it would have caught
this one case. But `stranded`, `adrift`, `asking` and `stalled` are all facts
about _this process_ — whether an agent's terminal still exists — and a record
on disk cannot carry them. The status field would grow one member per runtime
condition and still be wrong after a restart.

**Link the Floor to the inbox instead of answering there.** The inbox is "the
one surface the operator is required to visit", and duplicating gate decisions
onto the Floor argues against that. Rejected because the reported failure is
exactly a person on the Floor with no idea what to do: the inbox stays the
cross-order queue, and the band shows this order's one blocking thing where the
person looking at that order will see it. It is the same gate, answered through
the same channel — not a second queue.

**Push state to the surfaces instead of polling.** Correct in the long run and a
larger change; a surface that misses one event shows a stale answer for ever,
which is what the live half already guards against by polling. The graph now
polls on the same 2s timer as everything else beside it.

## Consequences

- `foundry:run.observe` returns `standing`, `waiting` (the undecided gates),
  `stranded` (session ids) and `title`; `foundry:order.list` returns `standing`
  per row. Both are optional in the surfaces, because the list is polled and a
  host part way through an upgrade answers without them.
- The Floor's separate "nothing is running this" panel is gone — the band says
  it and carries its move, and two panels saying the same thing in two voices is
  what the band exists to remove.
- `RunDeps` and `ForgeDeps` gained optional readers for gates, held calls,
  stranded agents and stall firings. A host with no supervision runtime supplies
  none of them and still gets a standing.
- The band is the only thing on the Floor drawn at heading weight, and the
  order's title is the only thing above it. Everything below recedes.
- A `working` standing still cannot see an agent that is alive and doing
  nothing for a reason other than a hand-back. That is what the stall detector
  is for, and it ships in shadow mode — recorded, never notified — so it is
  deliberately not counted here. Turning it on is a settings decision.
