# Review rubric

| Category | Pass criterion |
|---|---|
| Conventions | New code follows the nearest analogous files (named, structured, errored the same way). |
| Coverage | Every changed behavior has a test that fails without the change. |
| Security | No new injection sinks. No secrets in code. Auth boundaries respected. |
| Performance | No new N+1. No unbounded inputs. No sync I/O on hot paths. |
| Errors | Every error path is either handled or propagated. No silent catches. |
| Docs | Any doc referencing changed code is updated or flagged. |
| Reuse | No new helper duplicates an existing one (find-reuse passed). |
