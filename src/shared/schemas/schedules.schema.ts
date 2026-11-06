import { z } from 'zod'

// A Start work prompt that runs later: once, every day, or every weekday (local time).

const ScheduleFields = {
  repoRoot: z.string().min(1),
  prompt: z.string().trim().min(1),
  runAs: z.string().min(1),
  kind: z.enum(['once', 'daily', 'weekdays']),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** 'YYYY-MM-DD'; the day of a one-time run. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** Runs on a branch of its own, as Start work's default for an agent prompt. */
  newWorktree: z.boolean(),
  /** The agent chosen in Start work; null runs the default agent. */
  agentId: z.string().min(1).nullable(),
}

export const ScheduleInputSchema = z
  .object(ScheduleFields)
  .refine((s) => (s.kind === 'once') === (s.date !== null), {
    message: 'A one-time schedule needs a date; the others have none',
  })

export const ScheduleIdInputSchema = z.object({ id: z.string().min(1) })

export const BranchNameInputSchema = z.object({ prompt: z.string().trim().min(1) })

export type ScheduleInput = z.infer<typeof ScheduleInputSchema>
export type Schedule = ScheduleInput & { id: string; lastRunAt: string | null; createdAt: string }
