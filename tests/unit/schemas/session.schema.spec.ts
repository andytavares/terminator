import { describe, it, expect } from 'vitest'
import {
  TerminalSessionSchema,
  CreateSessionInputSchema,
} from '../../../src/shared/schemas/session.schema'

const validSession = {
  id: '00000000-0000-0000-0000-000000000001',
  projectId: '00000000-0000-0000-0000-000000000002',
  tabTitle: 'Shell',
  status: 'active' as const,
  type: 'human' as const,
  scrollbackLimit: 10000,
  createdAt: '2024-01-01T00:00:00.000Z',
}

describe('TerminalSessionSchema', () => {
  it('accepts a valid session', () => {
    expect(TerminalSessionSchema.safeParse(validSession).success).toBe(true)
  })

  it('accepts optional closedAt', () => {
    const session = { ...validSession, closedAt: '2024-01-01T01:00:00.000Z' }
    expect(TerminalSessionSchema.safeParse(session).success).toBe(true)
  })

  it('rejects invalid status', () => {
    const session = { ...validSession, status: 'unknown' }
    expect(TerminalSessionSchema.safeParse(session).success).toBe(false)
  })

  it('rejects invalid type', () => {
    const session = { ...validSession, type: 'bot' }
    expect(TerminalSessionSchema.safeParse(session).success).toBe(false)
  })

  it('rejects non-UUID id', () => {
    const session = { ...validSession, id: 'not-a-uuid' }
    expect(TerminalSessionSchema.safeParse(session).success).toBe(false)
  })

  it('rejects empty tabTitle', () => {
    const session = { ...validSession, tabTitle: '' }
    expect(TerminalSessionSchema.safeParse(session).success).toBe(false)
  })

  it('rejects scrollbackLimit below 1000', () => {
    const session = { ...validSession, scrollbackLimit: 999 }
    expect(TerminalSessionSchema.safeParse(session).success).toBe(false)
  })

  it('rejects scrollbackLimit above 100000', () => {
    const session = { ...validSession, scrollbackLimit: 100001 }
    expect(TerminalSessionSchema.safeParse(session).success).toBe(false)
  })

  it('accepts all valid status values', () => {
    for (const status of ['active', 'backgrounded', 'closed'] as const) {
      expect(TerminalSessionSchema.safeParse({ ...validSession, status }).success).toBe(true)
    }
  })

  it('accepts both session types', () => {
    for (const type of ['human', 'agent'] as const) {
      expect(TerminalSessionSchema.safeParse({ ...validSession, type }).success).toBe(true)
    }
  })
})

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
