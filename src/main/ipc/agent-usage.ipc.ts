import { defineChannel, validationError, type ChannelSpec } from '@terminator/extension-sdk'
import { registerInvokeTable } from './invoke-table.js'
import { listRecords } from '../sessions/session-record-store.js'
import { readTranscriptUsage, type TranscriptUsage } from '../agents/transcript-usage.js'
import { addTokens, costOfModels, emptyTokens } from '../../shared/agents/model-prices.js'
import {
  AgentUsageInputSchema,
  type AgentUsageInput,
} from '../../shared/schemas/agent-usage.schema.js'
import type { AgentUsage, SessionUsage } from '../../shared/agents/agent-usage.js'
import type { SessionRecord } from '../../shared/types/index.js'

function spansRange(usage: TranscriptUsage, input: AgentUsageInput): boolean {
  const start = usage.firstTimestamp ? Date.parse(usage.firstTimestamp) : NaN
  const end = usage.lastTimestamp ? Date.parse(usage.lastTimestamp) : NaN
  if (Number.isNaN(start) || Number.isNaN(end))
    return input.from === undefined && input.to === undefined
  if (input.from !== undefined && end < Date.parse(input.from)) return false
  return input.to === undefined || start <= Date.parse(input.to)
}

function sessionUsage(sessionId: string, usage: TranscriptUsage): SessionUsage {
  const tokens = emptyTokens()
  for (const modelTokens of Object.values(usage.byModel)) addTokens(tokens, modelTokens)
  return { sessionId, tokens, ...costOfModels(usage.byModel), models: Object.keys(usage.byModel) }
}

/** A transcript that cannot be read (deleted, moved) is a session with nothing to count. */
async function readOrNull(file: string): Promise<TranscriptUsage | null> {
  try {
    return await readTranscriptUsage(file)
  } catch {
    return null
  }
}

export async function collectAgentUsage(
  records: SessionRecord[],
  input: AgentUsageInput
): Promise<AgentUsage> {
  const wanted = input.sessionIds && new Set(input.sessionIds)
  const sessions: SessionUsage[] = []
  for (const record of records) {
    if (!record.agent || (wanted && !wanted.has(record.sessionId))) continue
    const usage = await readOrNull(record.agent.transcriptPath)
    if (usage && spansRange(usage, input)) sessions.push(sessionUsage(record.sessionId, usage))
  }
  const tokens = emptyTokens()
  for (const session of sessions) addTokens(tokens, session.tokens)
  return {
    sessions,
    totals: {
      tokens,
      costUsd: sessions.reduce((sum, s) => sum + s.costUsd, 0),
      costIsPartial: sessions.some((s) => s.costIsPartial),
    },
  }
}

// Core-only, like the session records it reads.
const usageChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'agents:usage',
    schema: AgentUsageInputSchema,
    invalid: validationError,
    run: async (input) => ({ data: await collectAgentUsage(listRecords(), input) }),
    onError: (error) => ({
      error: 'failed',
      message: error instanceof Error ? error.message : String(error),
    }),
  }),
]

export function registerAgentUsageHandlers(): void {
  registerInvokeTable(usageChannels)
}
