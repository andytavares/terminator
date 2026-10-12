import { z } from 'zod'
import { ASK_MODELS } from '../forge/converge.js'

// The payloads of the channels `src/index.ts` registers itself, rather than
// through one of the channel modules beside this file (ADR 096).

/** Your tickets, or the ones matching `term`. */
export const IssuesMinePayload = z.object({ term: z.string().optional() }).optional()

export const TicketCreatePayload = z.object({ idea: z.string(), teamId: z.string() })

/** One order, for the channels that act on the whole of it. */
export const OrderIdPayload = z.object({ id: z.string().min(1) })

export const ModelSetPayload = z.object({ model: z.string() })

export const AskModelSetPayload = z.object({ model: z.enum(ASK_MODELS) })

// Each writes a line that every later read replays: a dismiss with no id
// appended `{}`, which then read back as a feed entry with no summary and took
// the Floor down.
export const FeedDismissPayload = z.object({ id: z.string().min(1) })
export const FeedMutePayload = z
  .object({
    sessionId: z.string().min(1).optional(),
    author: z.enum(['agent', 'console']).optional(),
  })
  .refine((rule) => rule.sessionId !== undefined || rule.author !== undefined)

export const PermissionResolvePayload = z.object({
  requestId: z.string(),
  decision: z.enum(['allow', 'deny']),
  answer: z.string().optional(),
})

export const PermissionHandBackPayload = z.object({ requestId: z.string() })

/** One supervised session, for the channels that act on a run. */
export const SessionPayload = z.object({ sessionId: z.string() })

export const TranscriptPayload = z.object({
  sessionId: z.string(),
  limit: z.number().int().positive().optional(),
})

export const RedirectPayload = z.object({
  sessionId: z.string(),
  message: z.string().trim().min(1),
})

export const SessionStopPayload = z.object({
  sessionId: z.string(),
  reason: z.string().optional(),
})

export const ViewPayload = z.object({ view: z.enum(['list', 'factory']) })
