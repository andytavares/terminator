import * as path from 'node:path'
import type { PolicyDecision } from './read-only-policy.js'
import { decideReadOnly } from './read-only-policy.js'
import {
  ASSIGNMENT,
  commandOf,
  decideByAutonomy,
  isDestructive,
  writesOutside,
} from './autonomy-policy.js'
import { readShell } from './shell-split.js'
import type { Autonomy } from '../gates/autonomy.js'
import { isDocumentationRelative } from '../verify/documentation-path.js'

// What happens when an agent asks to use a tool.
//
// Four things in order, and the order is the whole design: what the role is
// for, what the project declared, what the operator declared, and what the
// autonomy setting allows. It lived inline in `activate`, where nothing could
// test it — the tests that mention `autoDecide` all pass a stub, so they cover
// the bridge that carries a decision and not the decision.
//
// Every live failure of this feature that was not a stall came from here:
//
//   - a read-only role's *allowed* command returned `null`, so it went to an
//     operator anyway and waited five minutes for a fallback
//   - a verifier could not run the project's own test command, which is the
//     one thing FR-033 asks it for
//   - a verifier could not capture an exit status, because the allowance
//     matched whole commands and `npm test; echo "EXIT=$?"` is two
//   - an architect could not read documentation, because a tool nobody had
//     taught the policy about is refused
//
// Four bugs in one composition, none of them visible to a test that grepped
// the source for the right substrings. So it is a function now.

export interface ToolRequest {
  readonly tool: string
  readonly input: unknown
  /** The role may not write, so it is judged by the read-only policy. */
  readonly readOnly: boolean
  /** Null for a bare command — a `run` step, a ladder rung. */
  readonly role: string | null
  /** Whether the role's own file lists the class of work this tool belongs to. */
  readonly mayUseTool: (tool: string) => boolean
  /** Whether this is a command the project itself declared. */
  readonly isProbed: (tool: string, input: unknown) => boolean
  /** Tools the operator has declared read-only. Never inferred. */
  readonly readOnlyTools: readonly string[]
  readonly autonomy: Autonomy
  /** The checkout this unit was given. Empty when there is none. */
  readonly worktreePath: string
  /**
   * The one file a read-only rung may write: where it hands back what it
   * found. Null for a rung with no artefact, and for a role that may write.
   *
   * Matched on the tool's own `file_path`, never on a shell command — a
   * command string cannot be read as "this writes here and nowhere else", and
   * a policy that tried would be an allowlist with a hole in it. The rung's
   * contract says to use Write for exactly that reason.
   */
  readonly outputPath: string | null
  /**
   * Where this node's skills were copied for the agent to read, outside the
   * repository, and passed to it with `--add-dir`. Null when the node has
   * none. They are the factory's, mounted read-only — a run may read them but
   * never change them.
   */
  readonly skillsMount: string | null
  /**
   * The role writes documentation and nothing else (`writes` is exactly
   * `[docs]`). Its file edits are refused outside documentation paths.
   */
  readonly docsOnly?: boolean
  /**
   * The order's own `outputs/` directory, which a role that hands back a
   * document may write into. Null or absent for every other node.
   *
   * It is outside the checkout, so it is allowed here by name rather than left
   * to the rule that asks about writes outside the checkout.
   */
  readonly outputsDir?: string | null
}

/**
 * Whether a path is documentation, by `isDocumentationRelative`'s rule once it
 * is made relative to the checkout. Outside the checkout it never is.
 */
function isDocumentationPath(target: string, worktreePath: string): boolean {
  const relative = path.isAbsolute(target) ? path.relative(worktreePath, target) : target
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false
  return isDocumentationRelative(path.normalize(relative).split(path.sep).join('/'))
}

/** The file a tool call names, when it names one at all. */
function targetOf(input: unknown): string | null {
  const target = (input as { file_path?: unknown } | null)?.file_path
  return typeof target === 'string' ? target : null
}

/** The fields a tool reading or naming a path can use, checked in this order. */
const PATH_FIELDS = ['file_path', 'path', 'notebook_path'] as const

