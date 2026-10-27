import type { AgentState, CustomAction } from '../../shared/types'
import { expandVariables, type VarName } from './variables'
import { pastedLine } from '../terminal/typed-input'

export interface CustomRunEnv {
  focused: {
    sessionId: string
    isAgent: boolean
    /** An agent tab (ACP) takes a prompt as a message; a terminal takes typed keys. */
    isAgentTab?: boolean
    agentState: AgentState
  } | null
  projectId: string | null
  vars: Partial<Record<VarName, string | null>>
}

export type CustomRunPlan =
  | { ok: false; reason: string }
  | { ok: true; kind: 'input'; sessionId: string; data: string }
  | { ok: true; kind: 'agent-prompt'; sessionId: string; text: string }
  | { ok: true; kind: 'new-tab'; projectId: string; data: string }

export const MAX_TYPED_LINE_BYTES = 1024

function planPrompt(a: CustomAction, env: CustomRunEnv, text: string): CustomRunPlan {
  if (!env.focused || !env.focused.isAgent) {
    return { ok: false, reason: 'Focused terminal is not an agent session' }
  }
  if (env.focused.agentState === 'working') {
    return { ok: false, reason: 'The agent is mid-turn' }
  }
  const { sessionId, isAgentTab } = env.focused
  if (isAgentTab) return { ok: true, kind: 'agent-prompt', sessionId, text }
  return { ok: true, kind: 'input', sessionId, data: pastedLine(text) }
}

function planShell(a: CustomAction, env: CustomRunEnv, text: string): CustomRunPlan {
  if (a.target === 'agent') {
    return { ok: false, reason: 'Shell actions cannot target an agent session' }
  }

  // PTY MAX_CANON silently mangles a typed line longer than this, so a
  // shell body over the limit is refused rather than sent corrupted.
  if (new TextEncoder().encode(text).length > MAX_TYPED_LINE_BYTES) {
    return { ok: false, reason: `Command is longer than ${MAX_TYPED_LINE_BYTES} bytes` }
  }

  if (a.target === 'focused') {
    if (!env.focused) return { ok: false, reason: 'No terminal focused' }
    if (env.focused.isAgent) {
      return { ok: false, reason: 'Focused terminal is running an agent, use a new tab' }
    }
    return { ok: true, kind: 'input', sessionId: env.focused.sessionId, data: `${text}\r` }
  }

  if (!env.projectId) return { ok: false, reason: 'No branch focused' }
  return { ok: true, kind: 'new-tab', projectId: env.projectId, data: `${text}\r` }
}

export function planCustomAction(a: CustomAction, env: CustomRunEnv): CustomRunPlan {
  const expanded = expandVariables(a.body, env.vars)
  if (!expanded.ok) return { ok: false, reason: expanded.reason }

  return a.kind === 'prompt' ? planPrompt(a, env, expanded.text) : planShell(a, env, expanded.text)
}
