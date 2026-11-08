import { z } from 'zod'

// A Start work prompt that runs later: once, or on a Repeat rule (local time).

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

const RepeatSchema = z
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
  /** null for a global scheduled run: it belongs to no workspace and starts in the home folder. */
  repoRoot: z.string().min(1).nullable(),
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

type ScheduleShape = z.infer<z.ZodObject<typeof ScheduleFields>>

/** The rules every saved schedule follows, for a new one and an edit alike. */
const withScheduleRules = <T extends z.ZodType<ScheduleShape>>(schema: T) =>
  schema
    .refine((s) => (s.kind === 'once') === (s.date !== null), {
      message: 'A one-time schedule needs a date; a repeat has none',
    })
    .refine((s) => (s.kind === 'repeat') === (s.repeat !== null), {
      message: 'A repeat schedule needs a repeat rule; a one-time run has none',
    })
    .refine((s) => s.repoRoot !== null || (s.branch === null && !s.newWorktree), {
      message: 'A global scheduled run has no branch or worktree',
    })
    .refine((s) => s.repoRoot !== null || s.runAs === 'agent' || s.runAs === 'claude-terminal', {
      message: 'A global scheduled run runs as an agent or Claude in a terminal',
    })

export const ScheduleInputSchema = withScheduleRules(z.object(ScheduleFields))

export const ScheduleUpdateInputSchema = withScheduleRules(
  z.object({ id: z.string().min(1), ...ScheduleFields })
)

export const ScheduleIdInputSchema = z.object({ id: z.string().min(1) })

export const SchedulePauseInputSchema = z.object({ id: z.string().min(1), paused: z.boolean() })

export const BranchNameInputSchema = z.object({ prompt: z.string().trim().min(1) })

export type ScheduleInput = z.infer<typeof ScheduleInputSchema>
export type Schedule = ScheduleInput & {
  id: string
  lastRunAt: string | null
  createdAt: string
  paused: boolean
}

/** The files a scheduled run's Claude session starts with, so it needs nobody (ADR 144). */
export interface UnattendedLaunch {
  settingsPath: string
  systemPromptPath: string
  /** The text of the system prompt file, for an agent that takes it as text. */
  systemPrompt: string
}

/** A schedule that came due, with what its run starts with. */
export type DueSchedule = Schedule & { unattended: UnattendedLaunch }
