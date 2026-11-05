import { tmpdir } from 'node:os'
import type { RunAgentOnceInput, RunAgentOnceResult } from '@terminator/extension-sdk'

// Asks the agent, with no tools and no tab, for a branch name for a typed prompt.

const NAMING_MODEL = 'claude-haiku-5-5'
/** @internal */
export const NAMING_TIMEOUT_MS = 5_000

/** @internal */
export const NAMING_INSTRUCTION =
  'Reply with only a git branch name for the task: "feat/" or "fix/" and two to five lowercase ' +
  'words joined by hyphens. No quotes, no explanation.'

export interface BranchNamerDeps {
  runOnce: (input: RunAgentOnceInput) => Promise<RunAgentOnceResult>
  ready: () => Promise<void>
}

/** The agent's raw reply, or an error; the caller checks the name and has its own fallback. */
export function createBranchNamer(deps: BranchNamerDeps) {
  return async function nameBranch(prompt: string): Promise<{ text: string } | { error: string }> {
    await deps.ready()
    const result = await deps.runOnce({
      cwd: tmpdir(),
      prompt: `${NAMING_INSTRUCTION}\n\nTask: ${prompt}`,
      mode: 'default',
      agentMeta: {
        claudeCode: {
          options: {
            model: NAMING_MODEL,
            tools: [],
            systemPrompt: NAMING_INSTRUCTION,
            persistSession: false,
          },
        },
      },
      timeoutMs: NAMING_TIMEOUT_MS,
    })
    return 'text' in result ? { text: result.text } : { error: result.error }
  }
}
