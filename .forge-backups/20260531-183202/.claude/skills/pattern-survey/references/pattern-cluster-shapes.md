# Common pattern shapes to look for

When surveying a topic, these are clusters that tend to recur in large monorepos:

- **Hand-rolled vs library** — one cluster uses a standard library, another reimplements it.
- **Sync vs async** — same operation done synchronously in some places, asynchronously in others.
- **Centralized vs distributed** — one cluster routes through a shared utility, another inlines the logic at each call site.
- **Defensive vs trusting** — one cluster validates inputs at the boundary, another assumes upstream validated.
- **Logged vs silent** — one cluster emits structured logs/metrics, another swallows errors.

Each pattern shape is a legitimate engineering choice — your job is to surface that the choice has been made, not to pick.
