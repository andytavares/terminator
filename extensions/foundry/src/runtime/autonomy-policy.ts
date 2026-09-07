import * as fs from 'node:fs'
import * as path from 'node:path'
import type { PolicyDecision } from './read-only-policy.js'
import type { Autonomy } from '../gates/autonomy.js'

// Which of an agent's actions are taken for it, and which wait for a person.
//
// FR-029: every action an agent takes is held against a decision — *automatic
// where the autonomy setting allows it*, and by asking where it does not. The
// automatic half did not exist: a builder's first `Edit` went to the operator
// at every setting, so no run could finish unattended and "lights-out" named
// something the factory could not do. A live run sat for half an hour with a
// clean worktree and an agent waiting on a click nobody was there to make.
//
// FR-050 fixes the other end: four things ask at every setting. Two of them
// are gates and live in `gates/rules.ts`. The two that are tool calls are
// here — a destructive action, and a write outside the checkout this unit was
// given.

/** Commands that destroy work rather than change it. Never automatic. */
const DESTRUCTIVE_GIT: ReadonlySet<string> = new Set([
  'reset',
  'clean',
  'rebase',
  'filter-branch',
  'gc',
  'prune',
  'update-ref',
  'reflog',
])

/**
 * Binaries whose whole job is removing or overwriting.
 *
 * Matched on the first word. `rm` is here even without `-rf`: an agent that
 * decided to delete a file is a decision, not a step.
 */
const DESTRUCTIVE_BINARIES: ReadonlySet<string> = new Set([
  'rm',
  'rmdir',
  'shred',
  'dd',
  'mkfs',
  'truncate',
  'dropdb',
  'kill',
  'killall',
  'pkill',
  'chown',
  'chmod',
])

/** Flags that turn an ordinary command destructive. */
const DESTRUCTIVE_FLAGS: ReadonlyArray<RegExp> = [
  /^--force$/,
  /^-f$/,
  /^--force-with-lease(=|$)/,
  /^--hard$/,
  /^--delete$/,
  /^-D$/,
  /^--prune$/,
]

/**
 * A command built inside another, which cannot be read off the text.
 *
 * Backticks and `$(…)` only: whatever they expand to is not in front of us, so
 * the honest answer is to ask.
 */
