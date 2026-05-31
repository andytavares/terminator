---
description: Run the full researcher → test-author → implementer loop for a task
---

For task: $ARGUMENTS

1. Run the `researcher` subagent to produce an implementation plan.
2. Run `test-author` to write failing tests against the plan's acceptance criteria. Confirm tests fail before proceeding.
3. Run `implementer` to write the minimum code that makes the tests pass.
4. Run `code-reviewer` against the diff. Collect any issues found.
5. If the code-reviewer finds blocking issues: fix them inline and re-run the reviewer. Do not surface these mid-loop — fix and continue.
6. Return the completed task summary: what was built, test count, any non-blocking reviewer notes.
