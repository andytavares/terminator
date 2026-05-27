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

export const CaptureResponseSchema = z.union([
  z.object({ taskId: z.string() }),
  z.object({ error: z.string() }),
])

// ── vault:get-today / get-daily ──────────────────────────────────────────────

export const GetDailyRequestSchema = z.object({ date: DateSchema })

const EventSchema = z.object({ time: z.string().optional(), text: z.string() })
const NoteSchema = z.object({ text: z.string() })
const IndexedTaskSchema = z.object({
  id: z.string(),
  filePath: z.string(),
  line: z.number(),
  status: TaskStatusSchema,
  text: z.string(),
  project: z.string().optional(),
  context: z.string().optional(),
  area: z.string().optional(),
  dueDate: z.string().optional(),
  terminatorLinks: z.array(z.string()),
})

export const DailyLogResponseSchema = z.union([
  z.object({
    date: z.string(),
    tasks: z.array(IndexedTaskSchema),
    events: z.array(EventSchema),
    notes: z.array(NoteSchema),
    exists: z.boolean(),
  }),
  z.object({ error: z.string() }),
])

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

export const CompleteTaskResponseSchema = z.union([
  z.object({ success: z.literal(true) }),
  z.object({ error: z.union([z.literal('STALE_ID'), z.string()]) }),
])

// ── vault:migrate-task ───────────────────────────────────────────────────────

export const MigrateTaskRequestSchema = z.object({
  taskId: TaskIdSchema,
  targetDate: DateSchema,
})

export const MigrateTaskResponseSchema = z.union([
  z.object({ newTaskId: z.string() }),
  z.object({ error: z.union([z.literal('STALE_ID'), z.string()]) }),
])

// ── vault:query ──────────────────────────────────────────────────────────────

export const QueryRequestSchema = z.object({
  status: z.union([TaskStatusSchema, z.array(TaskStatusSchema)]).optional(),
  context: z.string().optional(),
  project: z.string().optional(),
  area: z.string().optional(),
  dueBefore: DateSchema.optional(),
  filePattern: z.string().optional(),
})

export const QueryResponseSchema = z.union([
  z.object({ tasks: z.array(IndexedTaskSchema) }),
  z.object({ error: z.string() }),
])

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

// ── vault:delete-area ────────────────────────────────────────────────────────

export const DeleteAreaRequestSchema = z.object({ areaFilePath: z.string().min(1) })

// ── vault:list-archive ───────────────────────────────────────────────────────

export const ListArchiveRequestSchema = z.object({
  days: z.number().optional(), // how many days back to look for done tasks
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

export const ProcessInboxResponseSchema = z.union([
  z.object({ success: z.literal(true), newTaskId: z.string().optional() }),
  z.object({ error: z.string() }),
])

// ── vault:update-project-status ──────────────────────────────────────────────

export const UpdateProjectStatusRequestSchema = z.object({
  projectFilePath: z.string().min(1),
  status: ProjectStatusSchema,
})

// ── projects:list ────────────────────────────────────────────────────────────

export const ListProjectsRequestSchema = z.object({
  status: z.union([ProjectStatusSchema, z.array(ProjectStatusSchema)]).optional(),
})

const IndexedProjectSchema = z.object({
  id: z.string(),
  filePath: z.string(),
  name: z.string(),
  status: ProjectStatusSchema,
  deadline: z.string().optional(),
  area: z.string().optional(),
  isStale: z.boolean(),
  nextActionCount: z.number(),
  lastModified: z.string(),
  terminatorLinks: z.array(z.string()),
})

export const ListProjectsResponseSchema = z.union([
  z.object({ projects: z.array(IndexedProjectSchema) }),
  z.object({ error: z.string() }),
])

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

// ── ics:get-events ───────────────────────────────────────────────────────────

export const GetEventsRequestSchema = z.object({ windowDays: z.number().optional() })

// ── settings ─────────────────────────────────────────────────────────────────

export const McpAutoExecuteSchema = z.object({
  capture: z.boolean().default(false),
  add_task: z.boolean().default(false),
  complete_task: z.boolean().default(false),
  migrate_task: z.boolean().default(false),
  process_inbox_item: z.boolean().default(false),
})

export type McpAutoExecute = z.infer<typeof McpAutoExecuteSchema>

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
