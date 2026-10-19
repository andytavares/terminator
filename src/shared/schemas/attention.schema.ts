import { z } from 'zod'

export const RecordStateInputSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().nullable(),
  branch: z.string().nullable(),
  workKey: z.string().nullable(),
  state: z.enum(['working', 'awaiting-input', 'idle', 'exited']),
  at: z.string().refine((at) => !Number.isNaN(Date.parse(at)), { message: 'at is not a time' }),
})

export const MeasuresInputSchema = z.object({
  window: z.object({ from: z.number(), to: z.number() }),
})
