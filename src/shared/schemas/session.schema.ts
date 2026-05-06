import { z } from 'zod'

export const SessionStatusSchema = z.enum(['active', 'backgrounded', 'closed'])
export const SessionTypeSchema = z.enum(['human', 'agent'])

export const TerminalSessionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  tabTitle: z.string().min(1).max(100),
  status: SessionStatusSchema,
  type: SessionTypeSchema,
  scrollbackLimit: z.number().int().min(1000).max(100000),
  createdAt: z.string().datetime(),
  closedAt: z.string().datetime().optional(),
})

export const CreateSessionInputSchema = z.object({
  projectId: z.string().uuid(),
  type: SessionTypeSchema,
  tabTitle: z.string().min(1).max(100),
  scrollbackLimit: z.number().int().min(1000).max(100000),
  cwd: z.string().min(1),
  shell: z.string().optional(),
})

export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>
