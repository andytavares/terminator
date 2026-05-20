import { z } from 'zod'

export const ProjectFrontmatterSchema = z.object({
  type: z.literal('project'),
  status: z.enum(['active', 'someday', 'done', 'archived']),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  area: z.string().optional(),
  created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  'terminator-links': z.array(z.string().uuid()).optional(),
})

export type ProjectFrontmatter = z.infer<typeof ProjectFrontmatterSchema>
