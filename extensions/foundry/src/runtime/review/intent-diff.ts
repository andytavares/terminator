// The intent step (FR-051): the original request set against the agent's own
// account of what it did, with work outside the request called out.
//
// This is the step every diff viewer skips, and the one that catches the "also
// shortened the idle timeout" class of change — work that is defensible in
// isolation and was never asked for.

export interface IntentInput {
  /** What the operator asked for: the lane's tasks, or the prompt for ad-hoc work. */
  readonly request: string
  /** The agent's own summary of what it did. */
  readonly agentAccount: string
  /** Files the change actually touched. */
  readonly changedFiles: readonly string[]
  /** Files the request named or implied, when the work item declared them. */
  readonly expectedFiles: readonly string[]
}

export interface IntentReview {
  readonly request: string
  readonly agentAccount: string
  /** Touched but not anticipated by the request. The scope-creep signal. */
  readonly unexpectedFiles: string[]
  /** Anticipated but never touched. Often means the task was not actually done. */
  readonly untouchedFiles: string[]
  readonly hasScopeConcern: boolean
}

export function reviewIntent(input: IntentInput): IntentReview {
  const changed = new Set(input.changedFiles)
  const expected = new Set(input.expectedFiles)

  // With nothing declared we cannot distinguish in-scope from out-of-scope, and
  // flagging every file as unexpected would be noise that trains the operator
  // to skip this step — which is exactly what it exists to prevent.
  const unexpectedFiles =
    expected.size === 0 ? [] : [...changed].filter((file) => !expected.has(file)).sort()

  const untouchedFiles = [...expected].filter((file) => !changed.has(file)).sort()

  return {
    request: input.request,
    agentAccount: input.agentAccount,
    unexpectedFiles,
    untouchedFiles,
    hasScopeConcern: unexpectedFiles.length > 0 || untouchedFiles.length > 0,
  }
}
