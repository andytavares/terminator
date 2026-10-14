/** Set on every git the app runs, which is a background process to the person's own git. With
 * optional locks off, `git status` does not rewrite `.git/index`: that would lock the index against
 * their command and report a change to the file watch (https://git-scm.com/docs/git, ADR 108). */
export const BACKGROUND_GIT = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }

export const GIT_ENV: NodeJS.ProcessEnv = { ...process.env, ...BACKGROUND_GIT }
