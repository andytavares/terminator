/**
 * A Claude session id, and nothing else.
 *
 * The id is typed into a shell as `claude --resume <id>`, so it is checked rather than escaped:
 * anything that is not one is a report this application should not have kept.
 */
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
