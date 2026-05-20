import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node-ical', () => ({
  default: {
    parseICS: vi.fn(),
  },
  parseICS: vi.fn(),
}))

import * as nodeIcal from 'node-ical'
import { parseIcs } from '../../src/ics/parser'

const windowStart = new Date('2026-05-19T00:00:00Z')
const windowEnd = new Date('2026-06-02T00:00:00Z')

const singleEventIcs = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20260520T100000Z
DTEND:20260520T110000Z
SUMMARY:Team standup
UID:abc123
END:VEVENT
END:VCALENDAR`

const allDayEventIcs = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260521
DTEND;VALUE=DATE:20260522
SUMMARY:Company holiday
UID:def456
END:VEVENT
END:VCALENDAR`

const mockSingleEvent = {
  abc123: {
    type: 'VEVENT' as const,
    uid: 'abc123',
    summary: 'Team standup',
    start: new Date('2026-05-20T10:00:00Z'),
    end: new Date('2026-05-20T11:00:00Z'),
    datetype: 'date-time',
  },
}

const mockAllDayEvent = {
  def456: {
    type: 'VEVENT' as const,
    uid: 'def456',
    summary: 'Company holiday',
    start: new Date('2026-05-21'),
    end: new Date('2026-05-22'),
    datetype: 'date',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseIcs', () => {
  it('parses VCALENDAR string into CalendarEvent[]', () => {
    vi.mocked(nodeIcal.parseICS).mockReturnValue(
      mockSingleEvent as ReturnType<typeof nodeIcal.parseICS>
    )
    const events = parseIcs(singleEventIcs, windowStart, windowEnd)
    expect(events).toHaveLength(1)
    expect(events[0].summary).toBe('Team standup')
    expect(events[0].uid).toBe('abc123')
  })

  it('detects all-day events', () => {
    vi.mocked(nodeIcal.parseICS).mockReturnValue(
      mockAllDayEvent as ReturnType<typeof nodeIcal.parseICS>
    )
    const events = parseIcs(allDayEventIcs, windowStart, windowEnd)
    expect(events).toHaveLength(1)
    expect(events[0].allDay).toBe(true)
  })

  it('filters events outside the window', () => {
    const outsideEvent = {
      xyz: {
        type: 'VEVENT' as const,
        uid: 'xyz',
        summary: 'Past event',
        start: new Date('2026-01-01T10:00:00Z'),
        end: new Date('2026-01-01T11:00:00Z'),
        datetype: 'date-time',
      },
    }
    vi.mocked(nodeIcal.parseICS).mockReturnValue(
      outsideEvent as ReturnType<typeof nodeIcal.parseICS>
    )
    const events = parseIcs(singleEventIcs, windowStart, windowEnd)
    expect(events).toHaveLength(0)
  })

  it('returns [] for empty feed', () => {
    vi.mocked(nodeIcal.parseICS).mockReturnValue({})
    const events = parseIcs('', windowStart, windowEnd)
    expect(events).toEqual([])
  })

  it('returns [] without throwing for malformed feed', () => {
    vi.mocked(nodeIcal.parseICS).mockImplementation(() => {
      throw new Error('Parse error')
    })
    expect(() => parseIcs('garbage', windowStart, windowEnd)).not.toThrow()
    const events = parseIcs('garbage', windowStart, windowEnd)
    expect(events).toEqual([])
  })
})
