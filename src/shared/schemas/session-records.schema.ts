import { z } from 'zod'
import { TrackerIdSchema } from './integrations.schema.js'

export const DESCRIPTION_MAX_LENGTH = 500

const SessionSnapshotSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  workspaceName: z.string().nullable(),
  projectName: z.string().nullable(),
  branch: z.string().nullable(),
  tabTitle: z.string(),
  shell: z.string().nullable(),
  startedAt: z.string(),
})

const WorkItemRefSchema = z.object({
  tracker: TrackerIdSchema,
  key: z.string().min(1),
})

export const SetDescriptionInputSchema = z.object({
  session: SessionSnapshotSchema,
  description: z
    .string()
    .nullable()
    .refine((d) => d === null || d.trim().length <= DESCRIPTION_MAX_LENGTH, {
      message: `A description is at most ${DESCRIPTION_MAX_LENGTH} characters`,
    }),
})

export const SetLinkInputSchema = z.object({
  session: SessionSnapshotSchema,
  link: WorkItemRefSchema.nullable(),
})

export const TransferInputSchema = z.object({
  fromSessionId: z.string().min(1),
  session: SessionSnapshotSchema,
})
