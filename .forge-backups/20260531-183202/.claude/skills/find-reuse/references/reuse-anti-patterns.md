# Reuse anti-patterns

These are the patterns that grow tech debt fastest. Look for them when ranking candidates.

- **Parallel parsers.** Multiple functions parse the same input format with subtly different rules.
- **Drifted validators.** Two validation helpers for the same domain object with different rules.
- **Snowflake retry loops.** Each caller hand-rolls its own retry/backoff instead of using the shared client.
- **Format-by-string-concat.** New code building a structured format (URL, JSON, SQL) via string concatenation when a builder exists.
- **One-off date parsers.** Anything that calls `new Date(...)` or `time.Parse(...)` with an inline format string when a project-wide parser already exists.

If the new code is at risk of becoming one of these, flag it.
