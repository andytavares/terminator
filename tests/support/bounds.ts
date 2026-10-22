// The only time limits a test has (ADR 123). Each exists to catch a hang, never to time the
// code: set far above the slowest real duration on the slowest machine that runs the suite.

/** A test or a hook that has not settled by now is hung. */
export const HANG_BOUND_MS = 60_000

/** A wait on a condition (`eventually`, `expect.poll`) that has not held by now never will. */
export const WAIT_BOUND_MS = 30_000

/** An app that has not started by now is hung; the e2e test's own bound is 180 s
 * (playwright.config.ts), and a failed launch spends a few more seconds reporting why. */
export const E2E_LAUNCH_HANG_MS = 120_000
