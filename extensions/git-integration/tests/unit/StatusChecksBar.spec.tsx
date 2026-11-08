import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GroupedCheckList, StatusChecksBar } from '../../src/components/pr-review/StatusChecksBar'
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
    expect(container.innerHTML).toBe('')
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
})

describe('StatusChecksBar — prioritises fail over pending in summary', () => {
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

  it('expands to show individual checks on click', async () => {
    const user = userEvent.setup()
    render(<StatusChecksBar checks={passing} />)
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('list')).toBeTruthy()
    expect(screen.getByText('build / test')).toBeTruthy()
    expect(screen.getByText('lint')).toBeTruthy()
  })
})

describe('StatusChecksBar — collapses again on second click', () => {
  it('collapses again on second click', async () => {
    const user = userEvent.setup()
    render(<StatusChecksBar checks={passing} />)
    const btn = screen.getByRole('button')
    await user.click(btn)
    await user.click(btn)
    expect(screen.queryByRole('list')).toBeNull()
  })
})

describe('StatusChecksBar — one icon per check state', () => {
  it('shows the icon of its state on each check in the expanded list', async () => {
    const user = userEvent.setup()
    const mixed: StatusCheck[] = [
      { name: 'pass-check', state: 'pass' },
      { name: 'fail-check', state: 'fail' },
      { name: 'pending-check', state: 'pending' },
      { name: 'skipped-check', state: 'skipped' },
      { name: 'unknown-check', state: 'unknown' },
    ]
    render(<StatusChecksBar checks={mixed} />)
    await user.click(screen.getByRole('button'))
    const icons = screen.getAllByRole('listitem').map((item) => {
      const icon = within(item).getByTitle(/^(pass|fail|pending|skipped|unknown)$/)
      return [icon.getAttribute('title'), icon.innerHTML]
    })
    expect(icons).toEqual([
      ['pass', expect.stringContaining('lucide-check')],
      ['fail', expect.stringContaining('lucide-x')],
      ['pending', expect.stringContaining('lucide-circle-dashed')],
      ['skipped', expect.stringContaining('lucide-minus')],
      ['unknown', expect.stringContaining('lucide-circle-question-mark')],
    ])
  })
})

describe('StatusChecksBar — renders link-out anchor when url is provided', () => {
  it('renders link-out anchor when url is provided', async () => {
    const user = userEvent.setup()
    const withUrl: StatusCheck[] = [{ name: 'ci', state: 'pass', url: 'https://example.com/run/1' }]
    render(<StatusChecksBar checks={withUrl} />)
    await user.click(screen.getByRole('button'))
    const link = screen.getByRole('link')
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe('https://example.com/run/1')
  })

  it('does not render link-out anchor when url is absent', async () => {
    const user = userEvent.setup()
    render(<StatusChecksBar checks={passing} />)
    await user.click(screen.getByRole('button'))
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('summary button has correct aria-expanded attribute', async () => {
    const user = userEvent.setup()
    render(<StatusChecksBar checks={passing} />)
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    await user.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('StatusChecksBar — shows singular check label for a single check', () => {
  it('shows singular "check" label for a single check', () => {
    render(<StatusChecksBar checks={[{ name: 'only', state: 'pass' }]} />)
    const btn = screen.getByRole('button')
    expect(btn.textContent).toMatch(/1 check[^s]*/)
    expect(btn.textContent).not.toMatch(/1 checks/)
  })
})

describe('StatusChecksBar (continued) — detailed summary', () => {
  it('names failing checks against the total', () => {
    const checks: StatusCheck[] = [
      { name: 'Format', state: 'fail' },
      { name: 'codecov/patch', state: 'fail' },
      { name: 'build', state: 'pass' },
    ]
    render(<StatusChecksBar checks={checks} detailed />)
    expect(screen.getByText('2 of 3 checks failing · Format, codecov/patch')).toBeTruthy()
  })

  it('counts pending checks against the total', () => {
    render(
      <StatusChecksBar
        checks={[
          { name: 'a', state: 'pending' },
          { name: 'b', state: 'pass' },
        ]}
        detailed
      />
    )
    expect(screen.getByText('1 of 2 checks pending')).toBeTruthy()
  })

  it('says all checks are passing', () => {
    render(<StatusChecksBar checks={passing} detailed />)
    expect(screen.getByText('2 checks passing')).toBeTruthy()
  })
})

const mixedChecks: StatusCheck[] = [
  { name: 'b2', state: 'pass' },
  { name: 'lint', state: 'fail' },
  { name: 'b10', state: 'pass' },
  { name: 'e2e', state: 'pending' },
  { name: 'format', state: 'fail' },
  { name: 'preview', state: 'skipped', url: 'https://example.com/run/9' },
]

function namesIn(group: string): string[] {
  const section = screen.getByRole('region', { name: group })
  return within(section)
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')
}

describe('GroupedCheckList', () => {
  it('orders groups failing, pending, passing, skipped and leaves out empty ones', () => {
    render(<GroupedCheckList checks={mixedChecks} />)
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent)
    expect(headings).toEqual(['Failing · 2', 'Pending · 1', 'Passing · 2', 'Skipped · 1'])
  })

  it('sorts names in natural order inside a group', () => {
    render(<GroupedCheckList checks={mixedChecks} />)
    expect(namesIn('Failing · 2')).toEqual(['format', 'lint'])
    expect(namesIn('Passing · 2')).toEqual(['b2', 'b10'])
  })

  it('links a check that has a url', () => {
    render(<GroupedCheckList checks={mixedChecks} />)
    const links = screen.getAllByRole('link', { name: 'Open check details' })
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('https://example.com/run/9')
  })
})
