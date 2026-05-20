import * as nodeIcal from 'node-ical'

export interface CalendarEvent {
  uid: string
  summary: string
  start: Date
  end: Date
  allDay: boolean
  location?: string
  description?: string
}

export function parseIcs(icsString: string, windowStart: Date, windowEnd: Date): CalendarEvent[] {
  try {
    const parsed = nodeIcal.parseICS(icsString)
    const events: CalendarEvent[] = []

    for (const key of Object.keys(parsed)) {
      const entry = parsed[key]
      if (entry.type !== 'VEVENT') continue

      const start = entry.start as Date
      const end = (entry.end as Date) ?? start
      const allDay = (entry as { datetype?: string }).datetype === 'date'

      if (!start || start > windowEnd || end < windowStart) continue

      events.push({
        uid: (entry.uid as string) ?? key,
        summary: (entry.summary as string) ?? '',
        start,
        end,
        allDay,
        location: entry.location as string | undefined,
        description: entry.description as string | undefined,
      })
    }

    return events
  } catch {
    return []
  }
}
