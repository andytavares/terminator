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

export const AgentPromptInputSchema = z.object({
  sessionId: SessionId,
  text: z.string(),
  images: z.array(z.object({ mimeType: z.string().min(1), data: z.string().min(1) })).optional(),
})

export const AgentSteerInputSchema = z.object({ sessionId: SessionId, text: z.string() })

export const AgentQueueInputSchema = z.object({
  sessionId: SessionId,
  messages: z.array(z.string()),
})

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

/** A preset agent and whether its binary is on the user's PATH; the answer of `agents:known`. */
export const KnownAgentStatusSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()),
  installed: z.boolean(),
})
export type KnownAgentStatus = z.infer<typeof KnownAgentStatusSchema>
