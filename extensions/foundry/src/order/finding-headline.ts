/**
 * The claim in a finding's text, without its evidence: its first line if the
 * text has one, otherwise its first sentence.
 */
export function findingHeadline(text: string): string {
  const trimmed = text.trim()
  const newline = trimmed.indexOf('\n')
  if (newline !== -1) return trimmed.slice(0, newline).trim()
  const sentence = /^(.+?[.!?])\s+(?=[A-Z`'"(])/s.exec(trimmed)
  return sentence === null ? trimmed : sentence[1]
}
