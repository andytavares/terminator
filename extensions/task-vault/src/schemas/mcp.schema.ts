import { z } from 'zod'

export const CaptureInputSchema = z.object({
  text: z.string().min(1, 'text must not be empty'),
  hintArea: z.string().optional(),
  hintProject: z.string().optional(),
  confirmed: z.boolean().optional(),
})

export const TodayInputSchema = z.object({})

export const AddTaskInputSchema = z.object({
  filePath: z.string().min(1),
  text: z.string().min(1),
  section: z.string().optional(),
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  tags: z
    .object({
      project: z.string().optional(),
      context: z.string().optional(),
      area: z.string().optional(),
    })
    .optional(),
  confirmed: z.boolean().optional(),
})

export const CompleteTaskInputSchema = z.object({
  taskId: z.string().min(1),
  confirmed: z.boolean().optional(),
})

export const MigrateTaskInputSchema = z.object({
  taskId: z.string().min(1),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  confirmed: z.boolean().optional(),
})

export const QueryInputSchema = z.object({
  status: z
    .union([
      z.enum(['open', 'done', 'migrated', 'cancelled', 'in-progress']),
      z.array(z.enum(['open', 'done', 'migrated', 'cancelled', 'in-progress'])),
    ])
    .optional(),
  context: z.string().optional(),
  project: z.string().optional(),
  area: z.string().optional(),
  dueBefore: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  filePattern: z.string().optional(),
})

export const ListProjectsInputSchema = z.object({
  status: z
    .union([
      z.enum(['active', 'someday', 'done', 'archived']),
      z.array(z.enum(['active', 'someday', 'done', 'archived'])),
    ])
    .optional(),
})

export const WeeklyReviewInputSchema = z.object({})
