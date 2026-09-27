// Bridge module so extension components don't access window.electronAPI.extensionBridge
// directly. All calls go through extensionBridge.invoke via registered IPC handlers.
import type { AgentRun, AgentScope } from '../schemas/review-agent.schema'

const bridge = () => window.electronAPI.extensionBridge

export interface StartReviewAgentInput {
  repoRoot: string
  prNumber: number
  headSHA: string
  baseRefName: string
  title?: string
  body?: string
  scope: AgentScope
  request: 'review' | 'explain' | 'ask'
  question?: string | null
  model?: 'opus' | 'sonnet'
}

export const reviewAgentAPI = {
  start: (input: StartReviewAgentInput) => bridge().invoke('review-agent:start', input),

  cancel: (runId: string) => bridge().invoke('review-agent:cancel', { runId }),

  list: (repoRoot: string, prNumber: number, headSHA: string) =>
    bridge().invoke('review-agent:list', { repoRoot, prNumber, headSHA }),

  dismiss: (payload: {
    repoRoot: string
    prNumber: number
    headSHA: string
    runId: string
    findingId: string
  }) => bridge().invoke('review-agent:dismiss', payload),

  openTerminal: (runId: string) => bridge().invoke('review-agent:open-terminal', { runId }),

  settings: () => bridge().invoke('review-agent:settings', {}),

  onEvent: (cb: (payload: { run: AgentRun }) => void) =>
    bridge().on('review-agent:event', (data: unknown) => cb(data as { run: AgentRun })),
}
