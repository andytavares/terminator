import type { AgentState } from '../../shared/types'

export interface ActionContext {
  projectId: string | null
  sessionId: string | null
  repoRoot: string | null
  agentState: AgentState | null
  isAgentSession: boolean
  surfaceOwner: string | null
}

export interface QuickActionGroup {
  id: string
  mnemonic: string
  label: string
  owner?: string
}

export interface QuickAction {
  id: string
  label: string
  /** A QuickActionGroup.id, or 'top' for top-level direct actions. */
  group: string
  mnemonic?: string
  shortcut?: string
  description?: string
  disabledReason?: string
  run(): void | Promise<void>
}
