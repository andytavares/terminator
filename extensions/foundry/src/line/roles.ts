import { resolveRole } from '../recipe/resolve.js'
import type { ResolveSources } from '../recipe/resolve.js'
import type { Role } from '../recipe/parse.js'

// What an agent is for.
//
// A role is not a personality. It is four things a scheduler can reason about:
// a prompt contract, a tool allowlist, a model tier and an output schema. That
// is what "optimise for agents" cashes out to — no role parses another role's
// prose, because every role emits something typed.
//
// One property here is load-bearing above all others: a verifier may not resume
// a conversation. The builder's justification is in that context window, and
// asking a model to ignore what it can see is not a control. Making it
// structural — the runner refuses to start a non-resumable role with a session
// to resume — is.

export class ResumeForbiddenError extends Error {
  readonly code = 'ROLE_MAY_NOT_RESUME'
  constructor(roleId: string) {
    super(
      `The "${roleId}" role may not resume a conversation. Its whole value is a context that has not already been persuaded by the work it is checking.`
    )
    this.name = 'ResumeForbiddenError'
  }
}

export class ToolNotAllowedError extends Error {
  readonly code = 'TOOL_NOT_ALLOWED'
  constructor(roleId: string, tool: string) {
    super(`The "${roleId}" role may not use ${tool}.`)
    this.name = 'ToolNotAllowedError'
  }
}

export interface RoleRegistry {
  get(id: string): Role | null
  /** Throws when a role that may not resume is handed a session to resume. */
  assertResumable(id: string, resumeSessionId: string | undefined): void
  /**
   * Whether this role may carry on in an open conversation.
   *
   * Asked *before* offering one, so a caller does not have to construct a
   * forbidden call to find out. `assertResumable` is still what enforces it —
   * this is the polite half, and the refusal is the structural one.
   */
  mayResume(id: string): boolean
  /**
   * Whether this role declared the class of work a tool belongs to.
   *
   * Takes the tool's own name — `Edit`, `Bash`, `Read` — and maps it to the
   * vocabulary a role file uses. A tool in no class is allowed: the point is
   * to hold a role to what it said it does, not to enumerate every tool an
   * agent might reach for.
   */
  mayUseTool(id: string, tool: string): boolean
  mayWrite(id: string): boolean
}

/**
 * The `writes:` destinations that mean "this role edits files in the working
 * copy". Everything else a role writes — findings, a plan, a schedule — is an
 * artefact it returns, not a change to the repository.
 */
const CHECKOUT_WRITES: ReadonlySet<string> = new Set(['worktree', 'integration_branch', 'docs'])

/**
 * Which word in a role's `tools:` list a given tool needs.
 *
 * Only the writing tools are mapped. `Bash` is deliberately absent: a role's
 * `run_tests` and `git` both arrive as Bash, and telling them apart is the
 * read-only policy's job, which already reads the command rather than the
 * tool name.
 */
const TOOL_CLASS: Record<string, string | undefined> = {
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
}

export function createRoleRegistry(sources: ResolveSources): RoleRegistry {
  const cache = new Map<string, Role | null>()

  function get(id: string): Role | null {
    const cached = cache.get(id)
    if (cached !== undefined) return cached
    const result = resolveRole(id, sources)
    const role = result.ok ? result.resolved.value : null
    cache.set(id, role)
    return role
  }

  return {
    get,

    assertResumable(id, resumeSessionId) {
      if (resumeSessionId === undefined) return
      const role = get(id)
      // An unknown role is treated as non-resumable. Defaulting the other way
      // would mean a typo in a recipe silently produced a verifier that could
      // read the builder's reasoning.
      if (role === null || !role.allowResume) throw new ResumeForbiddenError(id)
    },

    mayResume(id) {
      // Unknown is non-resumable, for the same reason `assertResumable`
      // treats it that way: a typo in a recipe must not produce a verifier
      // that can read the builder's reasoning.
      return get(id)?.allowResume === true
    },

    mayUseTool(id, tool) {
      const role = get(id)
      if (role === null) return false
      const needed = TOOL_CLASS[tool]
      // A tool this vocabulary says nothing about. Allowed — refusing every
      // unlisted tool would refuse the ones every agent uses to think.
      if (needed === undefined) return true
      return role.tools.includes(needed)
    },

    /**
     * Whether this role may write to the checkout.
     *
     * Not "does it write anything": the red team writes findings, the foreman
     * writes a schedule and the architect writes a plan, and none of them
     * touches the repository. This asked `writes.length > 0`, so all three
     * came back true, and the executor installs its read-only policy on the
     * answer — the adversarial pass could edit the code it was reviewing.
     *
     * Three destinations are the checkout, and they are the same three the
     * built-in role tests already name.
     */
    mayWrite(id) {
      const role = get(id)
      return role !== null && role.writes.some((target) => CHECKOUT_WRITES.has(target))
    },
  }
}
