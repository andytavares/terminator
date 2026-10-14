// The backend's clock (ADR 108). Backend only: the view has no Temporal.

// Node 24's Temporal, which the specs run on, has no Temporal.Now.timeZoneId().
function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Now, on the wall clock of the machine's time zone. */
export function zonedNow(): Temporal.ZonedDateTime {
  // Date.now(), not Temporal.Now: the specs' fake timers replace Date only.
  return Temporal.Instant.fromEpochMilliseconds(Date.now()).toZonedDateTimeISO(systemTimeZone())
}

/** Today's local date as YYYY-MM-DD: how a daily log is named and every date is stored. */
export function today(): string {
  return zonedNow().toPlainDate().toString()
}

/** The local date `days` calendar days before today, as YYYY-MM-DD. */
export function daysAgo(days: number): string {
  return zonedNow().toPlainDate().subtract({ days }).toString()
}

/** An instant as created_at and updated_at hold it: what Date.toISOString() writes. */
export function storedInstant(at: Temporal.ZonedDateTime): string {
  return at.toInstant().toString({ fractionalSecondDigits: 3 })
}
