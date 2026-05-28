export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function computeNextDueDate(fromDate: string, interval: string, days: number[]): string {
  // Use noon to avoid DST edge cases
  const d = new Date(`${fromDate}T12:00:00`)
  if (interval === 'daily') {
    d.setDate(d.getDate() + 1)
  } else if (interval === 'biweekly') {
    d.setDate(d.getDate() + 14)
  } else if (interval === 'monthly') {
    d.setMonth(d.getMonth() + 1)
  } else if (interval === 'weekly') {
    if (days.length === 0) {
      d.setDate(d.getDate() + 7)
    } else {
      const todayDow = d.getDay()
      const sortedDays = [...days].sort((a, b) => a - b)
      let found = false
      for (const day of sortedDays) {
        if (day > todayDow) {
          d.setDate(d.getDate() + (day - todayDow))
          found = true
          break
        }
      }
      if (!found) {
        d.setDate(d.getDate() + (7 - todayDow + sortedDays[0]))
      }
    }
  }
  return localDate(d)
}
