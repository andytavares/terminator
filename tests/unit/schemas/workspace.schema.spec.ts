import { describe, it, expect } from 'vitest'
import { CreateWorkspaceInputSchema } from '../../../src/shared/schemas/workspace.schema'

describe('CreateWorkspaceInputSchema', () => {
  const validWorkspace = {
    name: 'My Workspace',
    folderPath: '/home/user/project',
    color: '#4A90E2',
    tags: ['frontend', 'work'],
  }

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
