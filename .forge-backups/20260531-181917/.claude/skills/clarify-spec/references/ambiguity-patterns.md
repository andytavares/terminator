# Ambiguity Pattern Reference

Phrases and structures that reliably signal underspecification. Flag any task or spec section containing these patterns.

## Language signals

| Pattern                                 | Why it's ambiguous                                            |
| --------------------------------------- | ------------------------------------------------------------- |
| "should" without a measurable condition | Does not define when the behavior is satisfied                |
| "fast" / "efficient" / "lightweight"    | No benchmark target; unmeasurable                             |
| "the user" without specifying a role    | Different roles may have different permissions or flows       |
| "handle errors" / "handle failures"     | Does not specify recovery behavior, user feedback, or logging |
| Passive voice: "data is saved"          | Does not specify who saves it, where, or when                 |
| "as needed" / "if necessary"            | Leaves the trigger condition unspecified                      |
| "etc." / "and so on"                    | Implies a list that is not fully enumerated                   |

## Structural signals

| Pattern                                                                     | Why it's ambiguous                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A task references a schema or API not defined in any earlier task           | Implicit dependency — which task creates the schema?                      |
| Two tasks both "own" the same field, table, or module                       | Ownership conflict — who is responsible for the authoritative definition? |
| A task's acceptance criteria use a term defined differently in another task | Vocabulary mismatch — one definition needs to win                         |
| A behavior is described in the spec but absent from all tasks               | Scope gap — intentionally deferred or accidentally omitted?               |
| A task's acceptance criteria are identical to another task's                | Possible duplicate — should these be merged?                              |

## Implementation choice signals

| Pattern                          | Example                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Multiple valid storage backends  | "persist the result" when both cache and DB are in scope                           |
| Sync vs. async execution         | "process the request" when the spec doesn't specify latency requirements           |
| Pull vs. push data flow          | "notify subscribers" without specifying polling or webhooks                        |
| One service vs. separate service | "add authentication" without specifying whether it's in-process or an auth service |
