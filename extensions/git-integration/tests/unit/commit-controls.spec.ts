import { describe, it, expect } from 'vitest'
import { trackingLine, whyCannotCommit } from '../../src/components/GitSidebarPanel'

// The panel header carried a branch name and nothing else, and the commit row
// carried three buttons of near-equal weight, two of them disabled and hard to
// tell apart from the one that was not.

describe('trackingLine', () => {
  it('says when there is nothing to do either way', () => {
    expect(trackingLine({ ahead: 0, behind: 0, upstream: 'origin/main' })).toBe(
      'nothing to push · nothing to pull'
    )
  })

  it('counts what is waiting to be pushed', () => {
    expect(trackingLine({ ahead: 3, behind: 0, upstream: 'origin/main' })).toBe(
      '3 ahead · nothing to pull'
    )
  })

  it('counts what is waiting to be pulled', () => {
    expect(trackingLine({ ahead: 0, behind: 2, upstream: 'origin/main' })).toBe(
      'nothing to push · 2 behind'
    )
  })

  it('reports both when the branch has diverged', () => {
    expect(trackingLine({ ahead: 3, behind: 2, upstream: 'origin/main' })).toBe(
      '3 ahead · 2 behind'
    )
  })

  // A branch that has never been pushed has no counts to report, and saying
  // "nothing to push" about it would be wrong.
  it('says so when there is no upstream at all', () => {
    expect(trackingLine({ ahead: 3, behind: 0, upstream: null })).toBe('No upstream branch yet')
  })

  it('treats missing counts as zero rather than rendering undefined', () => {
    expect(trackingLine({ upstream: 'origin/main' })).toBe('nothing to push · nothing to pull')
  })
})

describe('whyCannotCommit', () => {
  it('names both when neither is done', () => {
    expect(whyCannotCommit(0, '')).toBe('Stage a file and describe the change to commit.')
  })

  it('names the staging when only the message is written', () => {
    expect(whyCannotCommit(0, 'fix the thing')).toBe('Stage at least one file to commit.')
  })

  it('names the message when only files are staged', () => {
    expect(whyCannotCommit(2, '')).toBe('Describe the change to commit.')
  })

  it('treats whitespace as no message', () => {
    expect(whyCannotCommit(2, '   \n ')).toBe('Describe the change to commit.')
  })
})
