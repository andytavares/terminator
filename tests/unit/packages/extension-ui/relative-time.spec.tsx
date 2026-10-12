import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { formatRelativeTime } from '../../../../packages/extension-ui/src/relative-time'
import { RelativeTime } from '../../../../packages/extension-ui/src/RelativeTime'

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0)
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const ago = (milliseconds: number) => formatRelativeTime(NOW - milliseconds, NOW, 'en')
const ahead = (milliseconds: number) => formatRelativeTime(NOW + milliseconds, NOW, 'en')

describe('formatRelativeTime', () => {
  it.each([
    [0, 'now'],
    [30 * SECOND, '30 seconds ago'],
    [59 * SECOND, '59 seconds ago'],
    [MINUTE, '1 minute ago'],
    [5 * MINUTE, '5 minutes ago'],
    [59 * MINUTE, '59 minutes ago'],
    [HOUR, '1 hour ago'],
    [23 * HOUR, '23 hours ago'],
    [DAY, 'yesterday'],
    [3 * DAY, '3 days ago'],
    [7 * DAY, 'last week'],
    [14 * DAY, '2 weeks ago'],
    [21 * DAY, '3 weeks ago'],
    [30 * DAY, 'last month'],
    [200 * DAY, '6 months ago'],
    [365 * DAY, 'last year'],
    [800 * DAY, '2 years ago'],
  ])('says %i milliseconds in the past as "%s"', (milliseconds, sentence) => {
    expect(ago(milliseconds)).toBe(sentence)
  })

  it('counts whole units, never rounding up to one that has not passed', () => {
    expect(ago(119 * SECOND)).toBe('1 minute ago')
    expect(ago(2 * HOUR - SECOND)).toBe('1 hour ago')
  })

  it('looks forward as well as back', () => {
    expect(ahead(2 * HOUR)).toBe('in 2 hours')
    expect(ahead(DAY)).toBe('tomorrow')
    expect(ahead(30 * SECOND)).toBe('in 30 seconds')
  })

  it('accepts dates and ISO strings as well as milliseconds', () => {
    expect(formatRelativeTime(new Date(NOW - 5 * MINUTE), new Date(NOW), 'en')).toBe(
      '5 minutes ago'
    )
    expect(formatRelativeTime(new Date(NOW - 5 * MINUTE).toISOString(), NOW, 'en')).toBe(
      '5 minutes ago'
    )
  })

  it('writes in the language it is asked for', () => {
    expect(formatRelativeTime(NOW - 3 * DAY, NOW, 'de')).toBe('vor 3 Tagen')
  })
})

describe('RelativeTime', () => {
  it('shows the sentence and keeps the exact moment for tools and tooltips', () => {
    const moment = new Date(NOW - 2 * HOUR)
    const { container } = render(<RelativeTime value={moment} now={NOW} />)
    const time = container.querySelector('time')!
    expect(time.getAttribute('datetime')).toBe(moment.toISOString())
    expect(time.getAttribute('title')).toBe(moment.toLocaleString())
    expect(time.textContent).toBe(formatRelativeTime(moment, NOW))
  })
})

// A tracker or a file can hand over a time that does not parse. That is no
// time to show, not a crash in the view that shows it.
describe('a time that does not parse', () => {
  it('formats as nothing', () => {
    expect(formatRelativeTime('not a date', NOW, 'en')).toBe('')
  })

  it('renders nothing', () => {
    const { container } = render(<RelativeTime value="not a date" now={NOW} />)
    expect(container.firstChild).toBeNull()
  })
})
