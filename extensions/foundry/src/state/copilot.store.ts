import { createStore } from 'zustand/vanilla'
import type { CopilotMessage, FileChange } from '../types/foundry.types.js'

interface CopilotState {
  messages: CopilotMessage[]
  pendingFiles: Map<string, FileChange>
  isStreaming: boolean

  appendMessage(msg: CopilotMessage): void
  addFileChange(change: FileChange): void
  removeFileChange(filePath: string): void
  clearFiles(): void
  resetConversation(): void
  setIsStreaming(streaming: boolean): void
}

export function createCopilotStore() {
  return createStore<CopilotState>()((set) => ({
    messages: [],
    pendingFiles: new Map(),
    isStreaming: false,

    appendMessage(msg) {
      set((s) => ({ messages: [...s.messages, msg] }))
    },

    addFileChange(change) {
      set((s) => {
        const next = new Map(s.pendingFiles)
        next.set(change.filePath, change)
        return { pendingFiles: next }
      })
    },

    removeFileChange(filePath) {
      set((s) => {
        const next = new Map(s.pendingFiles)
        next.delete(filePath)
        return { pendingFiles: next }
      })
    },

    clearFiles() {
      set({ pendingFiles: new Map() })
    },

    resetConversation() {
      set({ messages: [], pendingFiles: new Map(), isStreaming: false })
    },

    setIsStreaming(streaming) {
      set({ isStreaming: streaming })
    },
  }))
}

export const copilotStore = createCopilotStore()
export type CopilotStore = ReturnType<typeof createCopilotStore>
