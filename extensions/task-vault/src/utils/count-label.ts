/** "1 task", "3 tasks": the count with its noun, plural unless it is one. */
export function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count !== 1 ? 's' : ''}`
}
