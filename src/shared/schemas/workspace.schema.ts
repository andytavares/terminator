import { z } from 'zod'

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  folderPath: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  tags: z.array(z.string().min(1).max(50)).max(20),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const CreateWorkspaceInputSchema = z.object({
  name: z.string().min(1).max(100),
  folderPath: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  tags: z.array(z.string().min(1).max(50)).max(20),
})

export const UpdateWorkspaceInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  folderPath: z.string().min(1).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
})

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  gitBranch: z.string().optional(),
  worktreePath: z.string().optional(),
  isWorktree: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const CreateProjectInputSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  gitBranch: z.string().optional(),
  worktreePath: z.string().optional(),
  isWorktree: z.boolean().default(false),
})

export const UpdateProjectBranchSchema = z.object({
  id: z.string().uuid(),
  gitBranch: z.string().min(1),
})

export const RenameProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
})

export const ReorderWorkspacesSchema = z.object({
  ids: z.array(z.string().uuid()),
})

export const ReorderProjectsSchema = z.object({
  workspaceId: z.string().uuid(),
  ids: z.array(z.string().uuid()),
})

export type WorkspaceInput = z.infer<typeof CreateWorkspaceInputSchema>
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceInputSchema>
export type ProjectInput = z.infer<typeof CreateProjectInputSchema>
