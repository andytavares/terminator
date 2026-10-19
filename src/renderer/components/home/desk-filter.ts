import { create } from 'zustand'
import type { DeskAsk } from '../../home/core-asks'

export type DeskCount = 'your-move' | 'agents' | 'others' | 'failing'

/** What narrows the Desk: the search text, and the summary count that was pressed. */
export const useDeskFilter = create<{
  text: string
  count: DeskCount | null
  setText: (text: string) => void
  setCount: (count: DeskCount | null) => void
  clear: () => void
}>((set) => ({
  text: '',
  count: null,
  setText: (text) => set({ text }),
  setCount: (count) => set({ count }),
  clear: () => set({ text: '', count: null }),
}))

/** Whether every word of `text` appears somewhere in `fields`, case aside. */
export function matchesText(fields: readonly (string | null | undefined)[], text: string): boolean {
  const haystack = fields.join('\n').toLowerCase()
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

export function askMatches(ask: DeskAsk, text: string): boolean {
  return matchesText([ask.title, ask.detail, ask.where, ...ask.facts], text)
}
