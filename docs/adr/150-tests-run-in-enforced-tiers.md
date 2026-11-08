# ADR 150: Tests run in tiers the setup enforces

**Status**: Accepted; its stability gate and sweep part is superseded by ADR 151

**Date**: 2026-11-07

Amends ADR 098 (stories as tests), ADR 123 (sealed tests) and ADR 124 (the stability gate and the sweep).

## Context

A test audit of the whole suite (`/at:tests audit`, 2026-11-07) found 1,037 spec files where 851 tests could not fail or repeated another test, 796 "unit" tests started processes, ran real git, listened on sockets or opened SQLite, and 2,641 `fireEvent` calls stood in for a person. `clearMocks: false` let a test read the mock calls another test left. 98 stories counted as tests because they rendered, and 28 light-theme copies repeated their dark story's checks. Two E2E specs and one unit spec failed only when the machine was busy; the nightly sweep runs without load and had not reported them.

## Decision

- **Tiers.** `vitest.config.ts` has an `integration` project for `tests/integration` and `extensions/*/tests/integration`. Each project declares its tier, and `tests/setup.ts` enforces it: a unit test opens no socket (loopback included), starts no process, watches no file and opens no database (`tests/support/unit-io-guard.ts`, `tests/support/network-guard.ts`); an integration test connects only to this machine.
- **Clean slate.** `mockReset: true` replaces `clearMocks: false`: every mock's calls and implementation reset before each test.
- **Lint.** Specs may not start a timer, stub a global with `Object.defineProperty`, skip on a condition (`skipIf`, `runIf`, a conditional Playwright skip), branch or loop in a test body, or use `fireEvent` for what user-event does. A core unit spec may not import an extension's source.
- **Stories.** A story runs as a test only when its play function asserts something (Storybook's `play-fn` tag). Every story is still pictured by the screenshot tests, which first assert the story rendered.
- **Load.** The stability gate and the nightly sweep run with more workers than cores, under `scripts/under-load.mjs`.

## Consequences

A spec that needs real I/O lives in an integration folder, and a run of the unit projects proves no test reaches outside its process. A spec that relied on another test's mock state fails at once instead of on some seed. The story run shrinks from 186 tests to the 34 with a play function. A test that is flaky only under load is found by the sweep, not by a contributor's pull request. Quarantine (ADR 124) is unchanged: the audit's rule that a flaky test is fixed or moved in the same change still conflicts with it.
