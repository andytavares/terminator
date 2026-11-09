import { z } from 'zod'

// Payload validation for every `integrations:*` channel. Kept beside the other
// shared schemas so the main process, the renderer and the remote shim all
// validate against one definition.

export const TrackerIdSchema = z.enum(['linear'])

// Emails are `min(1)`, not `.email()`, deliberately. The credential is proved
// against the tracker before anything is stored, so a wrong address fails at
// `connect` with the tracker's own message — which is more useful than a regex
// that also rejects legitimate addresses (short TLDs, plus-addressing, IDN).
const MineSelectorSchema = z.object({
  kind: z.literal('assignee'),
  email: z.string().min(1).nullable(),
})

export const StatusInputSchema = z.object({ tracker: TrackerIdSchema.optional() })

export const ConnectInputSchema = z.object({
  tracker: z.literal('linear'),
  apiKey: z.string().min(1),
  email: z.string().min(1).nullable().optional(),
})

export const DisconnectInputSchema = z.object({ tracker: TrackerIdSchema })

export const ListMineInputSchema = z.object({
  tracker: TrackerIdSchema.optional(),
  limit: z.number().int().positive().max(200).optional(),
})

export const SearchInputSchema = z.object({
  term: z.string().min(1),
  tracker: TrackerIdSchema.optional(),
  limit: z.number().int().positive().max(200).optional(),
})

export const IssueGetInputSchema = z.object({
  tracker: TrackerIdSchema,
  key: z.string().min(1),
  refresh: z.boolean().optional(),
})

export const IssueCommentInputSchema = z.object({
  tracker: TrackerIdSchema,
  key: z.string().min(1),
  body: z.string().min(1),
})

export const LinkSetInputSchema = z.object({
  projectId: z.string().uuid(),
  tracker: TrackerIdSchema,
  key: z.string().min(1),
  injectContext: z.boolean().optional(),
})

export const ProjectIdInputSchema = z.object({ projectId: z.string().uuid() })

export const SetMineInputSchema = z.object({
  tracker: TrackerIdSchema,
  mine: MineSelectorSchema,
})
