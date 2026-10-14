import { z } from 'zod'

// ── Shared fragments ─────────────────────────────────────────────────────────

const TaskStatusSchema = z.enum([
  'open',
  'done',
  'migrated',
  'cancelled',
  'in-progress',
  'in-review',
  'blocked',
])
const ProjectStatusSchema = z.enum(['active', 'someday', 'done', 'archived'])
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const TaskIdSchema = z.string().min(1)

// ── vault:capture ────────────────────────────────────────────────────────────

export const CaptureRequestSchema = z.object({
  text: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, { message: 'text must not be whitespace-only' }),
  hintArea: z.string().optional(),
  hintProject: z.string().optional(),
})

// ── vault:get-today / get-daily ──────────────────────────────────────────────

export const GetDailyRequestSchema = z.object({ date: DateSchema })

// ── vault:add-task ───────────────────────────────────────────────────────────

export const AddTaskRequestSchema = z.object({
  filePath: z.string().min(1),
  text: z.string().min(1),
  section: z.string().optional(),
  dueDate: DateSchema.optional(),
  tags: z
    .object({
      project: z.string().optional(),
      context: z.string().optional(),
      area: z.string().optional(),
    })
    .optional(),
})

// ── vault:complete-task ──────────────────────────────────────────────────────

export const CompleteTaskRequestSchema = z.object({ taskId: TaskIdSchema })

// ── vault:migrate-task ───────────────────────────────────────────────────────

export const MigrateTaskRequestSchema = z.object({
  taskId: TaskIdSchema,
  targetDate: DateSchema,
})

// ── vault:query ──────────────────────────────────────────────────────────────

export const QueryRequestSchema = z.object({
  status: z.union([TaskStatusSchema, z.array(TaskStatusSchema)]).optional(),
  context: z.string().optional(),
  project: z.string().optional(),
  area: z.string().optional(),
  dueBefore: DateSchema.optional(),
  filePattern: z.string().optional(),
})

// ── vault:edit-task ──────────────────────────────────────────────────────────

export const EditTaskRequestSchema = z.object({
  taskId: TaskIdSchema,
  text: z.string().min(1),
})

// ── vault:delete-task ────────────────────────────────────────────────────────

export const DeleteTaskRequestSchema = z.object({ taskId: TaskIdSchema })

// ── vault:cancel-task ────────────────────────────────────────────────────────

export const CancelTaskRequestSchema = z.object({ taskId: TaskIdSchema })

// ── vault:restore-task ───────────────────────────────────────────────────────

export const RestoreTaskRequestSchema = z.object({ taskId: TaskIdSchema })

// ── vault:create-area ────────────────────────────────────────────────────────

export const CreateAreaRequestSchema = z.object({ name: z.string().min(1) })

// ── vault:delete-area / vault:archive-area ───────────────────────────────────

export const DeleteAreaRequestSchema = z.object({ areaFilePath: z.string().min(1) })
export const ArchiveAreaRequestSchema = z.object({ areaName: z.string().min(1) })

// ── projects:update-area / projects:update-deadline / projects:rename ───────

export const UpdateProjectAreaRequestSchema = z.object({
  projectFilePath: z.string().min(1),
  area: z.string().nullish(),
})
export const UpdateProjectDeadlineRequestSchema = z.object({
  projectFilePath: z.string().min(1),
  deadline: z.string().nullish(),
})
export const RenameProjectRequestSchema = z.object({
  projectFilePath: z.string().min(1),
  newName: z.string().trim().min(1),
})

// ── vault:rename-area / vault:list-areas ─────────────────────────────────────

export const RenameAreaRequestSchema = z.object({
  areaFilePath: z.string().min(1),
  newName: z.string().trim().min(1),
})
export const ListAreasRequestSchema = z.object({ status: z.string().optional() }).default({})

// ── projects:get-tasks / vault:add-subtask ───────────────────────────────────

export const GetProjectTasksRequestSchema = z.object({ projectName: z.string() })
export const AddSubtaskRequestSchema = z.object({ taskId: TaskIdSchema, text: z.string().min(1) })

