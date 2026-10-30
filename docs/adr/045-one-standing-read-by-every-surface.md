# ADR 045: One standing, read by every surface

**Status**: Accepted

**Date**: 2026-09-09

**Builds on**: [ADR 044](044-a-fan-out-parallelises-lanes-not-units.md) (which
recorded what the Line does with an order; this records how a person is told
what it is doing)

## Context

`WO-0909-30a` was "Make all text in the application red". It started at 16:42. At 18:12 its wall-clock budget fired. Foundry raised a `budget.exceeded` gate with three named options, and the ledger recorded `run.halted — waiting on a gate`. Before that, its one builder had asked for a Bash permission. Nobody answered in time, and the bridge handed the question back to the terminal's own prompt. The agent's process sat at that prompt for the next two hours and did nothing.

Nothing anywhere said so. We read the following out of the running application at 20:40:

| Surface       | What it said                                  |
| ------------- | --------------------------------------------- |
| Order list    | **ready to hand off**                         |
| Floor heading | `WO-0909-30A · DIRECT`                        |
| Floor chips   | builder **building**, five steps **waiting**  |
| Floor panels  | activity, blocked — the gate named on neither |
| Inbox         | a badge reading **1**                         |

These are three separate defects with one cause behind all three.

**The list's badge was a constant that looked like a status.** It read `failures === 0 ? 'ready to hand off' : …`. `failures` is the count of failing _draft-compile_ checks. `foundry:order.list` hardcodes the companion `openQuestions` to `0` for anything that is not a draft. So both values are zero for every running order, for ever. The badge could not say anything else.

**The Floor fetched its graph once, on mount, and never again.** Only the live half was polled: held calls, the feed and stalls. Every state chip was a snapshot from whenever the panel happened to open.

**There is no `halted` order status.** `order.json` still said `"status": "running"` while the ledger said the line had halted. No surface could tell "an agent is working" from "everything stopped, waiting on you".

The cause: **every surface worked out for itself what an order was doing, from whatever it happened to hold.** The list held the order record. The Floor held the graph. The inbox held the gates. None of them held enough, and none of them was wrong on its own terms.

## Decision

**One derivation, `src/order/standing.ts`, answers "what is this order doing, and whose move is it". Every surface reads it.**

`standingOf` is pure and takes the whole picture at once: order status, graph, gates, held tool calls, handed-back agents, orphaned nodes, stall firings, open questions and compile failures. It returns these values:

- a `kind`
- a `turn` (`you` or `foundry`)
- a badge `label`
- a sentence-case `headline`
- one sentence of `detail`
- `done` and `total` steps
- the id of the gate that holds the order

The shape has two consequences:

- **The branch order is how much of the run each condition has stopped, worst first.** `halted` outranks everything, because a gate stops the whole line. `asking` outranks `stranded`, because the surface can answer a held call in one click, and a handed-back call is answerable only in a terminal.
- **The value carries `headline`. The surface does not look it up from `kind`.** Suppose a `Record` is keyed by a union and the union gains a member. React is handed `undefined`, throws, and unmounts everything, while the build, the lint and every test stay green. This has already happened once here, to `RULE_ICON`.

`readStanding` is the one place that assembles the inputs. Both `foundry:order.list` and `foundry:run.observe` go through it, so the list and the Floor cannot disagree about the same order.

**A standing that says a person is needed carries the move.** The Floor opens with a full-width band. The band shows the order's title, the headline, the sentence and the progress. It renders the gate's own options as buttons, each over its consequence. The buttons answer through `foundry:inbox.decide`, which is the same channel the inbox uses. `adrift` offers _Pick it back up_. `stranded` offers _Go to its terminal_.

**Foundry records a hand-back, and does not only post it.** The session goes into `strandedAgents`, and Foundry counts it while its process lives. This is what makes `stranded` distinguishable from `working`. Foundry drops the session in two cases. One is when that agent asks again, which is what an agent does next after somebody frees it at the prompt. The other is when its process is gone, which is `adrift`.

## Alternatives considered

**Fix the badge expression and leave the rest.** This is one line: derive the label from `status` as well as `failures`. It removes the false "ready to hand off". It leaves everything else: the stale chips, the unnamed gate, and the screen that still cannot say what to do next. It treats the symptom that the operator reported, and not the reason there were three of them.

**Give the order record a `halted` status.** This is honest, and it would have caught this one case. But `stranded`, `adrift`, `asking` and `stalled` are all facts about _this process_, that is, whether an agent's terminal still exists. A record on disk cannot carry them. The status field would grow one member per runtime condition and would still be wrong after a restart.

**Link the Floor to the inbox instead of answering there.** The inbox is "the one surface the operator is required to visit", and duplicating gate decisions onto the Floor argues against that. We rejected the link because the reported failure is exactly a person on the Floor with no idea what to do. The inbox stays the cross-order queue. The band shows this order's one blocking item where the person who looks at that order will see it. It is the same gate, answered through the same channel. It is not a second queue.

**Push state to the surfaces instead of polling.** This is correct in the long run and a larger change. A surface that misses one event shows a stale answer for ever, which the live half already guards against by polling. The graph now polls on the same 2s timer as everything else beside it.

## Consequences

- `foundry:run.observe` returns `standing`, `waiting` (the undecided gates), `stranded` (session ids) and `title`. `foundry:order.list` returns `standing` per row. The surfaces treat both as optional, because the list is polled and a host part way through an upgrade answers without them.
- The Floor's separate "nothing is running this" panel is gone. The band says it and carries its move. Two panels that say the same thing in two voices is what the band exists to remove.
- `RunDeps` and `ForgeDeps` gained optional readers for gates, held calls, stranded agents and stall firings. A host with no supervision runtime supplies none of them and still gets a standing.
- The band is the only thing on the Floor drawn at heading weight, and the order's title is the only thing above it. Everything below it recedes.
- A `working` standing still cannot see an agent that is alive and does nothing for a reason other than a hand-back. The stall detector exists for that. It ships in shadow mode, which records and never notifies, so this decision deliberately does not count it. Turning it on is a settings decision.
