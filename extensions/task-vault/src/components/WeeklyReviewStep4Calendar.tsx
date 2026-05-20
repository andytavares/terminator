import React, { useEffect, useState } from 'react'

interface CalendarEvent {
  uid: string
  summary: string
  start: string
  end: string
  allDay: boolean
}

interface CalendarPayload {
  events: CalendarEvent[]
  isStale: boolean
  isFeedConfigured: boolean
  lastRefreshed: string | null
}

interface Props {
  onComplete: () => void
}

export function WeeklyReviewStep4Calendar({ onComplete }: Props): React.JSX.Element {
  const [data, setData] = useState<CalendarPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setIsLoading(true)
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'task-vault:ics:get-events',
        {}
      )
      setData(result as CalendarPayload)
    } finally {
      setIsLoading(false)
    }
  }

  function groupByDay(events: CalendarEvent[]): Record<string, CalendarEvent[]> {
    const groups: Record<string, CalendarEvent[]> = {}
    for (const event of events) {
      const day = new Date(event.start).toISOString().slice(0, 10)
      if (!groups[day]) groups[day] = []
      groups[day].push(event)
    }
    return groups
  }

  if (isLoading) return <div className="wr-step wr-step-4">Loading calendar…</div>

  const grouped = data ? groupByDay(data.events ?? []) : {}
  const days = Object.keys(grouped).sort()

  return (
    <div className="wr-step wr-step-4">
      <h3>Step 4: Calendar Review</h3>

      {!data?.isFeedConfigured && (
        <p className="wr-step__notice">
          No ICS feed configured. Add feed URLs in Task Vault settings.
        </p>
      )}

      {data?.isStale && <p className="wr-step__warning">Calendar data may be out of date.</p>}

      {data?.lastRefreshed && (
        <p className="wr-step__meta">
          Last refreshed: {new Date(data.lastRefreshed).toLocaleString()}
        </p>
      )}

      {days.length === 0 && data?.isFeedConfigured && (
        <p className="wr-step__empty">No events in the ±7 day window.</p>
      )}

      {days.map((day) => (
        <div key={day} className="wr-step__day">
          <h4>{day}</h4>
          <ul>
            {grouped[day].map((event) => (
              <li key={event.uid}>
                {event.allDay ? '(all day) ' : `${new Date(event.start).toLocaleTimeString()} `}
                {event.summary}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <button className="wr-step__next" onClick={onComplete}>
        Next
      </button>
    </div>
  )
}
