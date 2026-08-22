import { z } from 'zod'

export const SessionStatusSchema = z.enum(['active', 'backgrounded', 'closed'])
export const SessionTypeSchema = z.enum(['human', 'agent'])

export const CreateSessionInputSchema = z.object({
  projectId: z.string().uuid(),
  type: SessionTypeSchema,
  tabTitle: z.string().min(1).max(100),
  scrollbackLimit: z.number().int().min(1000).max(100000),
  cwd: z.string().min(1),
  shell: z.string().optional(),
})

export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>
