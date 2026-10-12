import React, { useEffect, useCallback, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useMergeFlowStore } from '../../stores/merge-flow.store'
import { mergeFlowAPI } from '../../api/merge-flow'
import { notificationsAPI } from '../../api/notifications'
import type {
  ConflictBlock,
  ConflictFile,
  ConflictSession,
  ResolutionDecision,
} from '../../schemas/merge-flow.schema'
import { ConflictHeader } from './ConflictHeader'
import { ConflictPanel } from './ConflictPanel'
import { ResultPreviewStrip } from './ResultPreviewStrip'
import { ActionBar } from './ActionBar'
import { KeepBothModal } from './KeepBothModal'
import { ManualEditor } from './ManualEditor'
import { stripConflictMarkers } from '../../utils/conflict-markers'

interface Props {
  repoRoot: string
  onBack: () => void
  onComplete: () => void
  onStartOver?: () => void
  onExit?: () => void
}

type Strategy = 'ours' | 'theirs' | 'both-ours-first' | 'both-theirs-first' | 'manual'

interface Pending {
  text: string
  strategy: Strategy
}

type FlowStore = ReturnType<typeof useMergeFlowStore.getState>

function notifyError(title: string, key: string, message: string): void {
  void notificationsAPI.notify({ type: 'error', title, key, message })
}

function notifyResolveFailed(message: string): void {
  notifyError('Could not resolve conflict', 'conflictResolveFailed', message)
}

interface ResolveDeps {
  repoRoot: string
  block: ConflictBlock
  confirmDecision: FlowStore['confirmDecision']
  goToNextBlock: () => void
  onComplete: () => void
  clearPending: () => void
}

/** The block's current resolution, which the write replaces; none for an unresolved block. */
function previousResolution(block: ConflictBlock): string | undefined {
  if (!block.isResolved) return undefined
  return block.resolvedText ?? undefined
}

/** Writes the chosen text into the file; false (after telling the user) when that fails. */
async function writeResolution(deps: ResolveDeps, choice: Pending): Promise<boolean> {
  const { block } = deps
  const result = await mergeFlowAPI.resolveConflict({
    repoRoot: deps.repoRoot,
    blockId: block.blockId,
    resolvedText: choice.text,
    strategy: choice.strategy,
    currentResolvedText: previousResolution(block),
    originalConflictText: block.originalConflictText,
  })
  if (!('error' in result)) return true
  notifyResolveFailed(result.error)
  return false
}

/**
 * Saves the session (read after the decision, so the new text is in it), then finishes or
 * moves on. Re-resolving an already-resolved block stays on it so the user can keep reviewing.
 */
function afterDecision(deps: ResolveDeps, wasAlreadyResolved: boolean): void {
  const current = useMergeFlowStore.getState().session
  if (!current) return
  void mergeFlowAPI.persistSession(deps.repoRoot, current)
  if (!wasAlreadyResolved) {
    if (current.totalResolved >= current.totalConflicts) deps.onComplete()
    else deps.goToNextBlock()
  }
  deps.clearPending()
}

async function resolveBlock(deps: ResolveDeps, choice: Pending): Promise<void> {
  const wasAlreadyResolved = deps.block.isResolved
  try {
    if (!(await writeResolution(deps, choice))) return
    const { blockId } = deps.block
    deps.confirmDecision(blockId, { blockId, resolvedText: choice.text, strategy: choice.strategy })
    afterDecision(deps, wasAlreadyResolved)
  } catch (e) {
    notifyResolveFailed(String(e))
  }
}

/** Puts the conflict back in the file for the decision just taken off the undo stack. */
async function undoDecision(repoRoot: string, decision: ResolutionDecision): Promise<void> {
  try {
    const result = await mergeFlowAPI.undoResolve({
      repoRoot,
      blockId: decision.blockId,
      resolvedText: decision.resolvedText,
      originalConflictText: decision.originalConflictText,
    })
    if ('error' in result) notifyError('Could not undo', 'conflictUndoFailed', result.error)
  } catch (e) {
    notifyError('Could not undo', 'conflictUndoFailed', String(e))
  }
}

interface KeyHandlers {
  next: () => void
  prev: () => void
  pick: (strategy: 'ours' | 'theirs') => void
  keepBoth: () => void
  edit: () => void
  confirm: () => void
  undo: () => void
}

