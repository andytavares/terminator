export const EXIT_SUCCESS = 0
/** The tool ran and returned an error. */
export const EXIT_TOOL_ERROR = 1
/** A usage error, or a destructive command that was refused or declined. */
export const EXIT_USAGE = 2
export const EXIT_NOT_RUNNING = 3

/** A command line termctl cannot run. Its message goes to stderr as it is. */
export class UsageError extends Error {}
