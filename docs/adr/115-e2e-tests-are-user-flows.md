# ADR 115: E2E tests are user flows

**Status**: Accepted
**Date**: 2026-10-16
**Relates to**: [ADR 070](070-e2e-is-deterministic-and-selective.md), [ADR 071](071-ci-is-sharded-by-duration-and-warns-nothing.md), [ADR 114](114-extension-views-are-frames-in-the-window.md)

## Context

The suite had grown to 418 `test()`s in 90 spec files, which launched the app 130 times. Most tests checked one thing: that a folder path is abbreviated, that a count is right-aligned, that a channel refuses a command. Those are unit and component checks, run at the cost of a whole app. When extension views became frames (ADR 114), every test that touched a view could meet a timing gap between the page and the browser. Examples are a click routed by a frame not yet drawn, a key heard by a frame instead of the host, and a theme that arrives a moment later. More single-thing tests meant more chances to meet those gaps. CI failed on a different spec each run.

## Decision

**An e2e test is one user journey, from start to finish. A check of one thing is a unit or component test.**

- A flow is one `test()`, named for what the user achieves. Its steps are `test.step()`s. Each step title keeps the behaviour that the old test checked, so a failure still names it.
- A spec file launches the app once, in `beforeAll`. A flow restarts the app only when the flow checks that something survives a restart.
- A single-component or channel-contract check moves down to a unit or component test. Write the test first, and show that it fails when the behaviour is wrong.
- Layout, contrast and alignment audits that need a real render run as a step at the end of the flow that already has the surface on screen.
- Plain-Chromium renders without the app (`design-system-fields`, `git-integration-contrast`, `git-integration-stacking`) are one test each, with a step per case.

The rewrite moved every old test to exactly one place: a step in a flow, a new unit test, an existing unit test, or a named duplicate. The suite is now 52 tests in 41 spec files.

## Consequences

- One local run of the whole suite on one worker takes 230s. CI splits the suite into five shards of about 45s each by recorded duration (ADR 071).
- A failing step fails its whole flow, and the steps after it do not run. The step title says which behaviour broke. The steps before it say what still works.
- A flow is longer to read than a single test. Each step is a named function above the flow, as CONTRIBUTING already asks for serial stories.
- You can no longer regenerate `docs/research/feature-coverage.md` as it is. Its trace wraps `ipcMain`, and since ADR 114 the calls of an extension view reach main over the port of its frame instead. To measure them again, the app needs a hook in its IPC registry.

## Alternatives Considered

- **Fix each flaky spec where it failed.** The team did this first, for a day. Every fix was real (frame focus, ⌘, forwarding, a delayed autofocus, a click before the draw). But each CI run surfaced the next spec, and the suite stayed as slow as before.
- **Delete the suite and start over.** A new suite would hit the same frame timing gaps. The gaps are in the app, not in how the tests were written. A new suite would also throw away the coverage that the old tests encoded.
- **Retries.** Ruled out by ADR 070.
