import { describe, it, expect } from 'vitest'
import { isProjectStale } from '../../src/vault/stale'
import type { Project } from '../../src/vault/types'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    filePath: '/vault/projects/test.md',
    name: 'Test',
    status: 'active',
    created: '2026-01-01',
    nextActions: [],
    allTasks: [],
    isStale: false,
    lastModified: new Date(),
    terminatorLinks: [],
    ...overrides,
  }
}

describe('isProjectStale', () => {
  it('is stale when no next actions', () => {
    const project = makeProject({ nextActions: [], lastModified: new Date() })
    expect(isProjectStale(project, 14)).toBe(true)
  })

  it('is NOT stale when has open next actions', () => {
    const project = makeProject({
      nextActions: [
        {
          id: '1',
          filePath: '/vault/projects/test.md',
          line: 1,
          status: 'open',
          text: 'Do thing',
          metadata: {},
          terminatorLinks: [],
        },
      ],
      lastModified: new Date(),
    })
    expect(isProjectStale(project, 14)).toBe(false)
  })

  it('is stale when last modified > threshold days ago (even with next actions)', () => {
    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
    const project = makeProject({
      nextActions: [
        {
          id: '1',
          filePath: '/vault/projects/test.md',
          line: 1,
          status: 'open',
          text: 'Do thing',
          metadata: {},
          terminatorLinks: [],
        },
      ],
      lastModified: oldDate,
    })
    expect(isProjectStale(project, 14)).toBe(true)
  })

  it('uses configurable threshold', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)
    const project = makeProject({
      nextActions: [
        {
          id: '1',
          filePath: '/vault/projects/test.md',
          line: 1,
          status: 'open',
          text: 'Do thing',
          metadata: {},
          terminatorLinks: [],
        },
      ],
      lastModified: daysAgo(8),
    })
    expect(isProjectStale(project, 7)).toBe(true)
    expect(isProjectStale(project, 14)).toBe(false)
  })
})
