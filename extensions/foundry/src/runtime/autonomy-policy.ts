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
 * Anything that could be a shell doing something other than the first word.
 *
 * The same reasoning as the read-only policy: a check that reads `git status`
 * off the front of `git status; rm -rf .` has read the wrong command.
 */
const COMPOUND = /[;&|><`\n\r]|\$\(/

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
  // Unparseable is treated as destructive rather than assumed safe.
  if (COMPOUND.test(command)) return true

  const words = command.trim().split(/\s+/)
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
  const named = pathOf(input)
  if (named === '' || !path.isAbsolute(named)) return false
  const root = path.resolve(worktreePath)
  const target = path.resolve(named)
  return target !== root && !target.startsWith(`${root}${path.sep}`)
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
