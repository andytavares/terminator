import * as path from 'node:path'
import type { PolicyDecision } from './read-only-policy.js'
import { decideReadOnly } from './read-only-policy.js'
import { decideByAutonomy, isDestructive, writesOutside } from './autonomy-policy.js'
import type { Autonomy } from '../gates/autonomy.js'

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
}

/**
 * Decide, or hand it to the operator.
 *
 * `null` means "ask": the hook holds the call and it reaches the inbox. A
 * decision either way is recorded on the run like any other, and is never a
 * bypass — the read-only path in particular answers **both** ways rather than
 * abstaining, because a read-only role exists to decide without a person.
 */
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

export function decideTool(request: ToolRequest): PolicyDecision | null {
  // A node's skills, mounted read-only outside the repository and handed to
  // the agent with `--add-dir`. Anything `decideTool` does not decide is held
  // for five minutes, so a read of the mount that fell through to "ask" would
  // cost the run five minutes for looking at its own skill — this runs before
  // every other branch, for a role that may write and one that may not alike.
  if (READ_TOOLS.has(request.tool) && isInsideMount(pathOf(request.input), request.skillsMount)) {
    return { allow: true, reason: 'a skill mounted for this node' }
  }
  if (WRITE_TOOLS.has(request.tool) && isInsideMount(pathOf(request.input), request.skillsMount)) {
    return {
      allow: false,
      reason: 'skills are mounted read-only; they are the factory’s, not the run’s',
    }
  }

  if (request.readOnly) {
    // A role that declared `run_tests` may run the project's own commands, and
    // only those. The verifier's whole job is a verdict from an exit status,
    // and the read-only policy refuses `npm test` like any other unknown
    // binary — so the role vocabulary said one thing and the gate did another.
    if (request.mayUseTool('run_tests') && request.isProbed(request.tool, request.input)) {
      return { allow: true, reason: "the project's own command, which this role may run" }
    }

    // Tools the operator has said only read. The policy refuses any tool it has
    // not been taught about, which is right — an MCP server's tools are named
    // by somebody else, and `mcp__…__save_issue` and `mcp__…__query_docs` are
    // the same shape to anything reading names. Foundry does not guess which of
    // them read; the operator says.
    if (request.readOnlyTools.includes(request.tool)) {
      return { allow: true, reason: 'the operator listed this as a tool that only reads' }
    }

    // The one thing a read-only rung is allowed to change. Without it the
    // policy refused every channel a rung invented for itself — `cat >`,
    // `sed`, `awk`, then `Write` — so four of the standard shape's nine steps
    // could not hand back a word of what they had worked out. Watched live: an
    // architect lost a complete corrected order to "a review may not redirect
    // output" while the builders it had just contradicted were starting.
    if (request.outputPath !== null && targetOf(request.input) === request.outputPath) {
      return { allow: true, reason: 'this is where this rung hands back what it found' }
    }

    const decision = decideReadOnly(request.tool, request.input)
    // Both ways, never abstaining. Returning `null` on an *allowed* command
    // sent it to the operator anyway, where it sat for the five-minute hold
    // before falling back to the terminal. Six tool calls was half an hour of
    // waiting, and the console showed an agent thinking.
    return { allow: decision.allow, reason: decision.reason }
  }

  // Two gates, not one. Read-only is the whole-role decision; this holds a role
  // that may write to what it said it writes with — a scribe that decided to
  // edit source rather than documentation is refused here, and by neither if
  // the only check were "may this role write at all".
  if (request.role !== null && !request.mayUseTool(request.tool)) {
    return {
      allow: false,
      reason: `the ${request.role} role does not use ${request.tool}; its role file lists what it does`,
    }
  }

  // FR-029's automatic half. Without it every ordinary edit went to the
  // operator at every setting, so no run finished unattended and "lights-out"
  // named something the factory could not do.
  const taken = decideByAutonomy({
    toolName: request.tool,
    input: request.input,
    autonomy: request.autonomy,
    worktreePath: request.worktreePath,
  })
  if (taken !== null) return { allow: taken.allow, reason: taken.reason }

  // At `lights-out` a question has nobody to answer it, so it is a refusal
  // rather than a wait.
  //
  // Asking is right whenever somebody is there. When nobody is, the held call
  // goes to the operator, then five minutes later to the runtime's own prompt
  // in the terminal, and the agent stands at that prompt until the wall-clock
  // budget ends the run. Measured on a live run: the builder redirected its
  // test output to a scratch file, which is outside the checkout and so worth
  // a question, and thirty minutes later the order had shipped nothing.
  //
  // **Nothing becomes more permissive.** The action is refused, exactly as an
  // unanswered question refused it — the difference is that the agent is told,
  // and told why, so it can do the same work another way. They do: the
  // read-only roles work around this policy's refusals all day.
  if (request.autonomy === 'lights-out') {
    return { allow: false, reason: whyRefusedUnattended(request) }
  }
  return null
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