/** The path a tool call names, whichever field it used to name it. */
function pathOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null
  for (const field of PATH_FIELDS) {
    const value = (input as Record<string, unknown>)[field]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/**
 * Whether a named path resolves to the mount itself or somewhere under it.
 *
 * Resolved before comparing, so a `..` segment cannot escape it and a string
 * prefix that merely starts the same way — `/mnt/skills-other` next to
 * `/mnt/skills` — is not mistaken for being inside it.
 */
function isInsideMount(target: string | null, mount: string | null): boolean {
  if (mount === null || target === null) return false
  const resolvedMount = path.resolve(mount)
  const resolvedTarget = path.resolve(target)
  return (
    resolvedTarget === resolvedMount || resolvedTarget.startsWith(`${resolvedMount}${path.sep}`)
  )
}

/** The `gh pr` subcommands that only look. */
const PR_READS = new Set(['view', 'list', 'diff', 'checks', 'status'])

/** Whether any command in a Bash call pushes a branch or changes a pull request. */
function shipsTheBranch(command: string): boolean {
  return readShell(command).segments.some((segment) => {
    const words = segment.trim().split(/\s+/)
    while (words.length > 0 && ASSIGNMENT.test(words[0])) words.shift()
    const binary = path.basename(words[0] ?? '')
    if (binary === 'git') return words[1] === 'push'
    return binary === 'gh' && words[1] === 'pr' && !PR_READS.has(words[2] ?? '')
  })
}

/** What `decideTool` answers: a decision, auto mode's to take, or `null` to ask. */
type ToolAnswer = PolicyDecision | null

/** One of `decideTool`'s rules: its answer, or `undefined` to leave it to the next. */
type ToolRule = (request: ToolRequest) => ToolAnswer | undefined

// A node's skills, mounted read-only outside the repository via `--add-dir`. Checked
// before every other rule, for writers and readers alike: anything undecided is held
// five minutes, too long to pay for reading one's own skill.
function skillsMountRule(request: ToolRequest): PolicyDecision | undefined {
  if (!isInsideMount(pathOf(request.input), request.skillsMount)) return undefined
  if (READ_TOOLS.has(request.tool)) return { allow: true, reason: 'a skill mounted for this node' }
  if (WRITE_TOOLS.has(request.tool)) {
    return {
      allow: false,
      reason: 'skills are mounted read-only; they are the factory’s, not the run’s',
    }
  }
  return undefined
}

function shipsTheBranchRule(request: ToolRequest): PolicyDecision | undefined {
  if (request.tool !== 'Bash' || !shipsTheBranch(commandOf(request.input))) return undefined
  return {
    allow: false,
    reason: 'Foundry pushes the branch and opens the pull request itself; leave both to the line.',
  }
}

function readOnlyRule(request: ToolRequest): PolicyDecision | undefined {
  return request.readOnly ? readOnlyDecision(request) : undefined
}

/** A read-only role's call, decided both ways and never left to a person. */
function readOnlyDecision(request: ToolRequest): PolicyDecision {
  // A role that declared `run_tests` may run the project's own commands and only
  // those: a verifier's verdict needs an exit status the read-only policy would refuse.
  if (request.mayUseTool('run_tests') && request.isProbed(request.tool, request.input)) {
    return { allow: true, reason: "the project's own command, which this role may run" }
  }

  // Tools the operator says only read. An MCP server's tool names are someone else's
  // and do not say whether they write, so Foundry does not guess.
  if (request.readOnlyTools.includes(request.tool)) {
    return { allow: true, reason: 'the operator listed this as a tool that only reads' }
  }

  // The one thing a read-only rung may change, its output file: without it every way a
  // rung tried to hand back its work (`cat >`, `sed`, `Write`) was refused.
  if (request.outputPath !== null && targetOf(request.input) === request.outputPath) {
    return { allow: true, reason: 'this is where this rung hands back what it found' }
  }

  const decision = decideReadOnly(request.tool, request.input)
  // Both ways, never abstaining: `null` on an allowed command held it five minutes,
  // so six calls cost half an hour while the console showed an agent thinking.
  return { allow: decision.allow, reason: decision.reason }
}

// Two gates: read-only decides for the whole role, and this holds a writing role to
// what it said it writes with, so a scribe editing source instead of docs is refused.
function roleToolRule(request: ToolRequest): PolicyDecision | undefined {
  if (request.role === null || request.mayUseTool(request.tool)) return undefined
  return {
    allow: false,
    reason: `the ${request.role} role does not use ${request.tool}; its role file lists what it does`,
  }
}

function docsOnlyRule(request: ToolRequest): PolicyDecision | undefined {
  if (request.docsOnly !== true || !WRITE_TOOLS.has(request.tool)) return undefined
  return docsOnlyWrite(request, pathOf(request.input))
}

/** A documentation-only role's edit: where it hands back, its outputs, documentation, or refused. */
function docsOnlyWrite(request: ToolRequest, target: string | null): PolicyDecision | undefined {
  if (target !== null && target === request.outputPath) {
    return { allow: true, reason: 'this is where this node hands back what it produced' }
  }
  if (isInsideMount(target, request.outputsDir ?? null)) {
    return { allow: true, reason: 'the order’s outputs directory, where a document may go' }
  }
  if (target !== null && isDocumentationPath(target, request.worktreePath)) return undefined
  return {
    allow: false,
    reason: `the ${request.role ?? 'documentation'} role writes documentation only: markdown files, README, CHANGELOG, docs/ and specs/. ${target ?? 'This edit'} is code or configuration, and changing it is the builder's job, not yours.`,
  }
}

/** An agent publishes only its order's document page; nothing else in reach leaves the machine. */
function publishDocumentRule(request: ToolRequest): PolicyDecision | undefined {
  if (request.tool !== 'Artifact' || !isPublish(request.input)) return undefined
  if (publishesOwnDocument(request)) {
    return { allow: true, reason: "publishing the order's own document" }
  }
  return {
    allow: false,
    reason: `publish only the order's document: one page (.html, .htm or .md) in ${request.outputsDir ?? 'the outputs directory of a role that hands back a document'}, with no other files attached`,
  }
}

const PAGE = /\.(html?|md)$/i

/** A publish is the tool's default action; reading or listing artifacts is not one. */
function isPublish(input: unknown): boolean {
  const action = (input as { action?: unknown } | null)?.action
  return action === undefined || action === 'publish'
}

function publishesOwnDocument(request: ToolRequest): boolean {
  const target = pathOf(request.input)
  const attaches = (request.input as { files?: unknown } | null)?.files !== undefined
  return (
    !attaches &&
    target !== null &&
    PAGE.test(target) &&
    isInsideMount(target, request.outputsDir ?? null)
  )
}

// FR-029's automatic half: without it every ordinary edit went to the operator at
// every setting, and no run finished unattended.
function autonomyRule(request: ToolRequest): PolicyDecision | undefined {
  const taken = decideByAutonomy({
    toolName: request.tool,
    input: request.input,
    autonomy: request.autonomy,
    worktreePath: request.worktreePath,
  })
  return taken === null ? undefined : { allow: taken.allow, reason: taken.reason }
}

// At `lights-out` a question has nobody to answer, so it is refused, with why, rather
// than held until the budget ends the run; elsewhere it is asked. Nothing becomes more
// permissive: the agent is told, so it can do the work another way.
function unattendedRule(request: ToolRequest): PolicyDecision | null {
  if (request.autonomy !== 'lights-out') return null
  return { allow: false, reason: whyRefusedUnattended(request) }
}

/** In order: the order is the whole design. What none of them answers, `unattendedRule` does. */
const TOOL_RULES: readonly ToolRule[] = [
  skillsMountRule,
  shipsTheBranchRule,
  readOnlyRule,
  roleToolRule,
  docsOnlyRule,
  publishDocumentRule,
  autonomyRule,
]

// Decide, or hand to the operator: `null` means ask (held, then the inbox). Decisions
// are recorded like any other; the read-only path answers both ways, never abstaining.
export function decideTool(request: ToolRequest): ToolAnswer {
  for (const rule of TOOL_RULES) {
    const answer = rule(request)
    if (answer !== undefined) return answer
  }
  return unattendedRule(request)
}

/**
 * Why a question became a refusal, in words an agent can act on.
 *
 * Not "denied": a reason an agent cannot do anything with wastes the turn it
 * was given to adapt.
 */
function whyRefusedUnattended(request: ToolRequest): string {
  const nobody = 'and nobody is here to be asked — this run is unattended'
  if (isDestructive(request.tool, request.input)) {
    return `this destroys work rather than changing it, ${nobody}. Nothing unattended approves that. Do the work another way, or leave it for a person.`
  }
  if (writesOutside(request.tool, request.input, request.worktreePath)) {
    return `this writes outside the checkout this unit was given, ${nobody}. Write inside the worktree instead — a scratch file belongs there too.`
  }
  return `this needs a decision, ${nobody}. Do the work another way, or leave it for a person.`
}
