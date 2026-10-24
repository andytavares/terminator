import { z } from 'zod'
import { WorkItemRefSchema } from './session-records.schema.js'

export const TaskLaneSchema = z.object({
  repoRoot: z.string().min(1),
  branch: z.string().min(1),
})

const TitleSchema = z.string().min(1).max(120)

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: TitleSchema,
  lanes: z.array(TaskLaneSchema),
  ticket: WorkItemRefSchema.nullable(),
  focus: z.boolean(),
  doneAt: z.string().nullable(),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
})

export const TaskCreateInputSchema = z.object({
  title: TitleSchema,
  lanes: z.array(TaskLaneSchema).min(1),
  ticket: WorkItemRefSchema.nullable().optional(),
})

export const TaskUpdateInputSchema = z.object({
  id: z.string().min(1),
  title: TitleSchema.optional(),
  focus: z.boolean().optional(),
  ticket: WorkItemRefSchema.nullable().optional(),
  done: z.boolean().optional(),
})

export const TaskLaneInputSchema = z.object({
  id: z.string().min(1),
  lane: TaskLaneSchema,
})

export const TaskArchiveInputSchema = z.object({
  id: z.string().min(1),
  archived: z.boolean(),
})

export type Task = z.infer<typeof TaskSchema>
export type TaskLane = z.infer<typeof TaskLaneSchema>
export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>
export type TaskUpdateInput = z.infer<typeof TaskUpdateInputSchema>
