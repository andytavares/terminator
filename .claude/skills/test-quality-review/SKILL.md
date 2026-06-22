---
name: test-quality-review
description: Use to review the QUALITY of test code (not just whether tests exist) — before claiming test work is done, or when reviewing a diff that adds/changes tests. Applies Google's unit-testing standards: test behavior not implementation, prefer state over interaction, fakes over mocks, hermetic, DAMP, sized correctly.
---

# Test Quality Review

The TDD gate (`pre-edit-guard` hook) enforces that tests *exist*. This skill checks they are *good*:
that they will fail when behavior breaks and stay green through refactors. A brittle, mock-heavy,
flaky test suite is a liability that masquerades as safety — it breaks on every refactor and erodes
trust until people stop reading the failures.

See the `brittle-tests`, `test-doubles`, `state-vs-interaction-testing`, `test-via-public-api`,
`hermetic-tests`, `damp-vs-dry-in-tests`, `test-size-taxonomy`, and `clear-test-structure` concepts
in the wiki.

## When to use

On any diff that adds or changes test files, and before reporting test work complete. This is a
quality pass; it does not check coverage existence (the TDD gate already does) and it does not review
production code (that's the `code-review` skill / `code-reviewer` agent).

## How

For each test file in scope, evaluate against the rubric (full version in
`references/test-smell-rubric.md`) and report findings with `file:line` and a concrete fix:

1. **Tests behavior, not implementation.** The test exercises the *public API* and asserts on
   *observable results*. Flag tests that reach into private methods/fields or assert on internal
   structure — they break on refactors that don't change behavior (`test-via-public-api`,
   `brittle-tests`).

2. **State over interaction.** Prefer asserting the resulting *state* over verifying *which methods
   were called in what order*. Flag `verify(...)` / `toHaveBeenCalledWith` chains that pin down
   implementation rather than outcome (`state-vs-interaction-testing`,
   `interaction-testing-downsides`).

3. **Test-double choice: real > fake > stub > mock.** Prefer the real implementation when fast and
   hermetic; a fake (working in-memory implementation) when not; a stub for narrow return values; a
   mock only as a last resort. Flag heavy mocking, especially mocking types you don't own
   (`test-doubles`, `test-fidelity`).

4. **Hermetic.** No real network, no wall-clock/`sleep`-based timing, no shared mutable state across
   tests, no dependence on test ordering or external services. Flag each non-hermetic pattern — these
   are the seeds of flakiness (`hermetic-tests`, `test-flakiness`).

5. **DAMP, not DRY.** A test should be readable top-to-bottom in isolation. Some duplication is good
   if it makes the scenario obvious; flag over-abstraction (helpers/loops/shared setup) that hides
   what is actually being tested (`damp-vs-dry-in-tests`).

6. **One behavior per test, descriptive name.** Each test pins one behavior; the name says the
   scenario and expected outcome, not the method name. Flag multi-assert grab-bag tests and names
   like `test1` / `testFoo` (`clear-test-structure`).

7. **Sized correctly.** Most tests should be *small* (single process, no network/DB/sleep) so they're
   fast and deterministic; medium/large tests are the minority and justified. Flag a suite that
   reaches for large tests where a small one with a fake would do (`test-size-taxonomy`,
   `test-scope-vs-size`).

## Output

A structured verdict: per-file findings (`file:line` → which principle → concrete fix), then an
overall **Approve / Request changes**. No vague feedback — every finding names the rule and the fix.

See also: `references/test-smell-rubric.md`.
