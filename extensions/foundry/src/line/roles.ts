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

/** @internal */
export class ResumeForbiddenError extends Error {
  readonly code = 'ROLE_MAY_NOT_RESUME'
  constructor(roleId: string) {
    super(
      `The "${roleId}" role may not resume a conversation. Its whole value is a context that has not already been persuaded by the work it is checking.`
    )
    this.name = 'ResumeForbiddenError'
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
  /** Whether the only thing this role writes is documentation. */
  writesOnlyDocs(id: string): boolean
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

  function roleById(id: string): Role | null {
    const cached = cache.get(id)
    if (cached !== undefined) return cached
    const result = resolveRole(id, sources)
    const role = result.ok ? result.resolved.value : null
    cache.set(id, role)
    return role
  }

  return {
    get: roleById,
    assertResumable(id, resumeSessionId) {
      if (resumeSessionId === undefined) return
      // An unknown role is treated as non-resumable. Defaulting the other way
      // would mean a typo in a recipe silently produced a verifier that could
      // read the builder's reasoning.
      if (roleById(id)?.allowResume !== true) throw new ResumeForbiddenError(id)
    },
    // Unknown is non-resumable, for the same reason `assertResumable` treats
    // it that way: a typo in a recipe must not produce a verifier that can
    // read the builder's reasoning.
    mayResume: (id) => roleById(id)?.allowResume === true,
    mayUseTool: (id, tool) => mayUseTool(roleById(id), tool),
    writesOnlyDocs: (id) => writesOnlyDocs(roleById(id)),
    mayWrite: (id) => mayWrite(roleById(id)),
  }
}

function mayUseTool(role: Role | null, tool: string): boolean {
  if (role === null) return false
  const needed = TOOL_CLASS[tool]
  // A tool this vocabulary says nothing about. Allowed — refusing every
  // unlisted tool would refuse the ones every agent uses to think.
  if (needed === undefined) return true
  return role.tools.includes(needed)
}

// Whether this role may write to the checkout, not whether it writes anything: the
// red team, scheduler and architect write elsewhere, and asking `writes.length > 0`
// let the adversarial pass edit the code it reviewed.
function mayWrite(role: Role | null): boolean {
  return role !== null && role.writes.some((target) => CHECKOUT_WRITES.has(target))
}

/** Whether the only part of the checkout this role edits is its documentation. */
function writesOnlyDocs(role: Role | null): boolean {
  if (role === null) return false
  // `document` is what the role reports, not somewhere it edits.
  const edited = role.writes.filter((target) => target !== 'document')
  return edited.length === 1 && edited[0] === 'docs'
}
