import { create } from 'zustand'
import type {
  ConflictSession,
  ConflictResolution,
  ResolutionDecision,
} from '../schemas/merge-flow.schema'

interface MergeFlowStore {
  // State
  session: ConflictSession | null
  activeFileIndex: number
  activeBlockIndex: number
  isKeepBothOpen: boolean
  isLoading: boolean
  error: string | null
  _undoStack: ResolutionDecision[]

  // Session lifecycle
  startSession(session: ConflictSession): void
  clearSession(): void

  // Navigation
  setActiveFile(index: number): void
  setActiveBlock(index: number): void
  goToNextBlock(): void
  goToPrevBlock(): void

  // Resolution
  confirmDecision(blockId: string, resolution: ConflictResolution): void
  undoLastDecision(): ResolutionDecision | null

  // UI modals
  openKeepBoth(): void
  closeKeepBoth(): void

  // Loading / error
  setLoading(loading: boolean): void
  setError(error: string | null): void
}

export const useMergeFlowStore = create<MergeFlowStore>((set, get) => ({
  session: null,
  activeFileIndex: 0,
  activeBlockIndex: 0,
  isKeepBothOpen: false,
  isLoading: false,
  error: null,
  _undoStack: [],

  startSession: (session) =>
    set({
      session,
      activeFileIndex: 0,
      activeBlockIndex: 0,
      isKeepBothOpen: false,
      error: null,
      _undoStack: [],
    }),

  clearSession: () =>
    set({
      session: null,
      activeFileIndex: 0,
      activeBlockIndex: 0,
      isKeepBothOpen: false,
      isLoading: false,
      error: null,
      _undoStack: [],
    }),

  setActiveFile: (index) => set({ activeFileIndex: index, activeBlockIndex: 0 }),

  setActiveBlock: (index) => set({ activeBlockIndex: index }),

  goToNextBlock: () => {
    const { session, activeFileIndex, activeBlockIndex } = get()
    if (!session) return
    const file = session.files[activeFileIndex]
    if (!file) return

    if (activeBlockIndex < file.blocks.length - 1) {
      set({ activeBlockIndex: activeBlockIndex + 1 })
    } else if (activeFileIndex < session.files.length - 1) {
      set({ activeFileIndex: activeFileIndex + 1, activeBlockIndex: 0 })
    }
    // At last block of last file — do nothing
  },

  goToPrevBlock: () => {
    const { session, activeFileIndex, activeBlockIndex } = get()
    if (!session) return

    if (activeBlockIndex > 0) {
      set({ activeBlockIndex: activeBlockIndex - 1 })
    } else if (activeFileIndex > 0) {
      const prevFile = session.files[activeFileIndex - 1]
      set({
        activeFileIndex: activeFileIndex - 1,
        activeBlockIndex: prevFile ? prevFile.blocks.length - 1 : 0,
      })
    }
    // At first block of first file — do nothing
  },

  confirmDecision: (blockId, resolution) => {
    const { session, _undoStack } = get()
    if (!session) return

    const hashIdx = blockId.lastIndexOf('#')
    const filePath = blockId.slice(0, hashIdx)
    const blockIndex = parseInt(blockId.slice(hashIdx + 1), 10)

    const fileIndex = session.files.findIndex((f) => f.filePath === filePath)
    if (fileIndex === -1) return
    const file = session.files[fileIndex]
    const block = file?.blocks[blockIndex]
    if (!block) return

    const decision: ResolutionDecision = {
      blockId,
      resolvedText: resolution.resolvedText,
      strategy: resolution.strategy,
      originalConflictText: block.originalConflictText,
      decidedAt: new Date().toISOString(),
    }

    const updatedBlock = {
      ...block,
      isResolved: true,
      resolvedText: resolution.resolvedText,
      strategy: resolution.strategy,
    }
    const updatedBlocks = [...file.blocks]
    updatedBlocks[blockIndex] = updatedBlock
    const wasAlreadyResolved = block.isResolved
    const updatedFile = {
      ...file,
      blocks: updatedBlocks,
      resolvedCount: wasAlreadyResolved ? file.resolvedCount : file.resolvedCount + 1,
    }
    const updatedFiles = [...session.files]
    updatedFiles[fileIndex] = updatedFile

    set({
      session: {
        ...session,
        files: updatedFiles,
        totalResolved: wasAlreadyResolved ? session.totalResolved : session.totalResolved + 1,
      },
      _undoStack: [..._undoStack, decision],
    })
  },

  undoLastDecision: () => {
    const { session, _undoStack } = get()
    if (!session || _undoStack.length === 0) return null

    const decision = _undoStack[_undoStack.length - 1]
    const hashIdx = decision.blockId.lastIndexOf('#')
    const filePath = decision.blockId.slice(0, hashIdx)
    const blockIndex = parseInt(decision.blockId.slice(hashIdx + 1), 10)

    const fileIndex = session.files.findIndex((f) => f.filePath === filePath)
    if (fileIndex === -1) return null
    const file = session.files[fileIndex]
    const block = file?.blocks[blockIndex]
    if (!block) return null

    const updatedBlock = {
      ...block,
      isResolved: false,
      resolvedText: undefined,
      strategy: undefined,
    }
    const updatedBlocks = [...file.blocks]
    updatedBlocks[blockIndex] = updatedBlock
    const updatedFile = {
      ...file,
      blocks: updatedBlocks,
      resolvedCount: Math.max(0, file.resolvedCount - 1),
    }
    const updatedFiles = [...session.files]
    updatedFiles[fileIndex] = updatedFile

    set({
      session: {
        ...session,
        files: updatedFiles,
        totalResolved: Math.max(0, session.totalResolved - 1),
      },
      _undoStack: _undoStack.slice(0, -1),
      // Navigate back to the block that was just undone
      activeFileIndex: fileIndex,
      activeBlockIndex: blockIndex,
    })

    return decision
  },

  openKeepBoth: () => set({ isKeepBothOpen: true }),
  closeKeepBoth: () => set({ isKeepBothOpen: false }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}))
