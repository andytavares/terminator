import { create, type StoreApi } from 'zustand'
import type {
  ConflictSession,
  ConflictResolution,
  ResolutionDecision,
  ConflictBlock,
  ConflictFile,
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

type SetState = StoreApi<MergeFlowStore>['setState']
type GetState = StoreApi<MergeFlowStore>['getState']

/** A conflict block located in the session: its file, and its index in each. */
interface BlockAt {
  fileIndex: number
  blockIndex: number
  file: ConflictFile
  block: ConflictBlock
}

const NO_SESSION_STATE = {
  activeFileIndex: 0,
  activeBlockIndex: 0,
  isKeepBothOpen: false,
  error: null,
  _undoStack: [],
}

/** Finds a block by its id, `<file path>#<block index>`. */
function findBlock(session: ConflictSession, blockId: string): BlockAt | null {
  const hashIdx = blockId.lastIndexOf('#')
  const filePath = blockId.slice(0, hashIdx)
  const blockIndex = parseInt(blockId.slice(hashIdx + 1), 10)
  const fileIndex = session.files.findIndex((f) => f.filePath === filePath)
  if (fileIndex === -1) return null
  const file = session.files[fileIndex]
  const block = file?.blocks[blockIndex]
  if (!block) return null
  return { fileIndex, blockIndex, file, block }
}

/** The session with one block replaced and its file's resolved count changed by `countDelta`. */
function withBlock(
  session: ConflictSession,
  at: BlockAt,
  change: { block: ConflictBlock; countDelta: number }
): ConflictSession {
  const blocks = [...at.file.blocks]
  blocks[at.blockIndex] = change.block
  const resolvedCount = Math.max(0, at.file.resolvedCount + change.countDelta)
  const files = [...session.files]
  files[at.fileIndex] = { ...at.file, blocks, resolvedCount }
  const totalResolved = Math.max(0, session.totalResolved + change.countDelta)
  return { ...session, files, totalResolved }
}

function decisionFor(
  blockId: string,
  resolution: ConflictResolution,
  block: ConflictBlock
): ResolutionDecision {
  return {
    blockId,
    resolvedText: resolution.resolvedText,
    strategy: resolution.strategy,
    originalConflictText: block.originalConflictText,
    decidedAt: new Date().toISOString(),
  }
}

function navigationActions(set: SetState, get: GetState) {
  return {
    setActiveFile: (index: number) => set({ activeFileIndex: index, activeBlockIndex: 0 }),
    setActiveBlock: (index: number) => set({ activeBlockIndex: index }),
    // At the last block of the last file this does nothing.
    goToNextBlock: () => {
      const { session, activeFileIndex, activeBlockIndex } = get()
      const file = session?.files[activeFileIndex]
      if (!session || !file) return
      if (activeBlockIndex < file.blocks.length - 1) {
        set({ activeBlockIndex: activeBlockIndex + 1 })
      } else if (activeFileIndex < session.files.length - 1) {
        set({ activeFileIndex: activeFileIndex + 1, activeBlockIndex: 0 })
      }
    },
    // At the first block of the first file this does nothing.
    goToPrevBlock: () => {
      const { session, activeFileIndex, activeBlockIndex } = get()
      if (!session) return
      if (activeBlockIndex > 0) {
        set({ activeBlockIndex: activeBlockIndex - 1 })
      } else if (activeFileIndex > 0) {
        const prevFile = session.files[activeFileIndex - 1]
        const lastBlock = prevFile ? prevFile.blocks.length - 1 : 0
        set({ activeFileIndex: activeFileIndex - 1, activeBlockIndex: lastBlock })
      }
    },
  }
}

/** Undoing a decision moves the cursor back to the block it reopens. */
function resolutionActions(set: SetState, get: GetState) {
  return {
    confirmDecision: (blockId: string, resolution: ConflictResolution) => {
      const { session, _undoStack } = get()
      const at = session && findBlock(session, blockId)
      if (!session || !at) return
      const { resolvedText, strategy } = resolution
      const block = { ...at.block, isResolved: true, resolvedText, strategy }
      const countDelta = at.block.isResolved ? 0 : 1
      set({
        session: withBlock(session, at, { block, countDelta }),
        _undoStack: [..._undoStack, decisionFor(blockId, resolution, at.block)],
      })
    },
    undoLastDecision: () => {
      const { session, _undoStack } = get()
      const decision = _undoStack[_undoStack.length - 1]
      const at = session && decision && findBlock(session, decision.blockId)
      if (!session || !at) return null
      const block = { ...at.block, isResolved: false, resolvedText: undefined, strategy: undefined }
      set({
        session: withBlock(session, at, { block, countDelta: -1 }),
        _undoStack: _undoStack.slice(0, -1),
        activeFileIndex: at.fileIndex,
        activeBlockIndex: at.blockIndex,
      })
      return decision
    },
  }
}

export const useMergeFlowStore = create<MergeFlowStore>((set, get) => ({
  session: null,
  isLoading: false,
  ...NO_SESSION_STATE,
  startSession: (session) => set({ session, ...NO_SESSION_STATE }),
  clearSession: () => set({ session: null, isLoading: false, ...NO_SESSION_STATE }),
  ...navigationActions(set, get),
  ...resolutionActions(set, get),
  openKeepBoth: () => set({ isKeepBothOpen: true }),
  closeKeepBoth: () => set({ isKeepBothOpen: false }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}))
