import { isAbsolute } from 'path'
import type { ChannelSpec } from '@terminator/extension-sdk'

/** What a channel answers for a repository whose workspace switched Git Integration off. */
const GIT_DISABLED = { error: 'GIT_DISABLED' }

/** The repository a payload names: its `repoRoot`, else `path` (git:status), when absolute. */
function repositoryOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const { repoRoot, path } = payload as { repoRoot?: unknown; path?: unknown }
  const root = typeof repoRoot === 'string' ? repoRoot : path
  return typeof root === 'string' && isAbsolute(root) ? root : undefined
}

/**
 * `spec`, answering GIT_DISABLED instead of running where "Enable Git
 * Integration" is off: in the workspace of the repository the payload names,
 * or globally for a payload that names none (a `gh:owner/name` root included).
 */
export function gatedByWorkspace(
  spec: ChannelSpec,
  isEnabled: (repoPath?: string) => boolean
): ChannelSpec {
  return {
    ...spec,
    run: (payload) => (isEnabled(repositoryOf(payload)) ? spec.run(payload) : GIT_DISABLED),
  }
}
