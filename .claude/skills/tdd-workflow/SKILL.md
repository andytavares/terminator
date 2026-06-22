---
name: tdd-workflow
description: Use whenever Claude is about to add behavior or change behavior in production code. Forces the test-first sequence and routes work through the researcher → test-author → implementer subagents.
---

# TDD Workflow

This codebase treats tests as the specification. The harness enforces the sequence:

1. **Plan.** Spawn the `researcher` subagent. Output is a written plan with acceptance criteria. No code.
2. **Red.** Spawn the `test-author` subagent. It writes tests that match the acceptance criteria and runs them to confirm they fail. No production code at this stage. Tests follow the Google unit-testing standards (public-API, state-over-interaction, fakes-over-mocks, hermetic, DAMP, one-behavior-per-test) — see the `test-quality-review` skill for the full rubric.
3. **Green.** Spawn the `implementer` subagent. It writes the minimum code that turns the tests green. No test edits.
4. **Refactor.** Only after green, propose refactors. Each refactor is followed by a full test re-run. Before reporting the change complete, run the `test-quality-review` skill (or the `test-quality-reviewer` subagent) on the new tests.

## When to skip TDD

- Pure documentation changes.
- Pure formatting / whitespace.
- Reverting a previous commit.

Anything else: tests first. The `pre-edit-guard` PreToolUse hook will block edits to production files when no matching test exists or was just written.

## BDD variant

If the repo uses Cucumber, behave, RSpec, Spock, or similar, the test-author writes the spec in that language. The acceptance criteria from the researcher map 1:1 to scenarios/examples.

See also: `references/test-naming.md`, `references/bdd-spec-style.md`.
