import { describe, it, expect } from 'vitest'
import {
  WorkspaceSchema,
  CreateWorkspaceInputSchema,
  ProjectSchema,
} from '../../../src/shared/schemas/workspace.schema'

describe('WorkspaceSchema', () => {
  const validWorkspace = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'My Workspace',
    folderPath: '/home/user/project',
    color: '#4A90E2',
    tags: ['frontend', 'work'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  it('accepts a valid workspace', () => {
    expect(WorkspaceSchema.safeParse(validWorkspace).success).toBe(true)
  })

  it('rejects empty name', () => {
    const result = CreateWorkspaceInputSchema.safeParse({ ...validWorkspace, name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects name over 100 characters', () => {
    const result = CreateWorkspaceInputSchema.safeParse({
      ...validWorkspace,
      name: 'a'.repeat(101),
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid hex color', () => {
    const result = CreateWorkspaceInputSchema.safeParse({
      ...validWorkspace,
      color: 'notacolor',
    })
    expect(result.success).toBe(false)
  })

  it('rejects more than 20 tags', () => {
    const result = CreateWorkspaceInputSchema.safeParse({
      ...validWorkspace,
      tags: Array.from({ length: 21 }, (_, i) => `tag${i}`),
    })
    expect(result.success).toBe(false)
  })

  it('accepts workspace with zero tags', () => {
    const result = CreateWorkspaceInputSchema.safeParse({
      ...validWorkspace,
      tags: [],
    })
    expect(result.success).toBe(true)
  })

  it('accepts workspace with exactly 20 tags', () => {
    const result = CreateWorkspaceInputSchema.safeParse({
      ...validWorkspace,
      tags: Array.from({ length: 20 }, (_, i) => `tag${i}`),
    })
    expect(result.success).toBe(true)
  })
})

describe('ProjectSchema', () => {
  const validProject = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    workspaceId: '550e8400-e29b-41d4-a716-446655440000',
    name: 'My Project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  it('accepts a valid project', () => {
    expect(ProjectSchema.safeParse(validProject).success).toBe(true)
  })

  it('rejects empty project name', () => {
    const result = ProjectSchema.safeParse({ ...validProject, name: '' })
    expect(result.success).toBe(false)
  })
})
