// What a review is allowed to do.
//
// Self-review is an automated gate — format, lint, tests, then a review — so it
// must decide without a person. It previously did that by bypassing permissions
// entirely, which meant a review could rewrite the worktree it was reviewing.
//
// Restricting tools instead does not work, and this was checked rather than
// assumed: with `--allowedTools Read Grep Glob --disallowedTools Write Edit`, an
// agent asked to create a file still created it, because the review needs Bash
// for `git diff` and Bash can write. So the decision has to be made on the
// command, not on the tool.

export interface PolicyDecision {
  readonly allow: boolean
  /** Why, in words the agent reads and a person can act on. */
  readonly reason: string
}

/** Tools that cannot change anything, whatever they are handed. */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Grep',
  'Glob',
  'NotebookRead',
  'TodoWrite',
  'Task',
])

/**
 * Commands a review legitimately needs.
 *
 * Matched on the first word only, and only when the command is a single
 * command — see below. `git` is here because a review is largely `git diff`,
 * and its own sub-commands are checked separately: `git` is not read-only.
 */
const READ_ONLY_BINARIES: ReadonlySet<string> = new Set([
  'cat',
  'head',
  'tail',
  'wc',
  'ls',
  'grep',
  'rg',
  'file',
  'stat',
  'diff',
])

// Deliberately absent, having once been here: `sed` (`-i` edits in place),
// `find` (`-delete`, `-exec`) and `awk` (its own redirection). Each reads by
// default and writes with one flag, which an allowlist matched on the first
// word cannot tell apart. A review that needs them can ask.

/** The git sub-commands that only read. `git checkout` and friends are not here. */
const READ_ONLY_GIT: ReadonlySet<string> = new Set([
  'diff',
  'log',
  'show',
  'status',
  'rev-parse',
  'ls-files',
  'blame',
  'describe',
])

// Also deliberately absent: `config` writes the repository's configuration,
// `branch -D` deletes branches, and `remote add` rewrites where a push goes.
// All three read with no arguments and destroy with one.

/**
 * Anything that chains, redirects or substitutes.
 *
 * This is the load-bearing check. Without it an allowlist is theatre: `git diff`
 * passes, and so does `git diff; rm -rf .`, `git diff > file` and
 * `git diff $(rm -rf .)`. A review never needs any of them, so the whole class
 * is refused rather than parsed.
 *
 * Newlines included, and they were the hole: a shell runs each line of
 * `git diff\nrm -rf .` in turn, while a check that only looked for `;` saw the
 * first word, said "git diff", and allowed it.
 */
const COMPOUND = /[;&|><`\n\r]|\$\(/

export function decideReadOnly(toolName: string, input: unknown): PolicyDecision {
  if (READ_ONLY_TOOLS.has(toolName)) {
    return { allow: true, reason: `${toolName} cannot change anything` }
  }

  if (toolName !== 'Bash') {
    // Write, Edit, NotebookEdit, WebFetch, anything new the runtime grows.
    // Refused by default: a tool this policy has not been taught about is a
    // tool it cannot vouch for, and a review has no business using one.
    return { allow: false, reason: `${toolName} can change things; a review may only read` }
  }

  const command =
    typeof input === 'object' && input !== null
      ? (input as { command?: unknown }).command
      : undefined
  if (typeof command !== 'string' || command.trim() === '') {
    return { allow: false, reason: 'a Bash call with no command cannot be checked' }
  }

  if (COMPOUND.test(command)) {
    return {
      allow: false,
      reason: 'a review may only run a single command with no redirection or chaining',
    }
  }

  const words = command.trim().split(/\s+/)
  const binary = words[0]

  if (binary === 'git') {
    const subcommand = words[1] ?? ''
    return READ_ONLY_GIT.has(subcommand)
      ? { allow: true, reason: `git ${subcommand} only reads` }
      : { allow: false, reason: `git ${subcommand || '(none)'} is not a read-only git command` }
  }

  return READ_ONLY_BINARIES.has(binary)
    ? { allow: true, reason: `${binary} only reads` }
    : { allow: false, reason: `${binary} is not on the review's read-only list` }
}
