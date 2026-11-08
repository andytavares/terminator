import type { TokenCounts } from './model-prices'

export interface SessionUsage {
  sessionId: string
  tokens: TokenCounts
  costUsd: number
  costIsPartial: boolean
  models: string[]
}

export interface AgentUsage {
  sessions: SessionUsage[]
  totals: { tokens: TokenCounts; costUsd: number; costIsPartial: boolean }
}
