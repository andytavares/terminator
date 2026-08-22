import { describe, it, expect } from 'vitest'
import { CreateSessionInputSchema } from '../../../src/shared/schemas/session.schema'

describe('CreateSessionInputSchema', () => {
  const validInput = {
    projectId: '00000000-0000-0000-0000-000000000002',
    type: 'human' as const,
    tabTitle: 'Shell',
    scrollbackLimit: 10000,
    cwd: '/home/user/project',
  }

  it('accepts valid input', () => {
    expect(CreateSessionInputSchema.safeParse(validInput).success).toBe(true)
  })

  it('accepts optional shell', () => {
    const input = { ...validInput, shell: '/bin/bash' }
    expect(CreateSessionInputSchema.safeParse(input).success).toBe(true)
  })

  it('rejects empty cwd', () => {
    expect(CreateSessionInputSchema.safeParse({ ...validInput, cwd: '' }).success).toBe(false)
  })

  it('rejects non-UUID projectId', () => {
    expect(CreateSessionInputSchema.safeParse({ ...validInput, projectId: 'bad-id' }).success).toBe(
      false
    )
  })

  it('rejects tabTitle longer than 100 chars', () => {
    const input = { ...validInput, tabTitle: 'x'.repeat(101) }
    expect(CreateSessionInputSchema.safeParse(input).success).toBe(false)
  })
})
