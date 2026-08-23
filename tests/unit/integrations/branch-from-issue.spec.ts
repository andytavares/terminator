import { describe, it, expect } from 'vitest'
import {
  branchFromIssue,
  projectNameFromIssue,
} from '../../../src/shared/integrations/branch-from-issue'
import type { IssueSummary } from '../../../src/shared/types/index'

function summary(over: Partial<IssueSummary & { branchName: string | null }> = {}) {
  return {
    tracker: 'linear' as const,
    id: 'id-1',
    key: 'TAV-42',
    title: 'Unify Linear connections behind one core service',
    url: 'https://linear.app/tav/issue/TAV-42',
    state: { name: 'In Progress', type: 'started' as const },
    assignee: null,
    branchName: 'andrew/tav-42-unify-linear',
    ...over,
  }
}

describe('branchFromIssue — the tracker knows best', () => {
  it("uses Linear's own suggested branch name", () => {
    expect(branchFromIssue(summary())).toBe('andrew/tav-42-unify-linear')
  })

  it('uses it verbatim, without re-sanitising what the tracker already chose', () => {
    expect(branchFromIssue(summary({ branchName: 'andrew/TAV-42_Odd.Name' }))).toBe(
      'andrew/TAV-42_Odd.Name'
    )
  })
})

describe('branchFromIssue — deriving one when the tracker offers none', () => {
  it('falls back to key and title for Jira', () => {
    const branch = branchFromIssue(
      summary({ tracker: 'jira', key: 'TAV-7', title: 'Move Jira behind it', branchName: null })
    )
    expect(branch).toBe('tav-7-move-jira-behind-it')
  })

  it('lower-cases and hyphenates', () => {
    expect(
      branchFromIssue(summary({ branchName: null, key: 'ENG-1', title: 'Fix The Thing' }))
    ).toBe('eng-1-fix-the-thing')
  })

  it('drops characters git will not take in a ref', () => {
    const branch = branchFromIssue(
      summary({ branchName: null, key: 'ENG-2', title: 'Fix ~this^ :weird? [thing]*' })
    )
    expect(branch).toBe('eng-2-fix-this-weird-thing')
    for (const bad of ['~', '^', ':', '?', '[', ']', '*', '\\', ' ']) {
      expect(branch).not.toContain(bad)
    }
  })

  it('collapses runs of separators rather than leaving a row of hyphens', () => {
    expect(branchFromIssue(summary({ branchName: null, key: 'ENG-3', title: 'a   ///   b' }))).toBe(
      'eng-3-a-b'
    )
  })

  it('never starts or ends with a hyphen or a dot', () => {
    const branch = branchFromIssue(
      summary({ branchName: null, key: 'ENG-4', title: '...leading and trailing...' })
    )
    expect(branch).not.toMatch(/^[-.]/)
    expect(branch).not.toMatch(/[-.]$/)
  })

  it('never produces a name git rejects for ending in .lock', () => {
    expect(
      branchFromIssue(summary({ branchName: null, key: 'ENG-5', title: 'file.lock' }))
    ).not.toMatch(/\.lock$/)
  })

  it('bounds the length so a rambling title does not become a 300-character branch', () => {
    const branch = branchFromIssue(
      summary({ branchName: null, key: 'ENG-6', title: 'word '.repeat(80) })
    )
    expect(branch.length).toBeLessThanOrEqual(60)
    expect(branch).not.toMatch(/-$/)
  })

  it('still yields something usable for an issue with no title at all', () => {
    expect(branchFromIssue(summary({ branchName: null, key: 'ENG-7', title: '' }))).toBe('eng-7')
  })

  it('yields something usable for a title of only punctuation', () => {
    expect(branchFromIssue(summary({ branchName: null, key: 'ENG-8', title: '???' }))).toBe('eng-8')
  })

  it('strips accents rather than emitting non-ascii into a ref', () => {
    expect(
      branchFromIssue(summary({ branchName: null, key: 'ENG-9', title: 'Café déjà vu' }))
    ).toBe('eng-9-cafe-deja-vu')
  })
})

describe('projectNameFromIssue', () => {
  it('reads as a short name, not as a branch', () => {
    expect(projectNameFromIssue(summary())).toBe('TAV-42 Unify Linear connections behind one core')
  })

  it('is bounded so it fits a sidebar row', () => {
    const name = projectNameFromIssue(summary({ title: 'word '.repeat(80) }))
    expect(name.length).toBeLessThanOrEqual(50)
    expect(name).not.toMatch(/\s$/)
  })

  it('is just the key when there is no title', () => {
    expect(projectNameFromIssue(summary({ title: '' }))).toBe('TAV-42')
  })

  it('does not cut a word in half', () => {
    const name = projectNameFromIssue(
      summary({ key: 'E-1', title: 'alpha beta gamma delta epsilon zeta eta theta iota kappa' })
    )
    expect(name.endsWith('-')).toBe(false)
    // Whatever survived is whole words.
    for (const word of name.replace('E-1 ', '').split(' ')) {
      expect('alpha beta gamma delta epsilon zeta eta theta iota kappa').toContain(word)
    }
  })
})
