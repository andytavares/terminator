import { create } from 'zustand'
import type { DeskAsk } from '../../home/core-asks'
import type { TaskState } from '../../home/task-state'

export type DeskCount = 'your-move' | 'agents' | 'others' | 'failing'

/** What narrows the Desk: the search text, and the summary count that was pressed. */
export const useDeskFilter = create<{
  text: string
  count: DeskCount | null
  /** The task state pressed on the Tasks layout's pulse line. */
  taskState: TaskState | null
  setText: (text: string) => void
  setCount: (count: DeskCount | null) => void
  setTaskState: (state: TaskState | null) => void
  clear: () => void
}>((set) => ({
  text: '',
  count: null,
  taskState: null,
  setText: (text) => set({ text }),
  setCount: (count) => set({ count }),
  setTaskState: (taskState) => set({ taskState }),
  clear: () => set({ text: '', count: null, taskState: null }),
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
