import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StatusChecksBar } from '../../src/components/pr-review/StatusChecksBar'
import type { StatusCheck } from '../../src/schemas/pr-review.schema'

const passing: StatusCheck[] = [
  { name: 'build / test', state: 'pass' },
  { name: 'lint', state: 'pass' },
]

const failing: StatusCheck[] = [
  { name: 'build / test', state: 'fail' },
  { name: 'lint', state: 'pass' },
]

const pending: StatusCheck[] = [{ name: 'build / test', state: 'pending' }]

describe('StatusChecksBar', () => {
  it('renders nothing when checks array is empty', () => {
    const { container } = render(<StatusChecksBar checks={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows passing summary when all checks pass', () => {
    render(<StatusChecksBar checks={passing} />)
    expect(screen.getByText(/2 passing/i)).toBeTruthy()
    expect(screen.getByText(/2 check/i)).toBeTruthy()
  })

  it('shows failing count when any check fails', () => {
    render(<StatusChecksBar checks={failing} />)
    expect(screen.getByText(/1 failing/i)).toBeTruthy()
  })

  it('shows pending count when any check is pending and none fail', () => {
    render(<StatusChecksBar checks={pending} />)
    expect(screen.getByText(/1 pending/i)).toBeTruthy()
  })

  it('prioritises fail over pending in summary', () => {
    const mixed: StatusCheck[] = [
      { name: 'ci', state: 'fail' },
      { name: 'lint', state: 'pending' },
    ]
    render(<StatusChecksBar checks={mixed} />)
    expect(screen.getByText(/1 failing/i)).toBeTruthy()
  })

  it('collapsed by default — individual checks not visible', () => {
    render(<StatusChecksBar checks={passing} />)
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('expands to show individual checks on click', () => {
    render(<StatusChecksBar checks={passing} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('list')).toBeTruthy()
    expect(screen.getByText('build / test')).toBeTruthy()
    expect(screen.getByText('lint')).toBeTruthy()
  })

  it('collapses again on second click', () => {
    render(<StatusChecksBar checks={passing} />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('shows correct icon for each state in expanded list', () => {
    const mixed: StatusCheck[] = [
      { name: 'pass-check', state: 'pass' },
      { name: 'fail-check', state: 'fail' },
      { name: 'pending-check', state: 'pending' },
      { name: 'skipped-check', state: 'skipped' },
      { name: 'unknown-check', state: 'unknown' },
    ]
    render(<StatusChecksBar checks={mixed} />)
    fireEvent.click(screen.getByRole('button'))
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(5)
  })

  it('renders link-out anchor when url is provided', () => {
    const withUrl: StatusCheck[] = [{ name: 'ci', state: 'pass', url: 'https://example.com/run/1' }]
    render(<StatusChecksBar checks={withUrl} />)
    fireEvent.click(screen.getByRole('button'))
    const link = screen.getByRole('link')
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe('https://example.com/run/1')
  })

  it('does not render link-out anchor when url is absent', () => {
    render(<StatusChecksBar checks={passing} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('summary button has correct aria-expanded attribute', () => {
    render(<StatusChecksBar checks={passing} />)
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
  })

  it('shows singular "check" label for a single check', () => {
    render(<StatusChecksBar checks={[{ name: 'only', state: 'pass' }]} />)
    const btn = screen.getByRole('button')
    expect(btn.textContent).toMatch(/1 check[^s]*/)
    expect(btn.textContent).not.toMatch(/1 checks/)
  })
})
