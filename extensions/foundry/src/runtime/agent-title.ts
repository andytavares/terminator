/** A role or step id as a tab title: `red-team` is "Red team". */
export function agentTitle(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
