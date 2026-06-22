---
description: Review the quality of tests in the current change set using the test-quality-reviewer subagent
---

Run the `test-quality-reviewer` subagent against the test files in the current diff:

```
git diff HEAD
```

It applies the `test-quality-review` skill (brittleness, state-vs-interaction, fakes-over-mocks,
hermeticity, DAMP, sizing) and returns a structured verdict. Do not edit any files.