const KEY_ACTIONS = new Map<string, (h: KeyHandlers) => void>([
  ['ArrowRight', (h) => h.next()],
  ['ArrowLeft', (h) => h.prev()],
  ['m', (h) => h.pick('ours')],
  ['M', (h) => h.pick('ours')],
  ['t', (h) => h.pick('theirs')],
  ['T', (h) => h.pick('theirs')],
  ['b', (h) => h.keepBoth()],
  ['B', (h) => h.keepBoth()],
  ['e', (h) => h.edit()],
  ['E', (h) => h.edit()],
  ['Enter', (h) => h.confirm()],
])

function handleResolverKey(e: KeyboardEvent, h: KeyHandlers): void {
  const action = KEY_ACTIONS.get(e.key)
  if (action) return action(h)
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z') h.undo()
}

/** The resolver's keys, bound while no modal or editor is open. */
function useResolverKeys(enabled: boolean, handlers: KeyHandlers): void {
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => handleResolverKey(e, handlersRef.current)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

/** Editor mode, its suggested text and the pending choice; all cleared on moving to another block. */
function useBlockState(blockPosition: string) {
  const [manualMode, setManualMode] = useState(false)
  const [manualSuggestedText, setManualSuggestedText] = useState<string | null>(null)
  const [pendingResolution, setPendingResolution] = useState<Pending | null>(null)
  const [shownBlockPosition, setShownBlockPosition] = useState(blockPosition)
  if (shownBlockPosition !== blockPosition) {
    setShownBlockPosition(blockPosition)
    setManualMode(false)
    setManualSuggestedText(null)
    setPendingResolution(null)
  }
  const closeEditor = () => {
    setManualMode(false)
    setManualSuggestedText(null)
  }
  return {
    manualMode,
    setManualMode,
    manualSuggestedText,
    setManualSuggestedText,
    pendingResolution,
    setPendingResolution,
    closeEditor,
  }
}

type BlockState = ReturnType<typeof useBlockState>

function useResolverStore() {
  return useMergeFlowStore(
    useShallow((s) => ({
      session: s.session,
      activeFileIndex: s.activeFileIndex,
      activeBlockIndex: s.activeBlockIndex,
      isKeepBothOpen: s.isKeepBothOpen,
      goToNextBlock: s.goToNextBlock,
      goToPrevBlock: s.goToPrevBlock,
      openKeepBoth: s.openKeepBoth,
      closeKeepBoth: s.closeKeepBoth,
      confirmDecision: s.confirmDecision,
      undoLastDecision: s.undoLastDecision,
      undoStackLength: s._undoStack.length,
    }))
  )
}

type ResolverStore = ReturnType<typeof useResolverStore>

function useResolveHandlers(props: Props, store: ResolverStore, state: BlockState) {
  const { repoRoot, onComplete } = props
  const { confirmDecision, goToNextBlock, undoLastDecision } = store
  const activeBlock = store.session?.files[store.activeFileIndex]?.blocks[store.activeBlockIndex]
  const { setPendingResolution } = state
  const handleResolve = useCallback(
    async (choice: Pending) => {
      if (!activeBlock) return
      const clearPending = () => setPendingResolution(null)
      const deps = {
        repoRoot,
        block: activeBlock,
        confirmDecision,
        goToNextBlock,
        onComplete,
        clearPending,
      }
      await resolveBlock(deps, choice)
    },
    [activeBlock, repoRoot, confirmDecision, goToNextBlock, onComplete, setPendingResolution]
  )
  const handleUndo = useCallback(async () => {
    const decision = undoLastDecision()
    if (decision) await undoDecision(repoRoot, decision)
  }, [undoLastDecision, repoRoot])
  return { handleResolve, handleUndo }
}

type ResolveHandlers = ReturnType<typeof useResolveHandlers>

/** Whether there is a conflict after the active one, in this file or a later one. */
function canGoNext(session: ConflictSession, fileIndex: number, blockIndex: number): boolean {
  const lastFileIdx = session.files.length - 1
  if (fileIndex < lastFileIdx) return true
  const lastBlockIdx = (session.files[lastFileIdx]?.blocks.length ?? 1) - 1
  return blockIndex < lastBlockIdx
}

interface ResolverView {
  props: Props
  store: ResolverStore
  state: BlockState
  handlers: ResolveHandlers
  session: ConflictSession
  file: ConflictFile
  block: ConflictBlock
}

function pick(view: ResolverView, strategy: 'ours' | 'theirs'): void {
  const text = choiceText(view.block, strategy)
  view.state.setPendingResolution({ text, strategy })
}

function choiceText(block: ConflictBlock, strategy: 'ours' | 'theirs'): string {
  if (strategy === 'ours') return block.oursText
  return block.theirsText
}

/** "Keep mine" or "Keep theirs": in the editor it replaces the text, otherwise it is the pending choice. */
function keepSide(view: ResolverView, strategy: 'ours' | 'theirs'): void {
  if (!view.state.manualMode) return pick(view, strategy)
  view.state.setManualSuggestedText(stripConflictMarkers(choiceText(view.block, strategy)))
}

function confirmPending(view: ResolverView): void {
  const pending = view.state.pendingResolution
  if (pending) void view.handlers.handleResolve(pending)
}

function ResolverBody({ view }: { view: ResolverView }) {
  const { state, block, file } = view
  if (state.manualMode) {
    return (
      <ManualEditor
        block={block}
        suggestedText={state.manualSuggestedText}
        onSave={(text) => {
          state.closeEditor()
          void view.handlers.handleResolve({ text, strategy: 'manual' })
        }}
        onCancel={state.closeEditor}
      />
    )
  }
  return (
    <ConflictPanel
      block={block}
      isRebase={view.session.isRebase}
      pendingStrategy={state.pendingResolution?.strategy ?? null}
      oursAuthor={file.oursAuthor}
      theirsAuthor={file.theirsAuthor}
      onSelectMine={() => pick(view, 'ours')}
      onSelectTheirs={() => pick(view, 'theirs')}
    />
  )
}

function ResolverHeader({ view }: { view: ResolverView }) {
  const { store, props } = view
  const canPrev = store.activeFileIndex > 0 || store.activeBlockIndex > 0
  return (
    <ConflictHeader
      onBack={props.onBack}
      onUndo={view.handlers.handleUndo}
      canUndo={store.undoStackLength > 0}
      onPrev={store.goToPrevBlock}
      onNext={store.goToNextBlock}
      canPrev={canPrev}
      canNext={canGoNext(view.session, store.activeFileIndex, store.activeBlockIndex)}
      onStartOver={props.onStartOver}
      onExit={props.onExit}
    />
  )
}

function ResolverActions({ view }: { view: ResolverView }) {
  const { state, block } = view
  const pending = state.pendingResolution
  return (
    <>
      <ResultPreviewStrip
        resolvedText={pending?.text ?? block.resolvedText ?? null}
        blockId={block.blockId}
        isExistingResolution={!pending && block.isResolved}
      />
      <ActionBar
        pendingResolution={pending}
        onKeepMine={() => keepSide(view, 'ours')}
        onKeepTheirs={() => keepSide(view, 'theirs')}
        onKeepBoth={view.store.openKeepBoth}
        onEdit={() => state.setManualMode(true)}
        onConfirm={() => confirmPending(view)}
      />
    </>
  )
}

function KeepBoth({ view }: { view: ResolverView }) {
  const { store, file, session } = view
  return (
    <KeepBothModal
      block={view.block}
      oursAuthor={file.oursAuthor}
      theirsAuthor={file.theirsAuthor}
      oursBranch={session.oursBranch}
      theirsBranch={session.theirsBranch}
      onConfirm={(text, strategy) => {
        store.closeKeepBoth()
        void view.handlers.handleResolve({ text, strategy })
      }}
      onCancel={store.closeKeepBoth}
    />
  )
}

function useConflictResolver(props: Props) {
  const store = useResolverStore()
  const state = useBlockState(`${store.activeFileIndex}:${store.activeBlockIndex}`)
  const handlers = useResolveHandlers(props, store, state)
  const block = store.session?.files[store.activeFileIndex]?.blocks[store.activeBlockIndex]
  useResolverKeys(!store.isKeepBothOpen && !state.manualMode, {
    next: store.goToNextBlock,
    prev: store.goToPrevBlock,
    pick: (strategy) => {
      const text = (block && choiceText(block, strategy)) ?? ''
      state.setPendingResolution({ text, strategy })
    },
    keepBoth: store.openKeepBoth,
    edit: () => state.setManualMode(true),
    confirm: () => {
      if (state.pendingResolution) void handlers.handleResolve(state.pendingResolution)
    },
    undo: () => void handlers.handleUndo(),
  })
  return { store, state, handlers }
}

export function ConflictResolver(props: Props) {
  const { store, state, handlers } = useConflictResolver(props)
  const { session } = store
  const file = session?.files[store.activeFileIndex]
  const block = file?.blocks[store.activeBlockIndex]
  if (!session || !file || !block) return null
  const view: ResolverView = { props, store, state, handlers, session, file, block }
  return (
    <div className="conflict-resolver">
      <ResolverHeader view={view} />
      {file.conflictDescription && (
        <div className="conflict-resolver__desc-banner">{file.conflictDescription}</div>
      )}
      <ResolverBody view={view} />
      <ResolverActions view={view} />
      {store.isKeepBothOpen && <KeepBoth view={view} />}
    </div>
  )
}
