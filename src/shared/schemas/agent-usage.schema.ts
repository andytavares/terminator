import { z } from 'zod'

export const AgentUsageInputSchema = z.object({
  sessionIds: z.array(z.string().min(1)).optional(),
  /** ISO times; a session counts when its conversation overlaps [from, to]. */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

const PlainText = z.string().max(2000)

export const ThreadSummaryInputSchema = z.object({
  title: PlainText,
  ticketKey: z.string().max(100).optional(),
  sessions: z.array(
    z.object({
      /** Lets main read the session's transcript for what the renderer cannot. */
      sessionId: z.string().max(200).optional(),
      state: z.string().max(100),
      lastAssistantTexts: z.array(PlainText).max(5),
      firstUserPrompt: PlainText.nullable(),
    })
  ),
  pullRequest: z
    .object({ number: z.number().int(), isDraft: z.boolean(), checksLine: PlainText })
    .optional(),
})

export type ThreadSummaryInput = z.infer<typeof ThreadSummaryInputSchema>
export type AgentUsageInput = z.infer<typeof AgentUsageInputSchema>
