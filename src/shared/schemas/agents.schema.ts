import { z } from 'zod'

const SessionId = z.string().min(1).max(200)

export const AgentStartInputSchema = z.object({
  agentId: z.string().min(1).optional(),
  cwd: z.string().min(1),
  resume: SessionId.optional(),
  agentMeta: z.record(z.string(), z.unknown()).optional(),
  mode: z.string().min(1).optional(),
  tab: z.object({ projectId: z.string().min(1), title: z.string() }).optional(),
})

export const AgentSessionInputSchema = z.object({ sessionId: SessionId })

export const AgentPromptInputSchema = z.object({ sessionId: SessionId, text: z.string() })

export const AgentAnswerInputSchema = z.object({
  sessionId: SessionId,
  requestId: z.string().min(1),
  optionId: z.string().min(1).nullable(),
})

export const AgentSetConfigInputSchema = z.object({
  sessionId: SessionId,
  configId: z.string().min(1),
  value: z.string(),
})
