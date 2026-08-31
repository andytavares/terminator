import { describe, it, expect } from 'vitest'
import {
  branchLabel,
  abbreviatePath,
  qualifiedBranchLabel,
} from '../../../../src/renderer/sidebar/branch-display'
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

describe('branchLabel — a branch is named by its branch', () => {
  it('names a branch after its branch', () => {
    expect(branchLabel(branch({ name: 'main', gitBranch: 'main' }))).toBe('main')
  })

  it('ignores a stored label that is not the branch', () => {
    // The card used to lead with this label and demote the branch to secondary
    // text, which gave one thing two names.
    expect(
      branchLabel(
        branch({ name: 'TAV-14 Make all text red', gitBranch: 'andrew/tav-14-make-text-red' })
      )
    ).toBe('andrew/tav-14-make-text-red')
  })

  it('falls back to the stored name when there is no branch to show', () => {
    // A workspace whose folder is not a git repository. The name is all it has.
    expect(branchLabel(branch({ name: 'detached', gitBranch: undefined }))).toBe('detached')
  })

  it('is pure and does not mutate its input', () => {
    const b = branch()
    const snapshot = JSON.stringify(b)
    branchLabel(b)
    expect(JSON.stringify(b)).toBe(snapshot)
    expect(branchLabel(b)).toBe(branchLabel(b))
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

describe('qualifiedBranchLabel — one name identifies one thing', () => {
  it('leads with the repo, because every repo has a main', () => {
    expect(qualifiedBranchLabel(branch({ name: 'main', gitBranch: 'main' }), 'Terminator')).toBe(
      'Terminator · main'
    )
  })

  it('gives two identically named branches two different labels', () => {
    const a = qualifiedBranchLabel(branch({ name: 'main', gitBranch: 'main' }), 'Terminator')
    const b = qualifiedBranchLabel(branch({ name: 'main', gitBranch: 'main' }), 'Fluent')
    expect(a).not.toBe(b)
  })

  it('qualifies the branch, not a stored label', () => {
    expect(
      qualifiedBranchLabel(
        branch({ name: 'TAV-14 Red text', gitBranch: 'andrew/tav-14' }),
        'Fluent'
      )
    ).toBe('Fluent · andrew/tav-14')
  })

  it('falls back to the branch alone when the repo is unknown', () => {
    expect(qualifiedBranchLabel(branch({ name: 'main', gitBranch: 'main' }), undefined)).toBe(
      'main'
    )
  })
})
