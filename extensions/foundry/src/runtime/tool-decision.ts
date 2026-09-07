import type { PolicyDecision } from './read-only-policy.js'
import { decideReadOnly } from './read-only-policy.js'
import { decideByAutonomy } from './autonomy-policy.js'
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
}

/**
 * Decide, or hand it to the operator.
 *
 * `null` means "ask": the hook holds the call and it reaches the inbox. A
 * decision either way is recorded on the run like any other, and is never a
 * bypass — the read-only path in particular answers **both** ways rather than
 * abstaining, because a read-only role exists to decide without a person.
 */
export function decideTool(request: ToolRequest): PolicyDecision | null {
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
  return taken === null ? null : { allow: taken.allow, reason: taken.reason }
}