const OPAQUE = /[`]|\$\(/

/**
 * The operators that join one command to another.
 *
 * This used to be a blanket refusal of every compound command, on the same
 * reasoning the read-only policy started from: reading `git status` off the
 * front of `git status; rm -rf .` reads the wrong command. But refusing the
 * whole shape does not stop at the dangerous ones — `pwd && git status` and
 * `npm test 2>&1 | tail -20` are the ordinary sentences every agent writes,
 * and each of them was classified as destroying work and sent to an operator.
 * At *every* setting, lights-out included.
 *
 * That is why builders sat doing nothing while the graph said `running`: the
 * automatic half of FR-029 existed and almost nothing reached it. The answer
 * is the one the read-only policy already arrived at — judge every segment.
 */
const JOINERS = /\|\||&&|[;|&\n\r]/

/** Output thrown away, and stderr folded into stdout. Neither writes. */
const DISCARDS = /(?:\d?>>?|&>)\s*\/dev\/null(?=\s|$)|2>&1/g

/** Where a segment redirects to, if anywhere. A redirect is a write. */
function redirectTargets(command: string): string[] {
  const targets: string[] = []
  const pattern = /(?:\d?>>?|&>)\s*("[^"]*"|'[^']*'|[^\s;|&]+)/g
  let match: RegExpExecArray | null = pattern.exec(command)
  while (match !== null) {
    targets.push(match[1].replace(/^["']|["']$/g, ''))
    match = pattern.exec(command)
  }
  return targets
}

/** The tools that name a path, and the field each names it in. */
const PATH_FIELDS = ['file_path', 'path', 'notebook_path'] as const

function commandOf(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const command = (input as { command?: unknown }).command
  return typeof command === 'string' ? command : ''
}

function pathOf(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  for (const field of PATH_FIELDS) {
    const value = (input as Record<string, unknown>)[field]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return ''
}

/**
 * Whether this call destroys rather than changes.
 *
 * Deliberately generous: the cost of asking about one more `git clean` is a
 * click, and the cost of not asking is work that cannot be recovered.
 */
export function isDestructive(toolName: string, input: unknown): boolean {
  if (toolName !== 'Bash') return false
  const command = commandOf(input)
  if (command.trim() === '') return false

  const readable = command.replace(DISCARDS, ' ')
  // Unparseable is treated as destructive rather than assumed safe.
  if (OPAQUE.test(readable)) return true

  // Every segment, not the first one — and not the whole shape. A joined
  // command whose second half destroys is caught by that half; one whose two
  // halves both read is ordinary work.
  return readable
    .split(JOINERS)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
    .some(destructiveSegment)
}

/** `FOO=bar cmd` is `cmd`; without this the binary reads as the assignment. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** One command, with nothing joined to it. */
function destructiveSegment(segment: string): boolean {
  // A redirection is a write of the file it names, which `writesOutside`
  // judges. What is in front of it is judged here, on its own words.
  const bare = segment.replace(/(?:\d?>>?|&>)\s*("[^"]*"|'[^']*'|[^\s]+)/g, ' ').trim()
  const words = bare.split(/\s+/).filter((word) => word !== '')
  while (words.length > 0 && ASSIGNMENT.test(words[0])) words.shift()
  if (words.length === 0) return false
  const binary = path.basename(words[0] ?? '')
  if (DESTRUCTIVE_BINARIES.has(binary)) return true

  const flags = words.slice(1)
  if (binary === 'git') {
    const subcommand = words[1] ?? ''
    if (DESTRUCTIVE_GIT.has(subcommand)) return true
    // A force push rewrites what other people have.
    if (subcommand === 'push' && flags.some((f) => DESTRUCTIVE_FLAGS.some((r) => r.test(f)))) {
      return true
    }
    if (subcommand === 'branch' && flags.some((f) => /^-D$|^--delete$/.test(f))) return true
    return false
  }

  return flags.some((flag) => DESTRUCTIVE_FLAGS.some((rule) => rule.test(flag)))
}

/**
 * Whether this call writes somewhere the unit was not given.
 *
 * A unit works in its own checkout. A path outside it is either a mistake or
 * something the operator should see, and both are worth one click.
 */
export function writesOutside(toolName: string, input: unknown, worktreePath: string): boolean {
  if (worktreePath.trim() === '') return false
  // Both names for the directory. macOS hands out `/var/folders/…` and
  // `/private/var/folders/…` for the same place, and `path.resolve` does not
  // follow symlinks — so a checkout known by one name and a file written under
  // the other read as different directories, and every ordinary edit inside
  // the unit's own worktree would ask at every setting. The same coin flip
  // that left agents sitting at the trust dialog.
  const roots = [...new Set([path.resolve(worktreePath), realPath(worktreePath)])]
  const outside = (named: string): boolean => {
    if (named === '' || !path.isAbsolute(named)) return false
    const targets = [...new Set([path.resolve(named), realPath(named)])]
    return !targets.some((target) =>
      roots.some((root) => target === root || target.startsWith(`${root}${path.sep}`))
    )
  }

  // A shell redirection is a write too, and it names its file in the command
  // rather than in a field. This used to be covered by accident, because every
  // command containing `>` was called destructive; the redirect has to be read
  // properly now that ordinary compound commands are not.
  if (toolName === 'Bash') {
    return redirectTargets(commandOf(input).replace(DISCARDS, ' ')).some(outside)
  }
  return outside(pathOf(input))
}

/**
 * The path with every symlink resolved, or the path itself.
 *
 * A file being written may not exist yet, so this resolves the deepest part
 * that does and puts the rest back on — `realpathSync` of a missing file
 * throws, and treating that as "unresolvable" would put every new file the
 * builder creates back outside the checkout.
 */
function realPath(target: string): string {
  const absolute = path.resolve(target)
  let head = absolute
  const tail: string[] = []
  for (;;) {
    try {
      return path.join(fs.realpathSync(head), ...tail)
    } catch {
      const parent = path.dirname(head)
      // The root, and nothing along the way resolved.
      if (parent === head) return absolute
      tail.unshift(path.basename(head))
      head = parent
    }
  }
}

export interface AutonomyInput {
  readonly toolName: string
  readonly input: unknown
  readonly autonomy: Autonomy
  /** The checkout this unit was given. Empty when there is none. */
  readonly worktreePath: string
}

/**
 * Take the decision, or say it is the operator's.
 *
 * `null` means "ask" — the hook holds the call and it reaches the inbox, which
 * is what every call used to do. A decision here is recorded on the run like
 * any other; it is not a bypass.
 */
export function decideByAutonomy(input: AutonomyInput): PolicyDecision | null {
  if (isDestructive(input.toolName, input.input)) {
    // FR-050: at every setting, including the most permissive.
    return null
  }
  if (writesOutside(input.toolName, input.input, input.worktreePath)) {
    return null
  }
  if (input.autonomy === 'escorted') {
    // The setting whose whole meaning is "ask me".
    return null
  }
  return {
    allow: true,
    reason: `${input.autonomy} takes ordinary work inside the unit's own checkout`,
  }
}
