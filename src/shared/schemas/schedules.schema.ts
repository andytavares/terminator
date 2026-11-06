import { z } from 'zod'

// A Start work prompt that runs later: once, or on a Repeat rule (local time).

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

export const RepeatSchema = z
  .object({
    every: z.number().int().min(1).max(999),
    unit: z.enum(['minute', 'hour', 'day', 'week', 'month']),
    /** Sunday = 0; empty means every day. */
    days: z.array(z.number().int().min(0).max(6)),
    between: z.object({ from: Clock, to: Clock }).nullable(),
    overlap: z.enum(['skip', 'start']),
  })
  .refine((r) => r.between === null || r.unit === 'minute' || r.unit === 'hour', {
    message: 'Only a minute or hour repeat has a time window',
  })

const ScheduleFields = {
  repoRoot: z.string().min(1),
  prompt: z.string().trim().min(1),
  runAs: z.string().min(1),
  kind: z.enum(['once', 'repeat']),
  time: Clock,
  /** 'YYYY-MM-DD'; the day of a one-time run. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** The rule of a repeat; null for a one-time run. */
  repeat: RepeatSchema.nullable(),
  /** The one branch a repeat runs on, named on save; null for a one-time run. */
  branch: z.string().min(1).nullable(),
  /** Runs on a branch of its own, as Start work's default for an agent prompt. */
  newWorktree: z.boolean(),
  /** The agent chosen in Start work; null runs the default agent. */
  agentId: z.string().min(1).nullable(),
}

export const ScheduleInputSchema = z
  .object(ScheduleFields)
  .refine((s) => (s.kind === 'once') === (s.date !== null), {
    message: 'A one-time schedule needs a date; a repeat has none',
  })
  .refine((s) => (s.kind === 'repeat') === (s.repeat !== null), {
    message: 'A repeat schedule needs a repeat rule; a one-time run has none',
  })

export const ScheduleIdInputSchema = z.object({ id: z.string().min(1) })

export const BranchNameInputSchema = z.object({ prompt: z.string().trim().min(1) })

export type RepeatInput = z.infer<typeof RepeatSchema>
export type ScheduleInput = z.infer<typeof ScheduleInputSchema>
export type Schedule = ScheduleInput & { id: string; lastRunAt: string | null; createdAt: string }
