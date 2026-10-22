// The only time limits a test has (ADR 123). Each exists to catch a hang, never to time the
// code: set far above the slowest real duration on the slowest machine that runs the suite.

/** A test or a hook that has not settled by now is hung. */
export const HANG_BOUND_MS = 60_000

/** A wait on a condition (`eventually`, `expect.poll`) that has not held by now never will. */
export const WAIT_BOUND_MS = 30_000
