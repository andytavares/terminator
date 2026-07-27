import type { RuntimeState } from '../../../shared/types/supervision.js'

// FR-036: a session that is still running cannot be archived. Zed's invariant,
// and the reason is the same — archiving live work loses it, and the operator
// asking to archive is rarely asking to discard.

/** States where nothing further will happen, so archiving is safe. */
const SETTLED: ReadonlySet<RuntimeState> = new Set<RuntimeState>(['ready', 'failed', 'merged'])

export interface ArchiveDecision {
  readonly allowed: boolean
  readonly reason: string | null
}

export function mayArchive(runtimeState: RuntimeState): ArchiveDecision {
  if (SETTLED.has(runtimeState)) return { allowed: true, reason: null }

  // `unknown` is deliberately not archivable: we do not know whether the agent
  // is still working, and guessing wrong destroys the worktree under it.
  return {
    allowed: false,
    reason: `this session is ${runtimeState}; stop it before archiving`,
  }
}
