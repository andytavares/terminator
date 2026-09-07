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
  'pwd',
  'echo',
  'basename',
  'dirname',
  'realpath',
  'sort',
  'uniq',
  'cut',
  'tr',
  'du',
  'tree',
  // `find` reads by default and writes with a flag, and every one of those
  // flags is named in `WRITING_FLAGS` below — which is checked against the
  // whole argument list rather than the first word, so it cannot be slipped
  // past by ordering.
  //
  // It was absent, on the reasoning that a review which needs it can ask. That
  // reasoning was written for a reviewer. It is wrong for a reader: this path
  // *denies*, it never asks, so an architect whose entire job is reading a
  // repository could not explore one. A live run showed it trying three times
  // and giving up — "Bash is restricted to single commands here" — with
  // nothing left it was allowed to run.
  'find',
])

// Deliberately absent, having once been here: `sed` (`-i` edits in place) and
// `awk` (its own redirection, inside the program text where no flag check can
// see it). Each reads by default and writes with one flag or one character,
// which an allowlist matched on the first word cannot tell apart. `sed -i`
// cannot be caught by a general flag rule either, because `-i` is how half the
// reading tools spell "case-insensitive".

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
/**
 * What no amount of per-segment checking can make safe.
 *
 * Redirection writes a file whatever is on the left of it, and a command
 * substitution runs a command this policy would have to parse out of the
 * middle of an argument. Both are refused outright.
 */
const IRREDEEMABLE = /[><`]|\$\(/

/**
 * The operators that join one command to another.
 *
 * Newlines included, and they were the hole the original check existed for: a
 * shell runs each line of `git diff\nrm -rf .` in turn, while a check that only
 * looked at the first word saw "git diff" and allowed it. The answer is not to
 * refuse every compound — a reader composing two reads, `find . | head -50`, is
 * the most ordinary thing in the world, and refusing it left an architect with
 * nothing it could run. The answer is to check *every* segment.
 */
const JOINERS = /\|\||&&|[;|&\n\r]/

/**
 * Flags that make a reading command write or execute.
 *
 * The binary allowlist matches the first word, so it cannot see these. Both are
 * real: `git diff --output=FILE` writes the file, and ripgrep's `--pre` runs an
 * arbitrary program once per file searched — neither needs a shell
 * metacharacter, so `COMPOUND` never sees them either.
 *
 * A denylist of flags is the wrong shape in general, but the alternative here
 * is parsing every tool's option grammar. It is checked against the whole
 * argument list rather than the first word, so it cannot be slipped past by
 * ordering.
 */
const WRITING_FLAGS: ReadonlyArray<RegExp> = [
  // `--output=x`, `--output x`. `-o` is separate, below: it collides.
  /^--output(=|$)/,
  // ripgrep: runs a program per file, and picks the program by glob.
  /^--pre(=|$)/,
  /^--pre-glob(=|$)/,
  /^--hostname-bin(=|$)/,
  // `--exec`/`-exec` on anything that takes it.
  /^--?exec(=|$)/,
  // In-place editing, wherever it turns up.
  //
  // `--in-place` only: bare `-i` is how `grep`, `rg` and `diff` all spell
  // "ignore case", and it meant a reading agent could not search
  // case-insensitively. Nothing on the allowlist writes with `-i` — the tools
  // that do, `sed` and `perl`, are not on it at all, and are refused by the
  // allowlist itself rather than by a flag.
  /^--in-place(=|$)/,
  // `find`'s own ways of writing or executing. `-exec` is covered above.
  /^-delete$/,
  /^-execdir$/,
  /^-ok$/,
  /^-okdir$/,
  /^-fls$/,
  /^-fprint$/,
  /^-fprint0$/,
  /^-fprintf$/,
]

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

  if (IRREDEEMABLE.test(command)) {
    return {
      allow: false,
      reason: 'a review may not redirect output or run a command inside another',
    }
  }

  // Every segment, not the first one. Each has to read on its own, so the whole
  // reads — and a joined command whose second half writes is refused by the
  // half that writes rather than being missed because the first half was fine.
  const segments = command
    .split(JOINERS)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
  if (segments.length === 0) {
    return { allow: false, reason: 'a Bash call with no command cannot be checked' }
  }

  for (const segment of segments) {
    const decision = decideSegment(segment)
    if (!decision.allow) return decision
  }

  return {
    allow: true,
    reason:
      segments.length === 1
        ? `${segments[0].split(/\s+/)[0]} only reads`
        : `every one of these ${segments.length} commands only reads`,
  }
}

/**
 * `-o` writes on most things and means "or" on `find`.
 *
 * `sort -o file` and `cc -o binary` really do write, so it cannot simply be
 * dropped; `find . -name a -o -name b` is a reader's bread and butter, so it
 * cannot simply be kept. It is the one flag whose meaning depends on what is
 * running it, and saying that here is cheaper than a table of every tool's
 * option grammar.
 */
function writesWithDashO(binary: string): boolean {
  return binary !== 'find'
}

/** One command, with no joiners left in it. */
function decideSegment(segment: string): PolicyDecision {
  const words = segment.split(/\s+/)
  const binary = words[0]

  const flags = writesWithDashO(binary) ? [...WRITING_FLAGS, /^-o$/] : WRITING_FLAGS
  const writing = words.slice(1).find((word) => flags.some((flag) => flag.test(word)))
  if (writing !== undefined) {
    return {
      allow: false,
      reason: `${writing} makes this write or execute, which a review may not do`,
    }
  }

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