// ── vault:get-calendar-month / settings:set-stale-threshold ──────────────────

export const CalendarMonthRequestSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
})
export const StaleThresholdRequestSchema = z.object({ days: z.number().min(1) })

// ── vault:list-archive ───────────────────────────────────────────────────────

export const ListArchiveRequestSchema = z.object({
  days: z.number().int().optional(), // how many days back to look for done tasks
})

// ── projects:create ──────────────────────────────────────────────────────────

export const CreateProjectRequestSchema = z.object({
  name: z.string().min(1),
  area: z.string().optional(),
  deadline: DateSchema.optional(),
  outcome: z.string().optional(),
})

// ── projects:delete ──────────────────────────────────────────────────────────

export const DeleteProjectRequestSchema = z.object({
  projectFilePath: z.string().min(1),
})

// ── vault:process-inbox-item ─────────────────────────────────────────────────

export const ProcessInboxRequestSchema = z.object({
  taskId: TaskIdSchema,
  action: z.enum(['file', 'trash', 'do-now', 'someday']),
  destination: z.string().optional(),
  newProjectName: z.string().optional(),
})

// ── vault:update-project-status ──────────────────────────────────────────────

export const UpdateProjectStatusRequestSchema = z.object({
  projectFilePath: z.string().min(1),
  status: ProjectStatusSchema,
})

// ── projects:list ────────────────────────────────────────────────────────────

export const ListProjectsRequestSchema = z.object({
  status: z.union([ProjectStatusSchema, z.array(ProjectStatusSchema)]).optional(),
})

// ── links:create / remove ────────────────────────────────────────────────────

export const LinksCreateRequestSchema = z.object({
  taskId: z.string().optional(),
  projectFilePath: z.string().optional(),
  targetId: z.string().uuid(),
})

export const LinksRemoveRequestSchema = z.object({
  taskId: z.string().optional(),
  projectFilePath: z.string().optional(),
  targetId: z.string().uuid(),
})

export const LinksGetForTargetRequestSchema = z.object({ targetId: z.string().uuid() })

// ── vault:get-task-detail / save-task-detail ──────────────────────────────────

export const GetTaskDetailRequestSchema = z.object({ taskId: TaskIdSchema })

export const SaveTaskDetailRequestSchema = z.object({
  taskId: TaskIdSchema,
  description: z.string(),
  acceptanceCriteria: z.string(),
  devHints: z.string(),
})

// ── vault:block-task ──────────────────────────────────────────────────────────

export const BlockTaskRequestSchema = z.object({
  taskId: TaskIdSchema,
  reason: z.string().min(1),
  checkInterval: z.union([
    z.enum([
      '30-min',
      '1-hour',
      '2-hour',
      '4-hour',
      '1-day',
      '2-day',
      '1-week',
      '2-weeks',
      '1-month',
    ]),
    z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/), // custom: local datetime (YYYY-MM-DDTHH:MM)
  ]),
})

// ── vault:unblock-task ────────────────────────────────────────────────────────

export const UnblockTaskRequestSchema = z.object({ taskId: TaskIdSchema })

// ── vault:reorder-tasks ───────────────────────────────────────────────────────

export const ReorderTasksRequestSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
})

// ── vault:set-recurrence ──────────────────────────────────────────────────────

const RecurrenceIntervalSchema = z.enum(['daily', 'weekly', 'biweekly', 'monthly'])

export const SetRecurrenceRequestSchema = z.object({
  taskId: TaskIdSchema,
  interval: RecurrenceIntervalSchema,
  days: z.array(z.number().int().min(0).max(6)).optional(), // weekdays 0=Sun..6=Sat (weekly only)
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  endType: z.enum(['none', 'on_date', 'after_count']).optional(),
  endDate: DateSchema.optional(),
  endCount: z.number().int().min(1).optional(),
})

// ── vault:clear-recurrence ────────────────────────────────────────────────────

export const ClearRecurrenceRequestSchema = z.object({ taskId: TaskIdSchema })
