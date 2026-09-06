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
  mayUseTool(id: string, tool: string): boolean
  mayWrite(id: string): boolean
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
      return role !== null && role.tools.includes(tool)
    },

    /**
     * A verifier's empty write list is not documentation — it is the reason a
     * verifier that decided to fix what it found could not.
     */
    mayWrite(id) {
      const role = get(id)
      return role !== null && role.writes.length > 0
    },
  }
}
