import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SinceBanner } from '../../src/components/pr-review/SinceBanner'
import { useReviewUiStore } from '../../src/stores/review-ui.store'

beforeEach(() => {
  useReviewUiStore.setState({ diffRange: 'since' })
})

describe('SinceBanner', () => {
  it('shows the commit count and still-viewed count', () => {
    render(
      <SinceBanner
        commitCount={3}
        changedCount={4}
        stillViewedCount={51}
        lastAccessedAt="2025-01-01T00:00:00Z"
        historyRewritten={false}
      />
    )
    expect(screen.getByText('3 commits since you last looked')).toBeTruthy()
    expect(screen.getByText(/51 still viewed/)).toBeTruthy()
    expect(screen.getByText(/4 files changed/)).toBeTruthy()
  })

  it('shows history-rewritten text instead of the commit count when rewritten', () => {
    render(
      <SinceBanner
        commitCount={3}
        changedCount={4}
        stillViewedCount={51}
        lastAccessedAt={null}
        historyRewritten
      />
    )
    expect(screen.getByText('History rewritten since you last looked')).toBeTruthy()
    expect(screen.queryByText('3 commits since you last looked')).toBeNull()
  })

  it('calls setDiffRange when the seg buttons are clicked', () => {
    render(
      <SinceBanner
        commitCount={1}
        changedCount={1}
        stillViewedCount={1}
        lastAccessedAt={null}
        historyRewritten={false}
      />
    )
    fireEvent.click(screen.getByText('Whole PR'))
    expect(useReviewUiStore.getState().diffRange).toBe('whole')
    fireEvent.click(screen.getByText(/Since my review/))
    expect(useReviewUiStore.getState().diffRange).toBe('since')
  })

  it('checks the chosen diff range', () => {
    render(
      <SinceBanner
        commitCount={1}
        changedCount={1}
        stillViewedCount={1}
        lastAccessedAt={null}
        historyRewritten={false}
      />
    )
    const since = screen.getByRole('radio', { name: 'Since my review' })
    const whole = screen.getByRole('radio', { name: 'Whole PR' })
    expect(since.getAttribute('aria-checked')).toBe('true')
    expect(whole.getAttribute('aria-checked')).toBe('false')
  })

  it('uses singular "commit" for a single commit', () => {
    render(
      <SinceBanner
        commitCount={1}
        changedCount={1}
        stillViewedCount={0}
        lastAccessedAt={null}
        historyRewritten={false}
      />
    )
    expect(screen.getByText('1 commit since you last looked')).toBeTruthy()
  })
})
