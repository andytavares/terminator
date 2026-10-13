/** A note's title: its first heading, else its first non-blank line, cut to 120 characters. */
export function noteTitle(body: string): string {
  const headingMatch = /^#{1,6}\s+(.+)/m.exec(body)
  if (headingMatch) return headingMatch[1].trim()
  const firstLine = body.split('\n').find((l) => l.trim().length > 0)
  return firstLine?.trim().slice(0, 120) ?? 'Untitled note'
}
