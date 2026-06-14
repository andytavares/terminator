---
description: Diagnose a build/test/tooling problem ("why is X slow?", "are we using Y correctly?")
---

Run the `codebase-oracle` subagent with the `build-audit` skill against:

$ARGUMENTS

Return ranked hypotheses with evidence, configuration-vs-official-docs drift, and the smallest verifying experiment for the top hypothesis.
