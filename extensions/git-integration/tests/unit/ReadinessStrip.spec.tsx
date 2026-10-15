import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReadinessStrip } from '../../src/components/pr-review/ReadinessStrip'
import type { PrReviewDetail } from '../../src/schemas/pr-review.schema'

const basePr: PrReviewDetail = {
  number: 42,
  title: 'Add feature X',
  body: '',
  author: 'alice',
  authorAvatarUrl: '',
  openedAt: '2026-01-01T00:00:00Z',
  headRefName: 'feature/x',
  baseRefName: 'main',
  headSHA: 'abc123',
  isDraft: false,
  mergeStateStatus: 'clean',
  ciStatus: 'passing',
  lintStatus: 'pass',
  coverageStatus: 'pass',
  statusChecks: [{ name: 'CI', state: 'pass' }],
  approvals: [],
  requestedReviewers: [],
  assigneeLogins: [],
  issueRefs: [],
  dryViolations: [],
  chapters: [],
  readingOrder: [],
  movedBlocks: [],
  insights: null,
}

const idleBranch = {
  updating: false,
  resolving: false,
  error: null as string | null,
  onUpdate: () => {},
  onResolve: () => {},
}

function renderStrip(overrides: Partial<PrReviewDetail> = {}, branch = idleBranch, you = false) {
  return render(
    <ReadinessStrip pr={{ ...basePr, ...overrides }} youAreRequested={you} branch={branch} />
  )
}

const approval = (author: string) => ({ author, authorAvatarUrl: '', submittedAt: '2026-01-02' })

describe('ReadinessStrip checks', () => {
  const checks = [
    { name: 'ruff', state: 'fail' as const },
    { name: 'lint', state: 'fail' as const },
    { name: 'build', state: 'pass' as const },
  ]

  it('names the failing checks and opens them failing-first', () => {
    renderStrip({ statusChecks: checks })
    const cell = screen.getByRole('button', { name: /2 of 3 checks failing/ })
    expect(cell.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(cell)
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(headings).toEqual(['Failing · 2', 'Passing · 1'])
  })

  it('says so when there are no checks', () => {
    renderStrip({ statusChecks: [] })
    expect(screen.getByText('No checks')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /check/ })).toBeNull()
  })

  it('reports pending checks', () => {
    renderStrip({ statusChecks: [{ name: 'CI', state: 'pending' }] })
    expect(screen.getByText('1 of 1 check pending')).toBeTruthy()
  })
})

describe('ReadinessStrip reviews', () => {
  it('lists approvals and who is still awaited', () => {
    renderStrip({ approvals: [approval('bob'), approval('cy')], requestedReviewers: ['dee'] })
    expect(screen.getByText('Approved by bob, cy · waiting on dee')).toBeTruthy()
  })

  it('shows waiting only when nobody has approved', () => {
    renderStrip({ requestedReviewers: ['dee'] })
    expect(screen.getByText('Waiting on dee')).toBeTruthy()
  })

  it('flags that you were asked', () => {
    renderStrip({ requestedReviewers: ['me'] }, idleBranch, true)
    expect(screen.getByText('Your review requested')).toBeTruthy()
  })

  it('says nobody was asked', () => {
    renderStrip()
    expect(screen.getByText('None requested')).toBeTruthy()
  })
})

describe('ReadinessStrip merge', () => {
  it('reports a clean merge against the base', () => {
    renderStrip()
    expect(screen.getByText('No conflicts with main')).toBeTruthy()
  })

  it('offers resolving when conflicting', () => {
    const calls: string[] = []
    renderStrip({ mergeStateStatus: 'dirty' }, { ...idleBranch, onResolve: () => calls.push('r') })
    expect(screen.getByText('Conflicts with main')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Resolve conflicts' }))
    expect(calls).toEqual(['r'])
  })

  it('shows the busy label while preparing the merge', () => {
    renderStrip({ mergeStateStatus: 'dirty' }, { ...idleBranch, resolving: true })
    const busy = screen.getByRole('button', { name: 'Preparing merge…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
  })
})

describe('ReadinessStrip branch actions', () => {
  it('offers updating when behind, busy while updating', () => {
    const calls: string[] = []
    const view = renderStrip(
      { mergeStateStatus: 'behind' },
      { ...idleBranch, onUpdate: () => calls.push('u') }
    )
    expect(screen.getByText('Behind main')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update from main' }))
    expect(calls).toEqual(['u'])
    view.unmount()
    renderStrip({ mergeStateStatus: 'behind' }, { ...idleBranch, updating: true })
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeTruthy()
  })

  it('says when the merge state is not reported', () => {
    renderStrip({ mergeStateStatus: 'unknown' })
    expect(screen.getByText('Not reported')).toBeTruthy()
  })

  it('shows a branch error as an alert', () => {
    renderStrip({}, { ...idleBranch, error: 'Could not update the branch' })
    expect(screen.getByRole('alert').textContent).toBe('Could not update the branch')
  })
})
