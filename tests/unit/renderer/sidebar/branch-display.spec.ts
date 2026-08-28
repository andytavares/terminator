import { describe, it, expect } from 'vitest'
import { displayName, abbreviatePath } from '../../../../src/renderer/sidebar/branch-display'
import type { Project } from '../../../../src/shared/types/index'

const branch = (patch: Partial<Project> = {}): Project => ({
  id: 'p1',
  workspaceId: 'w1',
  name: 'main',
  gitBranch: 'main',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
  ...patch,
})

describe('displayName — the branch is the identity', () => {
  it('shows the branch alone when the stored name is just the branch', () => {
    expect(displayName(branch({ name: 'main', gitBranch: 'main' }))).toEqual({
      primary: 'main',
      secondary: undefined,
    })
  })

  it('leads with a real label and keeps the branch as secondary', () => {
    expect(
      displayName(
        branch({ name: 'TAV-14 Make all text red', gitBranch: 'andrew/tav-14-make-text-red' })
      )
    ).toEqual({
      primary: 'TAV-14 Make all text red',
      secondary: 'andrew/tav-14-make-text-red',
    })
  })

  it('falls back to the stored name when there is no branch to show', () => {
    expect(displayName(branch({ name: 'detached', gitBranch: undefined }))).toEqual({
      primary: 'detached',
      secondary: undefined,
    })
  })

  it('never hides the branch when it differs from the label', () => {
    const d = displayName(branch({ name: 'API', gitBranch: 'feature/api-v2' }))
    expect(d.secondary).toBe('feature/api-v2')
  })

  it('is pure and does not mutate its input', () => {
    const b = branch()
    const snapshot = JSON.stringify(b)
    displayName(b)
    expect(JSON.stringify(b)).toBe(snapshot)
    expect(displayName(b)).toEqual(displayName(b))
  })
})

describe('abbreviatePath — a repo path as a human reads it', () => {
  it('replaces the home directory with a tilde', () => {
    expect(abbreviatePath('/Users/andrew/repos/app', '/Users/andrew')).toBe('~/repos/app')
  })

  it('abbreviates the home directory itself', () => {
    expect(abbreviatePath('/Users/andrew', '/Users/andrew')).toBe('~')
  })

  it('leaves a path outside home alone', () => {
    expect(abbreviatePath('/opt/work/app', '/Users/andrew')).toBe('/opt/work/app')
  })

  it('does not abbreviate a sibling directory that merely shares the prefix', () => {
    expect(abbreviatePath('/Users/andrewsmith/app', '/Users/andrew')).toBe('/Users/andrewsmith/app')
  })

  it('leaves the path alone when home is unknown', () => {
    expect(abbreviatePath('/Users/andrew/app', undefined)).toBe('/Users/andrew/app')
  })
})
