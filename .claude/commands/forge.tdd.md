---
description: Run the full researcher → test-author → implementer loop for a task
---

For task: $ARGUMENTS

1. Run the `researcher` subagent. Return the plan.
2. Pause for my approval of the plan.
3. After approval, run `test-author` to write failing tests and confirm they fail.
4. Pause for my approval of the tests.
5. After approval, run `implementer` to make them pass.
6. Run `code-reviewer` before declaring done.

Do not skip pauses.
