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

import { readShell } from './shell-split.js'

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
  // Loading a tool's schema is not using it. Refusing this took a reviewer's
  // ability to reach anything deferred — watched on a live run — and granted
  // nothing in exchange: every tool it surfaces still meets this policy when
  // the agent actually calls it.
  'ToolSearch',
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
  // Changes where the shell is looking, not what is in it.
  'cd',
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

// Also deliberately absent: `config` writes the repository's configuration and
// `remote add` rewrites where a push goes. Both read with no arguments and
// write with one, and the one is a *positional* — `git config x y`,
// `git remote add …` — which no flag rule can see.
//
// `branch` is listed separately below, because its reading form is one an
// agent reaches for constantly and its writing forms are all visible: a flag,
// or a bare name.

/**
 * Chaining, redirection and substitution are read by `shell-split.ts`.
 *
 * That is the load-bearing check, and without it an allowlist is theatre:
 * `git diff` passes, and so does `git diff; rm -rf .`, `git diff > file` and
 * `git diff $(rm -rf .)`. Newlines count as joiners too, and they were the
 * original hole — a shell runs each line of `git diff\nrm -rf .` in turn while
 * a check that only looked for `;` saw the first word and allowed it.
 *
 * It lives there rather than here because the autonomy policy needs the same
 * reading, and because doing it with a regular expression over the raw text
 * cannot see quoting: `grep -E "TTL|15 \\* 60" .` was split into four commands
 * and refused for a fragment of its own pattern.
 */

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

  // Discarding output is not writing. `2>/dev/null` is the first thing any
  // reader reaches for, and refusing it cost four live runs before this: the
  // architect's opening command every time was `… 2>/dev/null`. Only
  // `/dev/null` is stripped, and only as a whole path, so every other
  // redirection is still refused by the test below.
  const withoutDiscards = command.replace(/(?:\d?>>?|&>)\s*\/dev\/null(?=\s|$)/g, ' ')

  // Read with quoting respected, because a quoted string is where an agent's
  // most ordinary command puts its punctuation. Matching `[><`|;&]` against the
  // raw text split `grep -E "TTL|15 \* 60|process\.env" .` into four commands
  // and refused the review with "15 is not on the review's read-only list" — a
  // fragment of a regex reported as a binary. Watched live; the verifier tried
  // three more spellings and gave up.
  const reading = readShell(withoutDiscards)

  if (reading.redirects || reading.substitutes) {
    return {
      allow: false,
      reason: 'a review may not redirect output or run a command inside another',
    }
  }

  // Every segment, not the first one. Each has to read on its own, so the whole
  // reads — and a joined command whose second half writes is refused by the
  // half that writes rather than being missed because the first half was fine.
  const segments = reading.segments
  if (segments.length === 0) {
    return { allow: false, reason: 'a Bash call with no command cannot be checked' }
  }

  let last: PolicyDecision | null = null
  for (const segment of segments) {
    const decision = decideSegment(segment)
    if (!decision.allow) return decision
    last = decision
  }

  return {
    allow: true,
    // One command keeps its own words — `git branch is only listing here` says
    // more than `git only reads`, and the reason is what the agent is told.
    reason:
      segments.length === 1
        ? (last?.reason ?? 'it only reads')
        : `every one of these ${segments.length} commands only reads`,
  }
}

/**
 * `git branch`, when it is only listing.
 *
 * Listing is `git branch`, `-a`, `-r`, `-v`, `--list`, `--format=…` — every
 * argument a flag. Writing is either a flag this refuses, or a bare name:
 * `git branch newname` creates a ref, and nothing about it looks like a flag.
 * So the rule is "flags only, and none of the writing ones".
 */
const BRANCH_WRITING =
  /^(-d|-D|--delete|-m|-M|--move|-c|-C|--copy|-f|--force|--edit-description|-u|--set-upstream-to|--unset-upstream)$/

function branchOnlyLists(args: readonly string[]): boolean {
  return args.every((arg) => arg.startsWith('-') && !BRANCH_WRITING.test(arg))
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

/**
 * A leading `NAME=value` is an environment prefix, not the command.
 *
 * `GIT_PAGER=cat git log` is a reader setting one variable for one command,
 * and taking `GIT_PAGER=cat` as the binary refuses it for not being on a list
 * it could never be on. Stripped, so the command underneath is what gets
 * checked — and `FOO=bar rm x` is still refused, on the `rm`.
 */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** One command, with no joiners left in it. */
function decideSegment(segment: string): PolicyDecision {
  const words = segment.split(/\s+/).filter((word, index, all) => {
    if (!ASSIGNMENT.test(word)) return true
    // Only a *leading* run of them: a `KEY=value` argument in the middle
    // belongs to the command and is none of this function's business.
    return all.slice(0, index).some((earlier) => !ASSIGNMENT.test(earlier))
  })
  if (words.length === 0) {
    return { allow: true, reason: 'setting a variable changes nothing' }
  }
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
    if (subcommand === 'branch') {
      return branchOnlyLists(words.slice(2))
        ? { allow: true, reason: 'git branch is only listing here' }
        : {
            allow: false,
            reason: 'git branch writes a ref unless every argument is a listing flag',
          }
    }
    return READ_ONLY_GIT.has(subcommand)
      ? { allow: true, reason: `git ${subcommand} only reads` }
      : { allow: false, reason: `git ${subcommand || '(none)'} is not a read-only git command` }
  }

  return READ_ONLY_BINARIES.has(binary)
    ? { allow: true, reason: `${binary} only reads` }
    : { allow: false, reason: `${binary} is not on the review's read-only list` }
}
