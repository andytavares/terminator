import { z } from 'zod'

// Payload validation for every `integrations:*` channel. Kept beside the other
// shared schemas so the main process, the renderer and the remote shim all
// validate against one definition.

export const TrackerIdSchema = z.enum(['linear', 'jira'])

// Emails are `min(1)`, not `.email()`, deliberately. The credential is proved
// against the tracker before anything is stored, so a wrong address fails at
// `connect` with the tracker's own message — which is more useful than a regex
// that also rejects legitimate addresses (short TLDs, plus-addressing, IDN).
export const MineSelectorSchema = z.union([
  z.object({ kind: z.literal('assignee'), email: z.string().min(1).nullable() }),
  z.object({ kind: z.literal('query'), jql: z.string().min(1) }),
])

export const StatusInputSchema = z.object({ tracker: TrackerIdSchema.optional() })

// Discriminated rather than one loose object: a Jira credential is four fields
// and a Linear one is a key, and accepting either shape for either tracker
// means storing a credential that cannot possibly work.
export const ConnectInputSchema = z.discriminatedUnion('tracker', [
  z.object({
    tracker: z.literal('linear'),
    apiKey: z.string().min(1),
    email: z.string().min(1).nullable().optional(),
  }),
  z.object({
    tracker: z.literal('jira'),
    site: z.string().min(1),
    email: z.string().min(1),
    apiToken: z.string().min(1),
    jql: z.string().min(1),
  }),
])

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

export type ConnectInput = z.infer<typeof ConnectInputSchema>
export type LinkSetInput = z.infer<typeof LinkSetInputSchema>
export type SetMineInput = z.infer<typeof SetMineInputSchema>
