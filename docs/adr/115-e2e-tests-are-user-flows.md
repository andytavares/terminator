# ADR 115: E2E tests are user flows

**Status**: Accepted
**Date**: 2026-10-16
**Relates to**: [ADR 070](070-e2e-is-deterministic-and-selective.md), [ADR 071](071-ci-is-sharded-by-duration-and-warns-nothing.md), [ADR 114](114-extension-views-are-frames-in-the-window.md)

## Context

The suite had grown to 418 `test()`s in 90 spec files, which launched the app 130 times. Most tests checked one thing: that a folder path is abbreviated, that a count is right-aligned, that a channel refuses a command. Those are unit and component checks, run at the cost of a whole app. When extension views became frames (ADR 114), every test that touched a view could meet a timing gap between the page and the browser: a click routed by a frame not yet drawn, a key heard by a frame instead of the host, a theme that arrives a moment later. More single-thing tests meant more draws of those gaps, and CI failed on a different spec each run.

## Decision

**An e2e test is one user journey, from start to finish. A check of one thing is a unit or component test.**

- A flow is one `test()`, named for what the user achieves. Its steps are `test.step()`s that keep the behaviour each used to check in their titles, so a failure still names it.
- A spec file launches the app once, in `beforeAll`. A flow restarts the app only when surviving a restart is what it checks.
- A single-component or channel-contract check goes down to a unit or component test, written first and shown to fail when the behaviour is wrong.
- Layout, contrast and alignment audits that need a real render run as a step at the end of the flow that already has the surface on screen.
- Plain-Chromium renders without the app (`design-system-fields`, `git-integration-contrast`, `git-integration-stacking`) are one test each, with a step per case.

The rewrite moved every old test to exactly one place: a step in a flow, a new unit test, an existing unit test, or a named duplicate. The suite is now 52 tests in 41 spec files.

## Consequences

- One local run of the whole suite on one worker takes 230s, split into five CI shards of about 45s each by recorded duration (ADR 071).
- A failing step fails its whole flow, and the steps after it don't run. The step title says which behaviour broke; the steps before it say what still works.
- A flow is longer to read than a single test. Each step is a named function above the flow, as CONTRIBUTING already asks for serial stories.
- `docs/research/feature-coverage.md` can no longer be regenerated as is: its trace wraps `ipcMain`, and since ADR 114 an extension view's calls reach main over its frame's port instead. Measuring them again needs a hook in the app's IPC registry.

## Alternatives Considered

- **Fix each flaky spec where it failed.** Done first, for a day. Every fix was real (frame focus, ⌘, forwarding, a delayed autofocus, a click before the draw), but each CI run surfaced the next spec, and the suite stayed as slow as before.
- **Delete the suite and start over.** It would hit the same frame timing gaps, which are in the app, not in how the tests were written, and it would throw away the coverage the old tests encoded.
- **Retries.** Ruled out by ADR 070.
